import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { address } from '@solana/kit';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { CardMemberSchema, type CardMember } from '../authority/card-member';
import { DEFAULT_SPENDING_POLICY, evaluateSpendAuthority, parseStoredAuthorityDecision, type AuthorityDecision, type SpendingControls } from '../authority/authority-policy';
import { parseStoredSpendIntent, type SpendIntent } from '../authority/spend-intent';
import { MARKET_SNAPSHOT_OPERATION, SpendGrantInputSchema, SpendGrantSchema, SpendGrantScopeSchema, SpendPrincipalSchema, parseGrantAmount, type SpendAuthorityBinding, type SpendGrant, type SpendGrantInput, type SpendGrantScope, type SpendPrincipal } from '../authority/spend-grant';
import { MarketSnapshotOutputSchema, type MarketSnapshotOutput } from '../resources/resource-schema';
import { hash, nextSpendingDayBoundary, spendingDay } from './spending-policy';

export type DeliveryStatus = 'NOT_PAID' | 'PENDING' | 'COMPLETE';
export const PurchaseExecutionModeSchema = z.enum(['simulated', 'live_devnet']);
export type PurchaseExecutionMode = z.infer<typeof PurchaseExecutionModeSchema>;
export type StoredPurchaseExecutionMode = PurchaseExecutionMode | 'UNKNOWN';
const PaymentEvidenceFields = {
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/), messageHash: z.string().regex(/^[a-f0-9]{64}$/),
  quoteFingerprint: z.string().regex(/^[a-f0-9]{64}$/), transaction: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,100}$/),
  confirmationStatus: z.enum(['confirmed', 'finalized']), settlementConfirmed: z.literal(true), verifiedAt: z.number().int().nonnegative(),
};
const PaymentEvidencePayerSchema = z.string().refine(value => {
  try { address(value); return true; } catch { return false; }
});
export const PaymentEvidenceSchema = z.discriminatedUnion('version', [
  z.object({ version: z.literal(1), ...PaymentEvidenceFields }).strict(),
  z.object({ version: z.literal(2), ...PaymentEvidenceFields, payer: PaymentEvidencePayerSchema }).strict(),
]);
export type PaymentEvidence = z.infer<typeof PaymentEvidenceSchema>;
export type PaymentVerification = { payer: string; messageHash: string; confirmationStatus: 'confirmed' | 'finalized'; settlementConfirmed: true };
export type SpendReservation = {
  intent: SpendIntent; quote: PaymentRequirements; approvalId: string; decision: AuthorityDecision; status: string; deliveryStatus: DeliveryStatus;
  executionMode: StoredPurchaseExecutionMode; paymentPayloadPresent: boolean; paymentPayloadHash?: string; paymentEvidence?: PaymentEvidence;
  ownerCardMemberId?: string; transaction?: string; data?: MarketSnapshotOutput; answer?: string;
};
/** Compatibility name for callers that still expose the market purchase use case. */
export type PurchaseRecord = SpendReservation;
export type PurchaseLedgerOptions = { managed?: boolean; requireSpendGrant?: boolean; timeZone?: () => string; now?: () => number; defaultCardMemberId?: string };
export type SpendGrantSummary = {
  id: string; version: number; status: SpendGrant['status']; resourceId: string; providerId: string; operation: string;
  network: string; assetId: string; assetDecimals: number; payTo: string; paymentScheme: string; totalLimit: string; singleLimit: string;
  committed: string; remaining: string; createdAt: number; expiresAt: number; revokedAt: number | null;
};
function currentAuthorityStatus(status: string) {
  if (status === 'REJECTED') return 'DENIED';
  if (status === 'NEEDS_CONFIRMATION') return 'REQUIRES_APPROVAL';
  return status;
}
function storedExecutionMode(value: unknown): StoredPurchaseExecutionMode {
  const parsed = PurchaseExecutionModeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'UNKNOWN';
}
function storedPaymentEvidence(value: unknown): PaymentEvidence | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = PaymentEvidenceSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}
function accountingModeFilter(mode?: StoredPurchaseExecutionMode) {
  if (!mode) return '';
  if (mode === 'UNKNOWN') return ' AND execution_mode IS NULL';
  if (mode === 'live_devnet') return " AND (execution_mode='live_devnet' OR execution_mode IS NULL)";
  return " AND execution_mode='simulated'";
}
/** SQLite owns approval, budget reservation and the unique task purchase. No model writes. */
export class PurchaseLedger {
  private db: DatabaseSync;
  private managed: boolean;
  private requireSpendGrant: boolean;
  private timeZone: () => string;
  private now: () => number;
  private defaultCardMemberId?: string;
  private stopping = false;
  constructor(path = '.data/day5-ledger.sqlite', options: PurchaseLedgerOptions = {}) {
    this.managed = options.managed ?? false;
    this.requireSpendGrant = options.requireSpendGrant ?? false;
    if (this.requireSpendGrant && !this.managed) throw new Error('Spend grant enforcement requires a managed ledger');
    this.timeZone = options.timeZone ?? (() => 'Asia/Shanghai');
    this.now = options.now ?? Date.now;
    this.defaultCardMemberId = options.defaultCardMemberId;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, approval_id TEXT NOT NULL UNIQUE,
        purchase TEXT NOT NULL, quote TEXT NOT NULL, decision TEXT NOT NULL, status TEXT NOT NULL,
        amount INTEGER NOT NULL, confirmed_day TEXT, transaction_id TEXT, data TEXT, payload TEXT, owner_card_member_id TEXT,
        execution_mode TEXT CHECK(execution_mode IN ('simulated','live_devnet')), payment_evidence TEXT);
      CREATE TABLE IF NOT EXISTS purchase_answers (purchase_id TEXT PRIMARY KEY, answer TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS purchase_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id TEXT NOT NULL, type TEXT NOT NULL, at INTEGER NOT NULL);`);
    if (!this.columns('purchases').has('owner_card_member_id')) this.db.exec('ALTER TABLE purchases ADD COLUMN owner_card_member_id TEXT');
    if (!this.columns('purchases').has('execution_mode')) this.db.exec('ALTER TABLE purchases ADD COLUMN execution_mode TEXT');
    if (!this.columns('purchases').has('payment_evidence')) this.db.exec('ALTER TABLE purchases ADD COLUMN payment_evidence TEXT');
    this.db.exec(`CREATE TRIGGER IF NOT EXISTS purchases_execution_mode_immutable
      BEFORE UPDATE OF execution_mode ON purchases
      WHEN NEW.execution_mode IS NOT OLD.execution_mode
      BEGIN SELECT RAISE(ABORT, 'purchase execution mode is immutable'); END;`);
    if (this.managed) {
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS app_schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS app_settings (id INTEGER PRIMARY KEY CHECK(id=1), daily_limit INTEGER, paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)));
        INSERT OR IGNORE INTO app_settings (id,daily_limit,paused) VALUES (1,NULL,0);
        CREATE TABLE IF NOT EXISTS app_budget_clock (id INTEGER PRIMARY KEY CHECK(id=1), spending_day TEXT NOT NULL, time_zone TEXT NOT NULL, next_boundary INTEGER NOT NULL, last_seen INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS spend_grants (id TEXT PRIMARY KEY, version INTEGER NOT NULL UNIQUE, connection_id TEXT NOT NULL, connection_generation INTEGER NOT NULL,
          resource_id TEXT NOT NULL, provider_id TEXT NOT NULL, operation TEXT NOT NULL, network TEXT NOT NULL, asset_id TEXT NOT NULL, asset_decimals INTEGER NOT NULL,
          pay_to TEXT NOT NULL, payment_scheme TEXT NOT NULL,
          total_limit INTEGER NOT NULL, single_limit INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED','EXPIRED')),
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER);
        CREATE UNIQUE INDEX IF NOT EXISTS one_active_spend_grant ON spend_grants(status) WHERE status='ACTIVE';
        CREATE TABLE IF NOT EXISTS spend_grant_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, grant_id TEXT NOT NULL, type TEXT NOT NULL, at INTEGER NOT NULL);
        INSERT OR IGNORE INTO app_schema_migrations (id,applied_at) VALUES ('001_app_controls',unixepoch('now') * 1000);
        INSERT OR IGNORE INTO app_schema_migrations (id,applied_at) VALUES ('002_spend_grants',unixepoch('now') * 1000);
        INSERT OR IGNORE INTO app_schema_migrations (id,applied_at) VALUES ('004_purchase_execution_isolation',unixepoch('now') * 1000);
        COMMIT;`);
      this.migrateCardMemberIdentity();
      const now = this.now(); const zone = this.timeZone();
      this.db.prepare('INSERT OR IGNORE INTO app_budget_clock (id,spending_day,time_zone,next_boundary,last_seen) VALUES (1,?,?,?,?)')
        .run(spendingDay(now, zone), zone, nextSpendingDayBoundary(now, zone), now);
    }
  }
  private columns(table: string) {
    return new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name)));
  }
  private migrateCardMemberIdentity() {
    const now = this.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec(`CREATE TABLE IF NOT EXISTS card_members (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED')),
        is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS one_default_card_member ON card_members(is_default) WHERE is_default=1;
        CREATE TABLE IF NOT EXISTS legacy_connection_card_members (
          connection_id TEXT PRIMARY KEY, card_member_id TEXT NOT NULL REFERENCES card_members(id));`);
      if (!this.columns('spend_grants').has('card_member_id')) this.db.exec('ALTER TABLE spend_grants ADD COLUMN card_member_id TEXT');
      if (!this.columns('purchases').has('owner_card_member_id')) this.db.exec('ALTER TABLE purchases ADD COLUMN owner_card_member_id TEXT');

      if (!this.db.prepare('SELECT id FROM card_members WHERE is_default=1').get()) {
        this.db.prepare("INSERT INTO card_members (id,label,status,is_default,created_at,updated_at) VALUES (?,?,'ACTIVE',1,?,?)")
          .run(this.defaultCardMemberId ?? randomUUID(), 'Codex', now, now);
      }

      const historical = new Set<string>();
      for (const row of this.db.prepare('SELECT DISTINCT connection_id FROM spend_grants WHERE card_member_id IS NULL').all()) historical.add(String(row.connection_id));
      for (const row of this.db.prepare(`SELECT DISTINCT json_extract(purchase,'$.authority.connectionId') AS connection_id FROM purchases
        WHERE owner_card_member_id IS NULL AND json_valid(purchase) AND json_extract(purchase,'$.authority.connectionId') IS NOT NULL`).all()) {
        historical.add(String(row.connection_id));
      }
      for (const connectionId of historical) {
        let mapping = this.db.prepare('SELECT card_member_id FROM legacy_connection_card_members WHERE connection_id=?').get(connectionId);
        if (!mapping) {
          const cardMemberId = randomUUID();
          this.db.prepare("INSERT INTO card_members (id,label,status,is_default,created_at,updated_at) VALUES (?,?,'ACTIVE',0,?,?)")
            .run(cardMemberId, `Imported Codex connection ${connectionId.slice(0, 8)}`, now, now);
          this.db.prepare('INSERT INTO legacy_connection_card_members (connection_id,card_member_id) VALUES (?,?)').run(connectionId, cardMemberId);
          mapping = { card_member_id: cardMemberId };
        }
        const cardMemberId = String(mapping.card_member_id);
        this.db.prepare('UPDATE spend_grants SET card_member_id=? WHERE connection_id=? AND card_member_id IS NULL').run(cardMemberId, connectionId);
        this.db.prepare(`UPDATE purchases SET owner_card_member_id=? WHERE owner_card_member_id IS NULL AND json_valid(purchase)
          AND json_extract(purchase,'$.authority.connectionId')=?`).run(cardMemberId, connectionId);
      }
      this.db.prepare("INSERT OR IGNORE INTO app_schema_migrations (id,applied_at) VALUES ('003_stable_card_member',?)").run(now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private event(id: string, type: string) { this.db.prepare('INSERT INTO purchase_events (purchase_id,type,at) VALUES (?,?,?)').run(id, type, Date.now()); }
  private grantEvent(id: string, type: string, at = this.now()) { this.db.prepare('INSERT INTO spend_grant_events (grant_id,type,at) VALUES (?,?,?)').run(id, type, at); }
  private expireGrants(now: number) {
    if (!this.managed) return;
    const rows = this.db.prepare("UPDATE spend_grants SET status='EXPIRED' WHERE status='ACTIVE' AND expires_at<=? RETURNING id").all(now);
    for (const row of rows) this.grantEvent(String(row.id), 'grant.EXPIRED', now);
  }
  private parseGrantRow(row: Record<string, unknown>): SpendGrant {
    return SpendGrantSchema.parse({
      id: String(row.id), version: Number(row.version), cardMemberId: String(row.card_member_id), connectionId: String(row.connection_id), connectionGeneration: Number(row.connection_generation),
      resourceId: String(row.resource_id), providerId: String(row.provider_id), operation: String(row.operation), network: String(row.network), assetId: String(row.asset_id),
      assetDecimals: Number(row.asset_decimals), payTo: String(row.pay_to), paymentScheme: String(row.payment_scheme), totalLimit: Number(row.total_limit), singleLimit: Number(row.single_limit), status: String(row.status),
      createdAt: Number(row.created_at), expiresAt: Number(row.expires_at), revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    });
  }
  private parseCardMemberRow(row: Record<string, unknown>): CardMember {
    return CardMemberSchema.parse({ id: String(row.id), label: String(row.label), status: String(row.status),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) });
  }
  defaultCardMember() {
    if (!this.managed) throw new Error('CardMember identity requires a managed ledger');
    const row = this.db.prepare('SELECT * FROM card_members WHERE is_default=1').get();
    if (!row) throw new Error('Default CardMember is missing');
    return this.parseCardMemberRow(row);
  }
  cardMember(id: string) {
    if (!this.managed) return undefined;
    const row = this.db.prepare('SELECT * FROM card_members WHERE id=?').get(id);
    return row ? this.parseCardMemberRow(row) : undefined;
  }
  isCardMemberActive(id: string) { return this.cardMember(id)?.status === 'ACTIVE'; }
  assertCardMemberActive(id: string) {
    if (!this.isCardMemberActive(id)) throw new Error('CARD_MEMBER_REVOKED');
  }
  revokeCardMember(id: string, now = this.now()) {
    if (!this.managed) return false;
    return this.atomic(() => {
      const changed = this.db.prepare("UPDATE card_members SET status='REVOKED',updated_at=? WHERE id=? AND status='ACTIVE'").run(now, id).changes;
      const grants = this.db.prepare("UPDATE spend_grants SET status='REVOKED',revoked_at=? WHERE card_member_id=? AND status='ACTIVE' RETURNING id").all(now, id);
      for (const row of grants) this.grantEvent(String(row.id), 'grant.REVOKED_CARD_MEMBER', now);
      return changed > 0;
    });
  }
  private grantById(id: string) {
    const row = this.db.prepare('SELECT * FROM spend_grants WHERE id=?').get(id);
    return row ? this.parseGrantRow(row) : undefined;
  }
  private grantCommitted(id: string, mode?: StoredPurchaseExecutionMode) {
    return Number(this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM purchases
      WHERE json_extract(purchase,'$.authority.grantId')=? AND status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN','PAID')${accountingModeFilter(mode)}`).get(id)!.total);
  }
  createSpendGrant(raw: SpendGrantInput, rawPrincipal: SpendPrincipal, rawScope: SpendGrantScope, now = this.now(), mode?: PurchaseExecutionMode) {
    if (!this.managed) throw new Error('Spend grants require a managed ledger');
    const input = SpendGrantInputSchema.parse(raw); const principal = SpendPrincipalSchema.parse(rawPrincipal); const scope = SpendGrantScopeSchema.parse(rawScope);
    this.assertCardMemberActive(principal.cardMemberId);
    const totalLimit = parseGrantAmount(input.totalLimit, 'totalLimit'); const singleLimit = parseGrantAmount(input.singleLimit, 'singleLimit');
    if (singleLimit > totalLimit) throw new Error('单笔上限不能大于授权总额。');
    if (input.expiresAt <= now + 60_000 || input.expiresAt > now + 7 * 24 * 60 * 60 * 1000) throw new Error('授权有效期必须在 1 分钟到 7 天之间。');
    return this.atomic(() => {
      this.expireGrants(now);
      const previous = this.db.prepare("UPDATE spend_grants SET status='REVOKED',revoked_at=? WHERE status='ACTIVE' RETURNING id").all(now);
      for (const row of previous) this.grantEvent(String(row.id), 'grant.REVOKED_REPLACED', now);
      const version = Number(this.db.prepare('SELECT COALESCE(MAX(version),0)+1 AS version FROM spend_grants').get()!.version);
      const id = randomUUID();
      this.db.prepare(`INSERT INTO spend_grants (id,version,card_member_id,connection_id,connection_generation,resource_id,provider_id,operation,network,asset_id,asset_decimals,pay_to,payment_scheme,total_limit,single_limit,status,created_at,expires_at,revoked_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE',?,?,NULL)`).run(id, version, principal.cardMemberId, principal.connectionId, principal.connectionGeneration, scope.resourceId, scope.providerId,
        scope.operation, scope.network, scope.assetId, scope.assetDecimals, scope.payTo, scope.paymentScheme, totalLimit, singleLimit, now, input.expiresAt);
      this.grantEvent(id, 'grant.CREATED', now);
      return this.latestGrantSummary(now, mode)!;
    });
  }
  revokeActiveSpendGrant(now = this.now(), event = 'grant.REVOKED') {
    if (!this.managed) return false;
    return this.atomic(() => {
      const rows = this.db.prepare("UPDATE spend_grants SET status='REVOKED',revoked_at=? WHERE status='ACTIVE' RETURNING id").all(now);
      for (const row of rows) this.grantEvent(String(row.id), event, now);
      return rows.length > 0;
    });
  }
  activeSpendGrant(now = this.now()) {
    if (!this.managed) return undefined;
    return this.atomic(() => {
      this.expireGrants(now);
      const row = this.db.prepare("SELECT * FROM spend_grants WHERE status='ACTIVE' ORDER BY version DESC LIMIT 1").get();
      return row ? this.parseGrantRow(row) : undefined;
    });
  }
  spendAuthority(principal: SpendPrincipal, operation: string, now = this.now()): SpendAuthorityBinding {
    const parsed = SpendPrincipalSchema.parse(principal); const grant = this.activeSpendGrant(now);
    this.assertCardMemberActive(parsed.cardMemberId);
    if (!grant || grant.cardMemberId !== parsed.cardMemberId || grant.operation !== operation) {
      throw new Error('当前 Agent 连接没有可用的消费授权。');
    }
    return { grantId: grant.id, grantVersion: grant.version, cardMemberId: parsed.cardMemberId,
      connectionId: parsed.connectionId, connectionGeneration: parsed.connectionGeneration, operation };
  }
  /** Identifies the latest matching grant so policy can persist an inactive-grant denial.
   * This binding is only an input to reserve(); claim/sign still require an ACTIVE grant. */
  spendAuthorityForDecision(principal: SpendPrincipal, operation: string, now = this.now()): SpendAuthorityBinding | undefined {
    if (!this.managed) throw new Error('Spend grants require a managed ledger');
    const parsed = SpendPrincipalSchema.parse(principal);
    this.assertCardMemberActive(parsed.cardMemberId);
    return this.atomic(() => {
      this.expireGrants(now);
      const row = this.db.prepare('SELECT * FROM spend_grants WHERE card_member_id=? AND operation=? ORDER BY version DESC LIMIT 1').get(parsed.cardMemberId, operation);
      if (!row) return undefined;
      const grant = this.parseGrantRow(row);
      return { grantId: grant.id, grantVersion: grant.version, cardMemberId: parsed.cardMemberId,
        connectionId: parsed.connectionId, connectionGeneration: parsed.connectionGeneration, operation };
    });
  }
  spendGrantSummary(now = this.now(), mode?: PurchaseExecutionMode): SpendGrantSummary | null {
    if (!this.managed) return null;
    return this.atomic(() => this.latestGrantSummary(now, mode));
  }
  private latestGrantSummary(now: number, mode?: StoredPurchaseExecutionMode): SpendGrantSummary | null {
    this.expireGrants(now);
    const row = this.db.prepare('SELECT * FROM spend_grants ORDER BY version DESC LIMIT 1').get();
    if (!row) return null;
    const grant = this.parseGrantRow(row); const committed = this.grantCommitted(grant.id, mode);
    return { id: grant.id, version: grant.version, status: grant.status, resourceId: grant.resourceId, providerId: grant.providerId, operation: grant.operation,
      network: grant.network, assetId: grant.assetId, assetDecimals: grant.assetDecimals, payTo: grant.payTo, paymentScheme: grant.paymentScheme,
      totalLimit: String(grant.totalLimit), singleLimit: String(grant.singleLimit),
      committed: String(committed), remaining: String(Math.max(0, grant.totalLimit - committed)), createdAt: grant.createdAt, expiresAt: grant.expiresAt, revokedAt: grant.revokedAt };
  }
  private activeDay(now: number) {
    if (!this.managed) return spendingDay(now, this.timeZone());
    const row = this.db.prepare('SELECT spending_day,time_zone,next_boundary,last_seen FROM app_budget_clock WHERE id=1').get()!;
    // A time-zone change does not immediately open a fresh budget. The current
    // window keeps its existing real-time midnight boundary; after that boundary
    // the new zone becomes authoritative. A wall-clock rollback never advances it.
    if (now < Number(row.last_seen)) return String(row.spending_day);
    if (now >= Number(row.next_boundary)) {
      const zone = this.timeZone(); const day = spendingDay(now, zone);
      this.db.prepare('UPDATE app_budget_clock SET spending_day=?,time_zone=?,next_boundary=?,last_seen=? WHERE id=1')
        .run(day, zone, nextSpendingDayBoundary(now, zone), now);
      return day;
    }
    this.db.prepare('UPDATE app_budget_clock SET last_seen=? WHERE id=1').run(now);
    return String(row.spending_day);
  }
  controls(): SpendingControls {
    if (!this.managed) return { dailyBudget: DEFAULT_SPENDING_POLICY.dailyBudget, paused: false, singleLimit: DEFAULT_SPENDING_POLICY.singleLimit };
    const row = this.db.prepare('SELECT daily_limit,paused FROM app_settings WHERE id=1').get()!;
    return { dailyBudget: row.daily_limit === null ? null : Number(row.daily_limit), paused: Boolean(row.paused), singleLimit: DEFAULT_SPENDING_POLICY.singleLimit };
  }
  setDailyLimit(value: string | null) {
    const parsed = value === null ? null : Number(value);
    if (value !== null && (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || Number(value) < 0)) throw new Error('Daily limit must be a non-negative integer in base units');
    this.atomic(() => { this.db.prepare('UPDATE app_settings SET daily_limit=? WHERE id=1').run(parsed); });
    return this.controls();
  }
  setPaused(paused: boolean) {
    if (typeof paused !== 'boolean') throw new Error('Paused must be a boolean');
    this.atomic(() => { this.db.prepare('UPDATE app_settings SET paused=? WHERE id=1').run(paused ? 1 : 0); });
    return this.controls();
  }
  stopPayments() { this.stopping = true; }
  /** Called synchronously immediately before the signer and before submission. */
  assertCanSign(approvalId: string, now = this.now(), validate?: (record: PurchaseRecord) => void) {
    if (this.stopping) throw new Error('Service is stopping');
    const row = this.db.prepare('SELECT task_id FROM purchases WHERE approval_id=?').get(approvalId);
    const record = row ? this.get(String(row.task_id)) : undefined;
    if (record?.executionMode !== 'live_devnet') throw new Error('PURCHASE_EXECUTION_MODE_MISMATCH');
    if (record?.status !== 'PAYING' || record.intent.expiresAt <= now) throw new Error('Approval inactive or expired');
    validate?.(record);
    if (this.managed) {
      const controls = this.controls();
      if (controls.paused) throw new Error('Payments were paused before submission');
      const modeFilter = accountingModeFilter(record.executionMode);
      const committed = Number(this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM purchases WHERE (status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN') OR (status='PAID' AND confirmed_day=?))${modeFilter}`).get(this.activeDay(now))!.total);
      if (controls.dailyBudget === null || committed > controls.dailyBudget) throw new Error('Daily limit no longer covers reserved payments');
      if (this.requireSpendGrant) this.assertGrantCovers(record, now);
    }
  }
  /** Only the sole service owner calls this before accepting any requests.
   * A payload is durably saved before submission; its absence proves no submission.
   * Never run this while another process or signer can still own these claims. */
  recoverUnsubmittedOnStartup() {
    this.atomic(() => {
      const rows = this.db.prepare("UPDATE purchases SET status='FAILED' WHERE status='PAYING' AND payload IS NULL RETURNING id").all();
      for (const row of rows) this.event(String(row.id), 'payment.FAILED_BEFORE_SUBMISSION');
    });
  }
  pendingRecovery() {
    return this.db.prepare("SELECT task_id FROM purchases WHERE status IN ('PAYING','PAYMENT_UNKNOWN') OR (status='PAID' AND data IS NULL)").all().map(row => String(row.task_id));
  }
  get(idempotencyKey: string): SpendReservation | undefined {
    const row = this.db.prepare('SELECT * FROM purchases WHERE task_id=?').get(idempotencyKey);
    if (!row) return undefined;
    const ownerCardMemberId = row.owner_card_member_id ? String(row.owner_card_member_id) : undefined;
    const intent = parseStoredSpendIntent(JSON.parse(String(row.purchase)), ownerCardMemberId);
    const paymentPayloadPresent = typeof row.payload === 'string' && row.payload.length > 0;
    let paymentPayloadHash: string | undefined;
    if (paymentPayloadPresent) {
      try { paymentPayloadHash = hash(JSON.parse(String(row.payload))); } catch { /* Malformed legacy payloads cannot prove a live payment. */ }
    }
    return { intent, quote: JSON.parse(String(row.quote)), approvalId: String(row.approval_id), decision: parseStoredAuthorityDecision(JSON.parse(String(row.decision))), status: currentAuthorityStatus(String(row.status)),
      deliveryStatus: row.status === 'PAID' ? (row.data ? 'COMPLETE' : 'PENDING') : 'NOT_PAID',
      executionMode: storedExecutionMode(row.execution_mode), paymentPayloadPresent,
      ...(paymentPayloadHash ? { paymentPayloadHash } : {}), ...(storedPaymentEvidence(row.payment_evidence) ? { paymentEvidence: storedPaymentEvidence(row.payment_evidence) } : {}),
      ...(ownerCardMemberId ? { ownerCardMemberId } : {}),
      ...(this.db.prepare("SELECT answer FROM purchase_answers WHERE purchase_id=?").get(String(row.id)) as { answer: string } | undefined),
      ...(row.transaction_id ? { transaction: String(row.transaction_id) } : {}),
      ...(row.data ? { data: MarketSnapshotOutputSchema.parse(JSON.parse(String(row.data))) } : {}) };
  }
  private hasVerifiedPaymentProof(record: SpendReservation) {
    const evidence = record.paymentEvidence;
    return Boolean(record.status === 'PAID' && record.executionMode !== 'simulated' && record.paymentPayloadPresent && evidence
      && record.paymentPayloadHash === evidence.payloadHash && record.transaction === evidence.transaction
      && record.intent.quoteFingerprint === evidence.quoteFingerprint && evidence.settlementConfirmed === true
      && ['confirmed', 'finalized'].includes(evidence.confirmationStatus));
  }
  private hasVerifiedLivePayment(record: SpendReservation) {
    return record.executionMode === 'live_devnet' && this.hasVerifiedPaymentProof(record);
  }
  assertReplayAllowed(record: SpendReservation, requestedMode: PurchaseExecutionMode) {
    if (record.executionMode !== requestedMode) throw new Error('PURCHASE_EXECUTION_MODE_MISMATCH');
    if (requestedMode === 'live_devnet' && record.status === 'PAID' && !this.hasVerifiedLivePayment(record)) {
      throw new Error('LIVE_PAYMENT_EVIDENCE_INVALID');
    }
  }
  reserve(intent: SpendIntent, quote: PaymentRequirements, now = Date.now(), mode: StoredPurchaseExecutionMode = 'UNKNOWN', ownerCardMemberId?: string): SpendReservation {
    if (mode !== 'UNKNOWN') PurchaseExecutionModeSchema.parse(mode);
    if (ownerCardMemberId && intent.authority && ownerCardMemberId !== intent.authority.cardMemberId) throw new Error('PURCHASE_REQUEST_OWNER_MISMATCH');
    return this.atomic(() => {
      const existing = this.get(intent.idempotencyKey);
      if (existing) {
        if (this.requireSpendGrant && existing.ownerCardMemberId !== (ownerCardMemberId ?? intent.authority?.cardMemberId)) {
          throw new Error('PURCHASE_REQUEST_OWNER_MISMATCH');
        }
        if (mode === 'UNKNOWN') {
          if (existing.executionMode !== 'UNKNOWN') throw new Error('PURCHASE_EXECUTION_MODE_MISMATCH');
        } else this.assertReplayAllowed(existing, mode);
        if (existing.intent.requestHash !== intent.requestHash || existing.intent.executionBinding !== intent.executionBinding) throw new Error('Idempotency key belongs to another request or execution configuration');
        return existing;
      }
      this.expireUnclaimed(now);
      const modeFilter = accountingModeFilter(mode);
      const row = this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM purchases WHERE (status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN') OR (status='PAID' AND confirmed_day=?))${modeFilter}`).get(this.activeDay(now))!;
      const unresolved = this.db.prepare(`SELECT id FROM purchases WHERE status IN ('PAYING','PAYMENT_UNKNOWN')${modeFilter} LIMIT 1`).get();
      const controls = this.controls();
      let decision = evaluateSpendAuthority(intent, { committed: Number(row.total), hasUnknownPayment: Boolean(unresolved) }, now, controls);
      if (this.requireSpendGrant) decision = this.evaluateGrant(intent, decision, Number(row.total), controls, now, mode);
      this.db.prepare('INSERT INTO purchases (id,task_id,approval_id,purchase,quote,decision,status,amount,owner_card_member_id,execution_mode) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(intent.id, intent.idempotencyKey, randomUUID(), JSON.stringify(intent), JSON.stringify(quote), JSON.stringify(decision), decision.decision, intent.amount,
          ownerCardMemberId ?? intent.authority?.cardMemberId ?? null, mode === 'UNKNOWN' ? null : mode);
      this.event(intent.id, `authority.${decision.decision}`);
      return this.get(intent.idempotencyKey)!;
    });
  }
  /** Release only approvals that never reached the signer. Caller holds the write lock. */
  private expireUnclaimed(now: number) {
    const rows = this.db.prepare("UPDATE purchases SET status='EXPIRED' WHERE status='APPROVED' AND payload IS NULL AND json_extract(purchase,'$.expiresAt')<=? RETURNING id").all(now);
    for (const row of rows) this.event(String(row.id), 'purchase.EXPIRED');
  }
  releaseExpired(now = Date.now()) { this.atomic(() => this.expireUnclaimed(now)); }
  saveAnswer(taskId: string, answer: string) {
    if (!answer.trim() || answer.length > 12000) throw new Error('Invalid final answer');
    this.atomic(() => {
      const record = this.get(taskId);
      if (record?.status !== 'PAID' || !record.data) throw new Error('Answer requires paid data');
      const result = this.db.prepare('INSERT OR IGNORE INTO purchase_answers (purchase_id,answer) VALUES (?,?)').run(record.intent.id, answer);
      if (result.changes) this.event(record.intent.id, 'task.ANSWERED');
    });
  }
  claim(approvalId: string, now = this.now(), validate?: (record: PurchaseRecord) => void, expectedMode?: PurchaseExecutionMode): SpendReservation {
    return this.atomic(() => {
      if (this.stopping) throw new Error('Service is stopping');
      const row = this.db.prepare('SELECT task_id FROM purchases WHERE approval_id=?').get(approvalId);
      if (!row) throw new Error('Unknown approval');
      const record = this.get(String(row.task_id))!;
      if (expectedMode && record.executionMode !== expectedMode) throw new Error('PURCHASE_EXECUTION_MODE_MISMATCH');
      if (record.status !== 'APPROVED' || record.decision.decision !== 'APPROVED' || record.intent.expiresAt <= now) throw new Error('Approval inactive or expired');
      validate?.(record);
      if (this.managed) {
        const controls = this.controls();
        if (controls.paused) throw new Error('Payments are paused');
        if (controls.dailyBudget === null) throw new Error('Daily limit is not set');
        const modeFilter = accountingModeFilter(record.executionMode);
        const committed = Number(this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM purchases WHERE (status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN') OR (status='PAID' AND confirmed_day=?))${modeFilter}`).get(this.activeDay(now))!.total);
        if (committed > controls.dailyBudget) throw new Error('Daily limit no longer covers reserved payments');
        if (this.requireSpendGrant) this.assertGrantCovers(record, now);
      }
      const modeFilter = accountingModeFilter(record.executionMode);
      if (this.db.prepare(`SELECT id FROM purchases WHERE status IN ('PAYING','PAYMENT_UNKNOWN')${modeFilter} LIMIT 1`).get()) throw new Error('Another payment requires reconciliation');
      this.db.prepare("UPDATE purchases SET status='PAYING' WHERE approval_id=? AND status='APPROVED'").run(approvalId);
      this.event(record.intent.id, 'payment.PAYING');
      return this.get(record.intent.idempotencyKey)!;
    });
  }
  savePayload(approvalId: string, payload: unknown, validate?: (record: PurchaseRecord) => void) {
    this.atomic(() => {
      this.assertCanSign(approvalId, undefined, validate);
      if (this.db.prepare("UPDATE purchases SET payload=? WHERE approval_id=? AND status='PAYING' AND payload IS NULL").run(JSON.stringify(payload), approvalId).changes !== 1) throw new Error('Payment already signed or inactive');
    });
  }
  savedPayload(approvalId: string): PaymentPayload | undefined {
    const row = this.db.prepare('SELECT payload FROM purchases WHERE approval_id=?').get(approvalId);
    return row?.payload ? JSON.parse(String(row.payload)) : undefined;
  }
  failUnsubmitted(approvalId: string) {
    this.atomic(() => {
      const row = this.db.prepare("UPDATE purchases SET status='FAILED' WHERE approval_id=? AND status='PAYING' AND payload IS NULL RETURNING id").get(approvalId);
      if (row) this.event(String(row.id), 'payment.FAILED_BEFORE_SUBMISSION');
    });
  }
  failConfirmed(approvalId: string, transaction: string) {
    this.atomic(() => {
      const row = this.db.prepare("UPDATE purchases SET status='FAILED',transaction_id=? WHERE approval_id=? AND status IN ('PAYING','PAYMENT_UNKNOWN') RETURNING id").get(transaction, approvalId);
      if (row) this.event(String(row.id), 'payment.FAILED_ON_CHAIN');
    });
  }
  private recordConfirmation(approvalId: string, transaction: string, verification: PaymentVerification, now: number) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(transaction) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(verification.payer)
      || !/^[a-f0-9]{64}$/.test(verification.messageHash)
      || verification.settlementConfirmed !== true || !['confirmed', 'finalized'].includes(verification.confirmationStatus)) {
      throw new Error('LIVE_PAYMENT_EVIDENCE_INVALID');
    }
    const row = this.db.prepare('SELECT task_id,payload,payment_evidence,status,execution_mode FROM purchases WHERE approval_id=?').get(approvalId);
    if (!row) throw new Error('Unknown approval');
    const record = this.get(String(row.task_id));
    if (!record || record.executionMode === 'simulated' || !row.payload) throw new Error('LIVE_PAYMENT_EVIDENCE_INVALID');
    let payload: unknown;
    try { payload = JSON.parse(String(row.payload)); } catch { throw new Error('LIVE_PAYMENT_EVIDENCE_INVALID'); }
    if (!payload || typeof payload !== 'object' || !('accepted' in payload)
      || hash(payload.accepted) !== record.intent.quoteFingerprint) throw new Error('LIVE_PAYMENT_EVIDENCE_INVALID');
    if (row.status === 'PAID') {
      if (record.transaction === transaction && this.hasVerifiedPaymentProof(record)) return;
      throw new Error('Payment cannot be confirmed from this state');
    }
    const evidence = PaymentEvidenceSchema.parse({ version: 2, payloadHash: hash(payload), messageHash: verification.messageHash,
      quoteFingerprint: record.intent.quoteFingerprint, transaction, payer: verification.payer, confirmationStatus: verification.confirmationStatus,
      settlementConfirmed: true, verifiedAt: now });
    const updated = this.db.prepare("UPDATE purchases SET status='PAID',transaction_id=?,confirmed_day=?,payment_evidence=? WHERE approval_id=? AND status IN ('PAYING','PAYMENT_UNKNOWN') RETURNING id")
      .get(transaction, this.activeDay(now), JSON.stringify(evidence), approvalId);
    if (!updated) throw new Error('Payment cannot be confirmed from this state');
    this.event(String(updated.id), 'payment.PAID');
  }
  confirmPayment(approvalId: string, transaction: string, verification: PaymentVerification, now = Date.now()) {
    this.atomic(() => this.recordConfirmation(approvalId, transaction, verification, now));
  }
  finish(approvalId: string, result: { transaction: string; data: MarketSnapshotOutput }, now = Date.now()) {
    this.atomic(() => {
      const data = MarketSnapshotOutputSchema.parse(result.data);
      const row = this.db.prepare('SELECT task_id,status,execution_mode FROM purchases WHERE approval_id=?').get(approvalId);
      if (!row) throw new Error('Unknown approval');
      const record = this.get(String(row.task_id));
      if (record?.executionMode === 'simulated') {
        if (!result.transaction.startsWith('simulated-') || !['PAYING', 'PAID'].includes(record.status)) throw new Error('Simulated purchase cannot be completed from this state');
        if (record.status !== 'PAID') {
          const paid = this.db.prepare("UPDATE purchases SET status='PAID',transaction_id=?,confirmed_day=? WHERE approval_id=? AND status='PAYING' RETURNING id")
            .get(result.transaction, this.activeDay(now), approvalId);
          if (!paid) throw new Error('Simulated purchase cannot be completed from this state');
          this.event(String(paid.id), 'payment.PAID');
        } else if (record.transaction !== result.transaction) throw new Error('Simulated transaction changed');
      } else if (!record || record.status !== 'PAID' || !this.hasVerifiedPaymentProof(record)) {
        throw new Error('LIVE_PAYMENT_EVIDENCE_INVALID');
      }
      const saved = this.db.prepare('UPDATE purchases SET data=? WHERE approval_id=? AND data IS NULL RETURNING id').get(JSON.stringify(data), approvalId);
      if (saved) this.event(String(saved.id), 'delivery.COMPLETE');
    });
  }
  unknown(approvalId: string, transaction?: string) {
    this.atomic(() => {
      const row = this.db.prepare("UPDATE purchases SET status='PAYMENT_UNKNOWN',transaction_id=COALESCE(?,transaction_id) WHERE approval_id=? AND status='PAYING' RETURNING id").get(transaction ?? null, approvalId);
      if (row) this.event(String(row.id), 'payment.PAYMENT_UNKNOWN');
    });
  }
  summary(now = Date.now(), mode?: StoredPurchaseExecutionMode) {
    const modeFilter = accountingModeFilter(mode);
    const paid = Number(this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS n FROM purchases WHERE status='PAID' AND confirmed_day=?${modeFilter}`).get(this.atomic(() => this.activeDay(now)))!.n);
    const reserved = Number(this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS n FROM purchases WHERE status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN')${modeFilter}`).get()!.n);
    const unresolved = Number(this.db.prepare(`SELECT COUNT(*) AS n FROM purchases WHERE status IN ('PAYING','PAYMENT_UNKNOWN')${modeFilter}`).get()!.n);
    const controls = this.controls();
    const remaining = controls.dailyBudget === null ? null : Math.max(0, controls.dailyBudget - paid - reserved);
    return { paidUSDC: paid / 1_000_000, reservedUSDC: reserved / 1_000_000, remainingUSDC: remaining === null ? 0 : remaining / 1_000_000, unresolved };
  }
  managedSummary(now = Date.now(), mode?: StoredPurchaseExecutionMode) {
    const day = this.atomic(() => this.activeDay(now));
    const modeFilter = accountingModeFilter(mode);
    const paid = Number(this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS n FROM purchases WHERE status='PAID' AND confirmed_day=?${modeFilter}`).get(day)!.n);
    const reserved = Number(this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS n FROM purchases WHERE status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN')${modeFilter}`).get()!.n);
    const controls = this.controls();
    return { day, timeZone: this.timeZone(), dailyLimit: controls.dailyBudget === null ? null : String(controls.dailyBudget),
      paid: String(paid), reserved: String(reserved), remaining: controls.dailyBudget === null ? null : String(Math.max(0, controls.dailyBudget - paid - reserved)), paused: controls.paused,
      unresolved: Number(this.db.prepare(`SELECT COUNT(*) AS n FROM purchases WHERE status IN ('PAYING','PAYMENT_UNKNOWN')${modeFilter}`).get()!.n) };
  }
  list(limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid record limit');
    return this.db.prepare(`SELECT task_id,status,amount,transaction_id,data IS NOT NULL AS delivered,json_extract(purchase,'$.createdAt') AS created_at,
      json_extract(purchase,'$.offerId') AS offer_id,json_extract(purchase,'$.reason') AS reason,json_extract(decision,'$.reason') AS decision_reason,
      json_extract(purchase,'$.authority.grantId') AS grant_id FROM purchases ORDER BY created_at DESC LIMIT ?`).all(limit)
      .map(row => ({ purchaseId: String(row.task_id), status: currentAuthorityStatus(String(row.status)), deliveryStatus: row.status === 'PAID' ? (row.delivered ? 'COMPLETE' : 'PENDING') : 'NOT_PAID',
        amount: String(row.amount), createdAt: Number(row.created_at), transaction: row.transaction_id ? String(row.transaction_id) : null,
        ...(row.offer_id ? { offerId: String(row.offer_id) } : {}), ...(row.reason ? { reason: String(row.reason) } : {}),
        ...(row.decision_reason ? { decisionReason: String(row.decision_reason) } : {}), ...(row.grant_id ? { grantId: String(row.grant_id) } : {}) }));
  }
  events(taskId: string) { return this.db.prepare('SELECT e.sequence,e.type,e.at FROM purchase_events e JOIN purchases p ON p.id=e.purchase_id WHERE p.task_id=? ORDER BY e.sequence').all(taskId); }
  private denied(reason: string, committed: number, controls: SpendingControls): AuthorityDecision {
    return { decision: 'DENIED', reason, committedBefore: committed, remainingAfter: controls.dailyBudget === null ? 0 : Math.max(0, controls.dailyBudget - committed) };
  }
  private evaluateGrant(intent: SpendIntent, base: AuthorityDecision, committed: number, controls: SpendingControls, now: number, mode: StoredPurchaseExecutionMode): AuthorityDecision {
    const binding = intent.authority;
    if (!binding) return this.denied('SPEND_GRANT_REQUIRED', committed, controls);
    if (!this.isCardMemberActive(binding.cardMemberId)) return this.denied('CARD_MEMBER_REVOKED', committed, controls);
    this.expireGrants(now);
    const grant = this.grantById(binding.grantId);
    if (!grant) return this.denied('SPEND_GRANT_INACTIVE', committed, controls);
    if (grant.status === 'REVOKED') return this.denied('SPEND_GRANT_REVOKED', committed, controls);
    if (grant.status === 'EXPIRED' || grant.expiresAt <= now) return this.denied('SPEND_GRANT_EXPIRED', committed, controls);
    if (grant.status !== 'ACTIVE') return this.denied('SPEND_GRANT_INACTIVE', committed, controls);
    if (grant.version !== binding.grantVersion || grant.cardMemberId !== binding.cardMemberId) return this.denied('SPEND_GRANT_PRINCIPAL_MISMATCH', committed, controls);
    if (grant.operation !== binding.operation || grant.operation !== MARKET_SNAPSHOT_OPERATION || grant.resourceId !== intent.resourceId || grant.providerId !== intent.providerId || grant.network !== intent.network || grant.assetId !== intent.assetId || grant.assetDecimals !== intent.assetDecimals || grant.payTo !== intent.payTo || grant.paymentScheme !== intent.paymentScheme) {
      return this.denied('SPEND_GRANT_SCOPE_MISMATCH', committed, controls);
    }
    if (intent.amount > grant.singleLimit) return this.denied('SPEND_GRANT_SINGLE_LIMIT_EXCEEDED', committed, controls);
    const grantCommitted = this.grantCommitted(grant.id, mode);
    if (!Number.isSafeInteger(grantCommitted) || grantCommitted < 0 || !Number.isSafeInteger(grantCommitted + intent.amount)) return this.denied('SPEND_GRANT_ACCOUNTING_INVALID', committed, controls);
    if (grantCommitted + intent.amount > grant.totalLimit) return this.denied('SPEND_GRANT_TOTAL_LIMIT_EXCEEDED', committed, controls);
    if (base.decision === 'REQUIRES_APPROVAL' && base.reason === 'SINGLE_LIMIT_EXCEEDED') {
      return { decision: 'APPROVED', reason: 'AUTHORITY_BUDGET_AND_GRANT_PASSED', committedBefore: base.committedBefore, remainingAfter: base.remainingAfter };
    }
    return base.decision === 'APPROVED' ? { ...base, reason: 'AUTHORITY_BUDGET_AND_GRANT_PASSED' } : base;
  }
  private assertGrantCovers(record: SpendReservation, now: number) {
    const binding = record.intent.authority;
    if (!binding) throw new Error('Spend grant is missing');
    this.assertCardMemberActive(binding.cardMemberId);
    const grant = this.grantById(binding.grantId);
    if (!grant || grant.status !== 'ACTIVE' || grant.expiresAt <= now) throw new Error('Spend grant is inactive or expired');
    if (grant.version !== binding.grantVersion || grant.cardMemberId !== binding.cardMemberId || grant.operation !== binding.operation) {
      throw new Error('Spend grant principal changed');
    }
    const intent = record.intent;
    if (grant.operation !== MARKET_SNAPSHOT_OPERATION || grant.resourceId !== intent.resourceId || grant.providerId !== intent.providerId ||
      grant.network !== intent.network || grant.assetId !== intent.assetId || grant.assetDecimals !== intent.assetDecimals ||
      grant.payTo !== intent.payTo || grant.paymentScheme !== intent.paymentScheme || intent.amount > grant.singleLimit) {
      throw new Error('Spend grant scope or single limit changed');
    }
    const committed = this.grantCommitted(grant.id, record.executionMode);
    if (!Number.isSafeInteger(committed) || committed < 0 || committed > grant.totalLimit) throw new Error('Spend grant no longer covers reserved payments');
  }
  close() { this.db.close(); }
}

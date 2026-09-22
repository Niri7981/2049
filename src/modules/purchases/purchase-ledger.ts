import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { DEFAULT_SPENDING_POLICY, evaluateSpendAuthority, parseStoredAuthorityDecision, type AuthorityDecision, type SpendingControls } from '../authority/authority-policy';
import { parseStoredSpendIntent, type SpendIntent } from '../authority/spend-intent';
import { MARKET_SNAPSHOT_OPERATION, SpendGrantInputSchema, SpendGrantSchema, SpendGrantScopeSchema, SpendPrincipalSchema, parseGrantAmount, type SpendAuthorityBinding, type SpendGrant, type SpendGrantInput, type SpendGrantScope, type SpendPrincipal } from '../authority/spend-grant';
import { MarketSnapshotOutputSchema, type MarketSnapshotOutput } from '../resources/resource-schema';
import { nextSpendingDayBoundary, spendingDay } from './spending-policy';

export type DeliveryStatus = 'NOT_PAID' | 'PENDING' | 'COMPLETE';
export type SpendReservation = { intent: SpendIntent; quote: PaymentRequirements; approvalId: string; decision: AuthorityDecision; status: string; deliveryStatus: DeliveryStatus; transaction?: string; data?: MarketSnapshotOutput; answer?: string };
/** Compatibility name for callers that still expose the market purchase use case. */
export type PurchaseRecord = SpendReservation;
export type PurchaseLedgerOptions = { managed?: boolean; requireSpendGrant?: boolean; timeZone?: () => string; now?: () => number };
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
/** SQLite owns approval, budget reservation and the unique task purchase. No model writes. */
export class PurchaseLedger {
  private db: DatabaseSync;
  private managed: boolean;
  private requireSpendGrant: boolean;
  private timeZone: () => string;
  private now: () => number;
  private stopping = false;
  constructor(path = '.data/day5-ledger.sqlite', options: PurchaseLedgerOptions = {}) {
    this.managed = options.managed ?? false;
    this.requireSpendGrant = options.requireSpendGrant ?? false;
    if (this.requireSpendGrant && !this.managed) throw new Error('Spend grant enforcement requires a managed ledger');
    this.timeZone = options.timeZone ?? (() => 'Asia/Shanghai');
    this.now = options.now ?? Date.now;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, approval_id TEXT NOT NULL UNIQUE,
        purchase TEXT NOT NULL, quote TEXT NOT NULL, decision TEXT NOT NULL, status TEXT NOT NULL,
        amount INTEGER NOT NULL, confirmed_day TEXT, transaction_id TEXT, data TEXT, payload TEXT);
      CREATE TABLE IF NOT EXISTS purchase_answers (purchase_id TEXT PRIMARY KEY, answer TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS purchase_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id TEXT NOT NULL, type TEXT NOT NULL, at INTEGER NOT NULL);`);
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
        COMMIT;`);
      const now = this.now(); const zone = this.timeZone();
      this.db.prepare('INSERT OR IGNORE INTO app_budget_clock (id,spending_day,time_zone,next_boundary,last_seen) VALUES (1,?,?,?,?)')
        .run(spendingDay(now, zone), zone, nextSpendingDayBoundary(now, zone), now);
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
      id: String(row.id), version: Number(row.version), connectionId: String(row.connection_id), connectionGeneration: Number(row.connection_generation),
      resourceId: String(row.resource_id), providerId: String(row.provider_id), operation: String(row.operation), network: String(row.network), assetId: String(row.asset_id),
      assetDecimals: Number(row.asset_decimals), payTo: String(row.pay_to), paymentScheme: String(row.payment_scheme), totalLimit: Number(row.total_limit), singleLimit: Number(row.single_limit), status: String(row.status),
      createdAt: Number(row.created_at), expiresAt: Number(row.expires_at), revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    });
  }
  private grantById(id: string) {
    const row = this.db.prepare('SELECT * FROM spend_grants WHERE id=?').get(id);
    return row ? this.parseGrantRow(row) : undefined;
  }
  private grantCommitted(id: string) {
    return Number(this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM purchases
      WHERE json_extract(purchase,'$.authority.grantId')=? AND status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN','PAID')`).get(id)!.total);
  }
  createSpendGrant(raw: SpendGrantInput, rawPrincipal: SpendPrincipal, rawScope: SpendGrantScope, now = this.now()) {
    if (!this.managed) throw new Error('Spend grants require a managed ledger');
    const input = SpendGrantInputSchema.parse(raw); const principal = SpendPrincipalSchema.parse(rawPrincipal); const scope = SpendGrantScopeSchema.parse(rawScope);
    const totalLimit = parseGrantAmount(input.totalLimit, 'totalLimit'); const singleLimit = parseGrantAmount(input.singleLimit, 'singleLimit');
    if (singleLimit > totalLimit) throw new Error('单笔上限不能大于授权总额。');
    if (input.expiresAt <= now + 60_000 || input.expiresAt > now + 7 * 24 * 60 * 60 * 1000) throw new Error('授权有效期必须在 1 分钟到 7 天之间。');
    return this.atomic(() => {
      this.expireGrants(now);
      const previous = this.db.prepare("UPDATE spend_grants SET status='REVOKED',revoked_at=? WHERE status='ACTIVE' RETURNING id").all(now);
      for (const row of previous) this.grantEvent(String(row.id), 'grant.REVOKED_REPLACED', now);
      const version = Number(this.db.prepare('SELECT COALESCE(MAX(version),0)+1 AS version FROM spend_grants').get()!.version);
      const id = randomUUID();
      this.db.prepare(`INSERT INTO spend_grants (id,version,connection_id,connection_generation,resource_id,provider_id,operation,network,asset_id,asset_decimals,pay_to,payment_scheme,total_limit,single_limit,status,created_at,expires_at,revoked_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE',?,?,NULL)`).run(id, version, principal.connectionId, principal.connectionGeneration, scope.resourceId, scope.providerId,
        scope.operation, scope.network, scope.assetId, scope.assetDecimals, scope.payTo, scope.paymentScheme, totalLimit, singleLimit, now, input.expiresAt);
      this.grantEvent(id, 'grant.CREATED', now);
      return this.latestGrantSummary(now)!;
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
    if (!grant || grant.connectionId !== parsed.connectionId || grant.connectionGeneration !== parsed.connectionGeneration || grant.operation !== operation) {
      throw new Error('当前 Agent 连接没有可用的消费授权。');
    }
    return { grantId: grant.id, grantVersion: grant.version, connectionId: parsed.connectionId, connectionGeneration: parsed.connectionGeneration, operation };
  }
  spendGrantSummary(now = this.now()): SpendGrantSummary | null {
    if (!this.managed) return null;
    return this.atomic(() => this.latestGrantSummary(now));
  }
  private latestGrantSummary(now: number): SpendGrantSummary | null {
    this.expireGrants(now);
    const row = this.db.prepare('SELECT * FROM spend_grants ORDER BY version DESC LIMIT 1').get();
    if (!row) return null;
    const grant = this.parseGrantRow(row); const committed = this.grantCommitted(grant.id);
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
    if (record?.status !== 'PAYING' || record.intent.expiresAt <= now) throw new Error('Approval inactive or expired');
    validate?.(record);
    if (this.managed) {
      const controls = this.controls();
      if (controls.paused) throw new Error('Payments were paused before submission');
      const committed = Number(this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM purchases WHERE status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN') OR (status='PAID' AND confirmed_day=?)`).get(this.activeDay(now))!.total);
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
    return { intent: parseStoredSpendIntent(JSON.parse(String(row.purchase))), quote: JSON.parse(String(row.quote)), approvalId: String(row.approval_id), decision: parseStoredAuthorityDecision(JSON.parse(String(row.decision))), status: currentAuthorityStatus(String(row.status)),
      deliveryStatus: row.status === 'PAID' ? (row.data ? 'COMPLETE' : 'PENDING') : 'NOT_PAID',
      ...(this.db.prepare("SELECT answer FROM purchase_answers WHERE purchase_id=?").get(String(row.id)) as { answer: string } | undefined),
      ...(row.transaction_id ? { transaction: String(row.transaction_id) } : {}),
      ...(row.data ? { data: MarketSnapshotOutputSchema.parse(JSON.parse(String(row.data))) } : {}) };
  }
  reserve(intent: SpendIntent, quote: PaymentRequirements, now = Date.now()): SpendReservation {
    return this.atomic(() => {
      this.expireUnclaimed(now);
      const existing = this.get(intent.idempotencyKey);
      if (existing) {
        if (this.requireSpendGrant && (existing.intent.authority?.connectionId !== intent.authority?.connectionId ||
          existing.intent.authority?.connectionGeneration !== intent.authority?.connectionGeneration)) {
          throw new Error('PURCHASE_REQUEST_OWNER_MISMATCH');
        }
        if (existing.intent.requestHash !== intent.requestHash || existing.intent.executionBinding !== intent.executionBinding) throw new Error('Idempotency key belongs to another request or execution configuration');
        return existing;
      }
      const row = this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM purchases WHERE status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN') OR (status='PAID' AND confirmed_day=?)`).get(this.activeDay(now))!;
      const unresolved = this.db.prepare(`SELECT id FROM purchases WHERE status IN ('PAYING','PAYMENT_UNKNOWN') LIMIT 1`).get();
      const controls = this.controls();
      let decision = evaluateSpendAuthority(intent, { committed: Number(row.total), hasUnknownPayment: Boolean(unresolved) }, now, controls);
      if (this.requireSpendGrant) decision = this.evaluateGrant(intent, decision, Number(row.total), controls, now);
      this.db.prepare('INSERT INTO purchases (id,task_id,approval_id,purchase,quote,decision,status,amount) VALUES (?,?,?,?,?,?,?,?)')
        .run(intent.id, intent.idempotencyKey, randomUUID(), JSON.stringify(intent), JSON.stringify(quote), JSON.stringify(decision), decision.decision, intent.amount);
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
  claim(approvalId: string, now = this.now(), validate?: (record: PurchaseRecord) => void): SpendReservation {
    return this.atomic(() => {
      if (this.stopping) throw new Error('Service is stopping');
      const row = this.db.prepare('SELECT task_id FROM purchases WHERE approval_id=?').get(approvalId);
      if (!row) throw new Error('Unknown approval');
      const record = this.get(String(row.task_id))!;
      if (record.status !== 'APPROVED' || record.decision.decision !== 'APPROVED' || record.intent.expiresAt <= now) throw new Error('Approval inactive or expired');
      validate?.(record);
      if (this.managed) {
        const controls = this.controls();
        if (controls.paused) throw new Error('Payments are paused');
        if (controls.dailyBudget === null) throw new Error('Daily limit is not set');
        const committed = Number(this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM purchases WHERE status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN') OR (status='PAID' AND confirmed_day=?)`).get(this.activeDay(now))!.total);
        if (committed > controls.dailyBudget) throw new Error('Daily limit no longer covers reserved payments');
        if (this.requireSpendGrant) this.assertGrantCovers(record, now);
      }
      if (this.db.prepare("SELECT id FROM purchases WHERE status IN ('PAYING','PAYMENT_UNKNOWN') LIMIT 1").get()) throw new Error('Another payment requires reconciliation');
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
  private recordConfirmation(approvalId: string, transaction: string, now: number) {
    const existing = this.db.prepare('SELECT status,transaction_id FROM purchases WHERE approval_id=?').get(approvalId);
    if (existing?.status === 'PAID' && existing.transaction_id === transaction) return;
    const row = this.db.prepare("UPDATE purchases SET status='PAID',transaction_id=?,confirmed_day=? WHERE approval_id=? AND status IN ('PAYING','PAYMENT_UNKNOWN') RETURNING id")
      .get(transaction, this.activeDay(now), approvalId);
    if (!row) throw new Error('Payment cannot be confirmed from this state');
    this.event(String(row.id), 'payment.PAID');
  }
  confirmPayment(approvalId: string, transaction: string, now = Date.now()) {
    this.atomic(() => this.recordConfirmation(approvalId, transaction, now));
  }
  finish(approvalId: string, result: { transaction: string; data: MarketSnapshotOutput }, now = Date.now()) {
    this.atomic(() => {
      this.recordConfirmation(approvalId, result.transaction, now);
      const data = MarketSnapshotOutputSchema.parse(result.data);
      const row = this.db.prepare('UPDATE purchases SET data=? WHERE approval_id=? AND data IS NULL RETURNING id').get(JSON.stringify(data), approvalId);
      if (row) this.event(String(row.id), 'delivery.COMPLETE');
    });
  }
  unknown(approvalId: string, transaction?: string) {
    this.atomic(() => {
      const row = this.db.prepare("UPDATE purchases SET status='PAYMENT_UNKNOWN',transaction_id=COALESCE(?,transaction_id) WHERE approval_id=? AND status='PAYING' RETURNING id").get(transaction ?? null, approvalId);
      if (row) this.event(String(row.id), 'payment.PAYMENT_UNKNOWN');
    });
  }
  summary(now = Date.now()) {
    const paid = Number(this.db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM purchases WHERE status='PAID' AND confirmed_day=?").get(this.atomic(() => this.activeDay(now)))!.n);
    const reserved = Number(this.db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM purchases WHERE status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN')").get()!.n);
    const unresolved = Number(this.db.prepare("SELECT COUNT(*) AS n FROM purchases WHERE status IN ('PAYING','PAYMENT_UNKNOWN')").get()!.n);
    const controls = this.controls();
    const remaining = controls.dailyBudget === null ? null : Math.max(0, controls.dailyBudget - paid - reserved);
    return { paidUSDC: paid / 1_000_000, reservedUSDC: reserved / 1_000_000, remainingUSDC: remaining === null ? 0 : remaining / 1_000_000, unresolved };
  }
  managedSummary(now = Date.now()) {
    const day = this.atomic(() => this.activeDay(now));
    const paid = Number(this.db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM purchases WHERE status='PAID' AND confirmed_day=?").get(day)!.n);
    const reserved = Number(this.db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM purchases WHERE status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN')").get()!.n);
    const controls = this.controls();
    return { day, timeZone: this.timeZone(), dailyLimit: controls.dailyBudget === null ? null : String(controls.dailyBudget),
      paid: String(paid), reserved: String(reserved), remaining: controls.dailyBudget === null ? null : String(Math.max(0, controls.dailyBudget - paid - reserved)), paused: controls.paused,
      unresolved: Number(this.db.prepare("SELECT COUNT(*) AS n FROM purchases WHERE status IN ('PAYING','PAYMENT_UNKNOWN')").get()!.n) };
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
  private evaluateGrant(intent: SpendIntent, base: AuthorityDecision, committed: number, controls: SpendingControls, now: number): AuthorityDecision {
    const binding = intent.authority;
    if (!binding) return this.denied('SPEND_GRANT_REQUIRED', committed, controls);
    this.expireGrants(now);
    const grant = this.grantById(binding.grantId);
    if (!grant || grant.status !== 'ACTIVE') return this.denied('SPEND_GRANT_INACTIVE', committed, controls);
    if (grant.expiresAt <= now) return this.denied('SPEND_GRANT_EXPIRED', committed, controls);
    if (grant.version !== binding.grantVersion || grant.connectionId !== binding.connectionId || grant.connectionGeneration !== binding.connectionGeneration) return this.denied('SPEND_GRANT_PRINCIPAL_MISMATCH', committed, controls);
    if (grant.operation !== binding.operation || grant.operation !== MARKET_SNAPSHOT_OPERATION || grant.resourceId !== intent.resourceId || grant.providerId !== intent.providerId || grant.network !== intent.network || grant.assetId !== intent.assetId || grant.assetDecimals !== intent.assetDecimals || grant.payTo !== intent.payTo || grant.paymentScheme !== intent.paymentScheme) {
      return this.denied('SPEND_GRANT_SCOPE_MISMATCH', committed, controls);
    }
    if (intent.amount > grant.singleLimit) return this.denied('SPEND_GRANT_SINGLE_LIMIT_EXCEEDED', committed, controls);
    const grantCommitted = this.grantCommitted(grant.id);
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
    const grant = this.grantById(binding.grantId);
    if (!grant || grant.status !== 'ACTIVE' || grant.expiresAt <= now) throw new Error('Spend grant is inactive or expired');
    if (grant.version !== binding.grantVersion || grant.connectionId !== binding.connectionId || grant.connectionGeneration !== binding.connectionGeneration || grant.operation !== binding.operation) {
      throw new Error('Spend grant principal changed');
    }
    const intent = record.intent;
    if (grant.operation !== MARKET_SNAPSHOT_OPERATION || grant.resourceId !== intent.resourceId || grant.providerId !== intent.providerId ||
      grant.network !== intent.network || grant.assetId !== intent.assetId || grant.assetDecimals !== intent.assetDecimals ||
      grant.payTo !== intent.payTo || grant.paymentScheme !== intent.paymentScheme || intent.amount > grant.singleLimit) {
      throw new Error('Spend grant scope or single limit changed');
    }
    const committed = this.grantCommitted(grant.id);
    if (!Number.isSafeInteger(committed) || committed < 0 || committed > grant.totalLimit) throw new Error('Spend grant no longer covers reserved payments');
  }
  close() { this.db.close(); }
}

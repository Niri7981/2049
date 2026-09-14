import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import type { ResourceMetadata, MarketSnapshotOutput } from '../resources/resource-schema';
import { evaluatePurchase, nextSpendingDayBoundary, spendingDay, POLICY, type Purchase, type PolicyDecision, type SpendingControls } from './spending-policy';

export type PurchaseRecord = { purchase: Purchase; quote: PaymentRequirements; approvalId: string; decision: PolicyDecision; status: string; transaction?: string; data?: MarketSnapshotOutput; answer?: string };
export type PurchaseLedgerOptions = { managed?: boolean; timeZone?: () => string; now?: () => number };
/** SQLite owns approval, budget reservation and the unique task purchase. No model writes. */
export class PurchaseLedger {
  private db: DatabaseSync;
  private managed: boolean;
  private timeZone: () => string;
  private now: () => number;
  constructor(path = '.data/day5-ledger.sqlite', options: PurchaseLedgerOptions = {}) {
    this.managed = options.managed ?? false;
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
        INSERT OR IGNORE INTO app_schema_migrations (id,applied_at) VALUES ('001_app_controls',unixepoch('now') * 1000);
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
    if (!this.managed) return { dailyBudget: POLICY.dailyBudget, paused: false, singleLimit: POLICY.singleLimit };
    const row = this.db.prepare('SELECT daily_limit,paused FROM app_settings WHERE id=1').get()!;
    return { dailyBudget: row.daily_limit === null ? null : Number(row.daily_limit), paused: Boolean(row.paused), singleLimit: POLICY.singleLimit };
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
  get(taskId: string): PurchaseRecord | undefined {
    const row = this.db.prepare('SELECT * FROM purchases WHERE task_id=?').get(taskId);
    if (!row) return undefined;
    return { purchase: JSON.parse(String(row.purchase)), quote: JSON.parse(String(row.quote)), approvalId: String(row.approval_id), decision: JSON.parse(String(row.decision)), status: String(row.status),
      ...(this.db.prepare("SELECT answer FROM purchase_answers WHERE purchase_id=?").get(String(row.id)) as { answer: string } | undefined),
      ...(row.transaction_id ? { transaction: String(row.transaction_id) } : {}), ...(row.data ? { data: JSON.parse(String(row.data)) } : {}) };
  }
  reserve(purchase: Purchase, quote: PaymentRequirements, resource: ResourceMetadata, now = Date.now()): PurchaseRecord {
    return this.atomic(() => {
      this.expireUnclaimed(now);
      const existing = this.get(purchase.taskId);
      if (existing) {
        if (existing.purchase.taskHash !== purchase.taskHash || existing.purchase.binding !== purchase.binding) throw new Error('Task ID belongs to another task or wallet configuration');
        return existing;
      }
      const row = this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM purchases WHERE status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN') OR (status='PAID' AND confirmed_day=?)`).get(this.activeDay(now))!;
      const unresolved = this.db.prepare(`SELECT id FROM purchases WHERE status IN ('PAYING','PAYMENT_UNKNOWN') LIMIT 1`).get();
      const decision = evaluatePurchase(purchase, resource, quote, { committed: Number(row.total), hasUnknown: Boolean(unresolved) }, now, this.controls());
      this.db.prepare('INSERT INTO purchases (id,task_id,approval_id,purchase,quote,decision,status,amount) VALUES (?,?,?,?,?,?,?,?)')
        .run(purchase.id, purchase.taskId, randomUUID(), JSON.stringify(purchase), JSON.stringify(quote), JSON.stringify(decision), decision.decision, purchase.amount);
      this.event(purchase.id, `policy.${decision.decision}`);
      return this.get(purchase.taskId)!;
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
      const result = this.db.prepare('INSERT OR IGNORE INTO purchase_answers (purchase_id,answer) VALUES (?,?)').run(record.purchase.id, answer);
      if (result.changes) this.event(record.purchase.id, 'task.ANSWERED');
    });
  }
  claim(approvalId: string, now = Date.now()): PurchaseRecord {
    return this.atomic(() => {
      const row = this.db.prepare('SELECT task_id FROM purchases WHERE approval_id=?').get(approvalId);
      if (!row) throw new Error('Unknown approval');
      const record = this.get(String(row.task_id))!;
      if (record.status !== 'APPROVED' || record.decision.decision !== 'APPROVED' || record.purchase.expiresAt <= now) throw new Error('Approval inactive or expired');
      if (this.managed) {
        const controls = this.controls();
        if (controls.paused) throw new Error('Payments are paused');
        if (controls.dailyBudget === null) throw new Error('Daily limit is not set');
        const committed = Number(this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM purchases WHERE status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN') OR (status='PAID' AND confirmed_day=?)`).get(this.activeDay(now))!.total);
        if (committed > controls.dailyBudget) throw new Error('Daily limit no longer covers reserved payments');
      }
      if (this.db.prepare("SELECT id FROM purchases WHERE status IN ('PAYING','PAYMENT_UNKNOWN') LIMIT 1").get()) throw new Error('Another payment requires reconciliation');
      this.db.prepare("UPDATE purchases SET status='PAYING' WHERE approval_id=? AND status='APPROVED'").run(approvalId);
      this.event(record.purchase.id, 'payment.PAYING');
      return this.get(record.purchase.taskId)!;
    });
  }
  savePayload(approvalId: string, payload: unknown) {
    this.atomic(() => {
      if (this.managed && this.controls().paused) throw new Error('Payments were paused before submission');
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
  finish(approvalId: string, result: { transaction: string; data: MarketSnapshotOutput }, now = Date.now()) {
    this.atomic(() => {
      const existing = this.db.prepare('SELECT status,transaction_id FROM purchases WHERE approval_id=?').get(approvalId);
      if (existing?.status === 'PAID' && existing.transaction_id === result.transaction) return;
      const row = this.db.prepare("UPDATE purchases SET status='PAID',transaction_id=?,data=?,confirmed_day=? WHERE approval_id=? AND status IN ('PAYING','PAYMENT_UNKNOWN') RETURNING id")
        .get(result.transaction, JSON.stringify(result.data), this.activeDay(now), approvalId);
      if (!row) throw new Error('Payment cannot be confirmed from this state');
      this.event(String(row.id), 'payment.PAID');
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
    return this.db.prepare('SELECT task_id,status,amount,transaction_id,json_extract(purchase,\'$.createdAt\') AS created_at FROM purchases ORDER BY created_at DESC LIMIT ?').all(limit)
      .map(row => ({ purchaseId: String(row.task_id), status: String(row.status), amount: String(row.amount), createdAt: Number(row.created_at), transaction: row.transaction_id ? String(row.transaction_id) : null }));
  }
  events(taskId: string) { return this.db.prepare('SELECT e.sequence,e.type,e.at FROM purchase_events e JOIN purchases p ON p.id=e.purchase_id WHERE p.task_id=? ORDER BY e.sequence').all(taskId); }
  close() { this.db.close(); }
}

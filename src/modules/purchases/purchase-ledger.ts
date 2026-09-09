import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PaymentRequirements } from '@x402/core/types';
import type { ResourceMetadata, MarketSnapshotOutput } from '../resources/resource-schema';
import { evaluatePurchase, spendingDay, type Purchase, type PolicyDecision } from './spending-policy';

export type PurchaseRecord = { purchase: Purchase; quote: PaymentRequirements; approvalId: string; decision: PolicyDecision; status: string; transaction?: string; data?: MarketSnapshotOutput };
/** SQLite owns approval, budget reservation and the unique task purchase. No model writes. */
export class PurchaseLedger {
  private db: DatabaseSync;
  constructor(path = '.data/day5-ledger.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, approval_id TEXT NOT NULL UNIQUE,
        purchase TEXT NOT NULL, quote TEXT NOT NULL, decision TEXT NOT NULL, status TEXT NOT NULL,
        amount INTEGER NOT NULL, confirmed_day TEXT, transaction_id TEXT, data TEXT, payload TEXT);
      CREATE TABLE IF NOT EXISTS purchase_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id TEXT NOT NULL, type TEXT NOT NULL, at INTEGER NOT NULL);`);
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private event(id: string, type: string) { this.db.prepare('INSERT INTO purchase_events (purchase_id,type,at) VALUES (?,?,?)').run(id, type, Date.now()); }
  get(taskId: string): PurchaseRecord | undefined {
    const row = this.db.prepare('SELECT * FROM purchases WHERE task_id=?').get(taskId);
    if (!row) return undefined;
    return { purchase: JSON.parse(String(row.purchase)), quote: JSON.parse(String(row.quote)), approvalId: String(row.approval_id), decision: JSON.parse(String(row.decision)), status: String(row.status),
      ...(row.transaction_id ? { transaction: String(row.transaction_id) } : {}), ...(row.data ? { data: JSON.parse(String(row.data)) } : {}) };
  }
  reserve(purchase: Purchase, quote: PaymentRequirements, resource: ResourceMetadata, now = Date.now()): PurchaseRecord {
    return this.atomic(() => {
      const existing = this.get(purchase.taskId);
      if (existing) {
        if (existing.purchase.taskHash !== purchase.taskHash || existing.purchase.binding !== purchase.binding) throw new Error('Task ID belongs to another task or wallet configuration');
        return existing;
      }
      const row = this.db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM purchases WHERE status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN') OR (status='PAID' AND confirmed_day=?)`).get(spendingDay(now))!;
      const unresolved = this.db.prepare(`SELECT id FROM purchases WHERE status IN ('PAYING','PAYMENT_UNKNOWN') LIMIT 1`).get();
      const decision = evaluatePurchase(purchase, resource, quote, { committed: Number(row.total), hasUnknown: Boolean(unresolved) }, now);
      this.db.prepare('INSERT INTO purchases (id,task_id,approval_id,purchase,quote,decision,status,amount) VALUES (?,?,?,?,?,?,?,?)')
        .run(purchase.id, purchase.taskId, randomUUID(), JSON.stringify(purchase), JSON.stringify(quote), JSON.stringify(decision), decision.decision, purchase.amount);
      this.event(purchase.id, `policy.${decision.decision}`);
      return this.get(purchase.taskId)!;
    });
  }
  claim(approvalId: string, now = Date.now()): PurchaseRecord {
    return this.atomic(() => {
      const row = this.db.prepare('SELECT task_id FROM purchases WHERE approval_id=?').get(approvalId);
      if (!row) throw new Error('Unknown approval');
      const record = this.get(String(row.task_id))!;
      if (record.status !== 'APPROVED' || record.decision.decision !== 'APPROVED' || record.purchase.expiresAt <= now) throw new Error('Approval inactive or expired');
      if (this.db.prepare("SELECT id FROM purchases WHERE status IN ('PAYING','PAYMENT_UNKNOWN') LIMIT 1").get()) throw new Error('Another payment requires reconciliation');
      this.db.prepare("UPDATE purchases SET status='PAYING' WHERE approval_id=? AND status='APPROVED'").run(approvalId);
      this.event(record.purchase.id, 'payment.PAYING');
      return this.get(record.purchase.taskId)!;
    });
  }
  savePayload(approvalId: string, payload: unknown) {
    if (this.db.prepare("UPDATE purchases SET payload=? WHERE approval_id=? AND status='PAYING' AND payload IS NULL").run(JSON.stringify(payload), approvalId).changes !== 1) throw new Error('Payment already signed or inactive');
  }
  finish(approvalId: string, result: { transaction: string; data: MarketSnapshotOutput }, now = Date.now()) {
    this.atomic(() => {
      const row = this.db.prepare("UPDATE purchases SET status='PAID',transaction_id=?,data=?,confirmed_day=? WHERE approval_id=? AND status='PAYING' RETURNING id")
        .get(result.transaction, JSON.stringify(result.data), spendingDay(now), approvalId);
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
  events(taskId: string) { return this.db.prepare('SELECT e.sequence,e.type,e.at FROM purchase_events e JOIN purchases p ON p.id=e.purchase_id WHERE p.task_id=? ORDER BY e.sequence').all(taskId); }
  close() { this.db.close(); }
}

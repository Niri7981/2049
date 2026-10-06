import type { DatabaseSync } from 'node:sqlite';
import { parseStoredSpendIntent } from '../authority/spend-intent';
import { persistedDeliveryCapability } from './delivery-state';

export function initializeDeliveryState(db: DatabaseSync, row: { id: string; purchase: string; owner?: string; status: string; executionMode?: string; delivered: boolean; receiptConfirmed: boolean }) {
  const capability = persistedDeliveryCapability(parseStoredSpendIntent(JSON.parse(row.purchase), row.owner));
  const state = row.status !== 'PAID' ? 'NOT_PAID' : row.delivered ? 'COMPLETE'
    : capability.kind === 'none' || row.executionMode !== 'live_devnet' ? 'UNSUPPORTED' : 'PENDING';
  db.prepare(`INSERT OR IGNORE INTO purchase_delivery (purchase_id,capability,state,receipt_state,last_error)
    VALUES (?,?,?,?,?)`).run(row.id, JSON.stringify(capability), state, row.receiptConfirmed ? 'CONFIRMED' : 'UNAVAILABLE',
      state === 'UNSUPPORTED' ? 'DELIVERY_RECOVERY_UNSUPPORTED' : null);
}

/** Additive state only: existing purchase, payment proof, amounts and grants remain intact. */
export function migrateDeliveryRecovery(db: DatabaseSync, now: number) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS purchase_delivery (
      purchase_id TEXT PRIMARY KEY REFERENCES purchases(id), capability TEXT NOT NULL CHECK(json_valid(capability)),
      state TEXT NOT NULL CHECK(state IN ('NOT_PAID','PENDING','DELIVERING','COMPLETE','EXHAUSTED','UNSUPPORTED')),
      receipt_state TEXT NOT NULL CHECK(receipt_state IN ('UNAVAILABLE','UNVERIFIED','CONFIRMED','FAILED','INVALID')),
      receipt TEXT CHECK(receipt IS NULL OR json_valid(receipt)),
      retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 4),
      initial_attempted INTEGER NOT NULL DEFAULT 0 CHECK(initial_attempted IN (0,1)),
      claim_token TEXT, claim_kind TEXT CHECK(claim_kind IN ('initial','retry')), claim_at INTEGER,
      next_attempt_at INTEGER NOT NULL DEFAULT 0 CHECK(next_attempt_at>=0), last_error TEXT,
      CHECK((state='DELIVERING' AND claim_token IS NOT NULL AND claim_kind IS NOT NULL AND claim_at IS NOT NULL)
        OR (state<>'DELIVERING' AND claim_token IS NULL AND claim_kind IS NULL AND claim_at IS NULL)));
      CREATE TRIGGER IF NOT EXISTS purchase_delivery_capability_immutable BEFORE UPDATE OF capability ON purchase_delivery
        WHEN NEW.capability IS NOT OLD.capability BEGIN SELECT RAISE(ABORT,'delivery capability is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS purchase_delivery_retry_monotonic BEFORE UPDATE OF retry_count ON purchase_delivery
        WHEN NEW.retry_count<OLD.retry_count OR NEW.retry_count>OLD.retry_count+1
        BEGIN SELECT RAISE(ABORT,'delivery retry count cannot reset'); END;
      CREATE TRIGGER IF NOT EXISTS purchase_delivery_payment_state AFTER UPDATE OF status ON purchases
        WHEN NEW.status='PAID' AND OLD.status<>'PAID'
        BEGIN UPDATE purchase_delivery SET state='PENDING',
          receipt_state=CASE WHEN json_valid(NEW.payment_evidence) AND json_extract(NEW.payment_evidence,'$.settlementConfirmed')=1 THEN 'CONFIRMED' ELSE receipt_state END
          WHERE purchase_id=NEW.id AND state='NOT_PAID'; END;`);
    for (const row of db.prepare(`SELECT p.id,p.purchase,p.owner_card_member_id,p.status,p.execution_mode,p.data,
      CASE WHEN json_valid(p.payment_evidence) THEN json_extract(p.payment_evidence,'$.settlementConfirmed') ELSE NULL END AS receipt_confirmed
      FROM purchases p LEFT JOIN purchase_delivery d ON d.purchase_id=p.id WHERE d.purchase_id IS NULL`).all()) {
      initializeDeliveryState(db, { id: String(row.id), purchase: String(row.purchase), owner: row.owner_card_member_id ? String(row.owner_card_member_id) : undefined,
        status: String(row.status), executionMode: row.execution_mode ? String(row.execution_mode) : undefined, delivered: row.data !== null, receiptConfirmed: row.receipt_confirmed === 1 });
    }
    db.prepare('INSERT OR IGNORE INTO ledger_schema_migrations VALUES (?,?)').run('009_durable_delivery_recovery', now);
    db.exec('COMMIT');
  } catch { db.exec('ROLLBACK'); throw new Error('DELIVERY_RECOVERY_MIGRATION_FAILED: existing records retained'); }
}

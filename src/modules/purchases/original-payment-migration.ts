import type { DatabaseSync } from 'node:sqlite';

/** Additive migration: old signed payloads remain possibly submitted, never rewritten. */
export function migrateOriginalPaymentEvidence(db: DatabaseSync, now: number) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT id FROM ledger_schema_migrations WHERE id='007_original_payment_evidence'").get()) { db.exec('COMMIT'); return; }
    db.exec(`CREATE TABLE original_payments (
      purchase_id TEXT PRIMARY KEY REFERENCES purchases(id), evidence TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('SIGNED_NOT_SUBMITTED','SUBMISSION_ATTEMPTED','OUTCOME_UNKNOWN','CONFIRMED','FINALIZED_FAILED','NOT_SUBMITTED')),
      submission_attempted_at INTEGER, transaction_id TEXT,
      CHECK((state IN ('SUBMISSION_ATTEMPTED','OUTCOME_UNKNOWN','CONFIRMED','FINALIZED_FAILED')) OR submission_attempted_at IS NULL));
      CREATE TABLE original_payment_signatures (purchase_id TEXT NOT NULL REFERENCES original_payments(purchase_id),
        signature TEXT NOT NULL, observed_at INTEGER NOT NULL, PRIMARY KEY(purchase_id,signature));
      CREATE TRIGGER original_payment_evidence_immutable BEFORE UPDATE OF evidence,purchase_id ON original_payments
        WHEN NEW.evidence IS NOT OLD.evidence OR NEW.purchase_id IS NOT OLD.purchase_id
        BEGIN SELECT RAISE(ABORT,'original payment evidence is immutable'); END;
      CREATE TRIGGER original_payment_attempt_immutable BEFORE UPDATE OF submission_attempted_at ON original_payments
        WHEN OLD.submission_attempted_at IS NOT NULL AND NEW.submission_attempted_at IS NOT OLD.submission_attempted_at
        BEGIN SELECT RAISE(ABORT,'original submission attempt is immutable'); END;
      CREATE TRIGGER original_payment_signature_immutable BEFORE UPDATE OF transaction_id ON original_payments
        WHEN OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS NOT OLD.transaction_id
        BEGIN SELECT RAISE(ABORT,'original transaction signature is immutable'); END;
      CREATE TRIGGER purchases_payload_immutable BEFORE UPDATE OF payload ON purchases
        WHEN OLD.payload IS NOT NULL AND NEW.payload IS NOT OLD.payload
        BEGIN SELECT RAISE(ABORT,'signed payment payload is immutable'); END;`);
    db.prepare('INSERT INTO ledger_schema_migrations VALUES (?,?)').run('007_original_payment_evidence', now);
    db.exec('COMMIT');
  } catch {
    db.exec('ROLLBACK');
    throw new Error('ORIGINAL_PAYMENT_MIGRATION_FAILED: existing evidence retained');
  }
}

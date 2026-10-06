import type { DatabaseSync } from 'node:sqlite';

/** Only new HTTP-bound intents get this guard; no historical approval is rewritten. */
export function migrateHttpPurchaseBindings(db: DatabaseSync, now: number) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare("SELECT id FROM ledger_schema_migrations WHERE id='008_http_purchase_bindings'").get()) {
      db.exec(`CREATE TRIGGER purchases_http_binding_immutable BEFORE UPDATE OF purchase,quote ON purchases
        WHEN json_extract(OLD.purchase,'$.httpRequest') IS NOT NULL AND (NEW.purchase IS NOT OLD.purchase OR NEW.quote IS NOT OLD.quote)
        BEGIN SELECT RAISE(ABORT,'approved HTTP request/challenge is immutable'); END;`);
      db.prepare('INSERT INTO ledger_schema_migrations VALUES (?,?)').run('008_http_purchase_bindings', now);
    }
    db.exec('COMMIT');
  } catch { db.exec('ROLLBACK'); throw new Error('HTTP_BINDING_MIGRATION_FAILED: existing records retained'); }
}

import type { DatabaseSync } from 'node:sqlite';

/** Before conditional execution existed, no production authority could have been
 * issued through Yosh. Quarantine any pre-existing production controls/grants;
 * preserve all purchases, reservations and original payment evidence. */
export function migrateMainnetAuthority(db: DatabaseSync, managed: boolean, now: number) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare("SELECT id FROM ledger_schema_migrations WHERE id='010_mainnet_authority_activation'").get()) {
      db.exec(`UPDATE monetary_controls SET daily_limit=NULL,paused=1
        WHERE scope_id IN (SELECT id FROM monetary_scopes WHERE environment='live_mainnet');`);
      if (managed) {
        const rows = db.prepare(`UPDATE spend_grants SET status='REVOKED',revoked_at=?
          WHERE status='ACTIVE' AND monetary_scope_id IN (SELECT id FROM monetary_scopes WHERE environment='live_mainnet') RETURNING id`).all(now);
        for (const row of rows) db.prepare('INSERT INTO spend_grant_events (grant_id,type,at) VALUES (?,?,?)')
          .run(String(row.id), 'grant.REVOKED_PRE_ENABLEMENT', now);
      }
      db.prepare('INSERT INTO ledger_schema_migrations (id,applied_at) VALUES (?,?)').run('010_mainnet_authority_activation', now);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

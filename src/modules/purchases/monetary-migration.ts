import type { DatabaseSync } from 'node:sqlite';
import { atomicAmount } from '../authority/atomic-money';
import { parseStoredSpendIntent } from '../authority/spend-intent';
import { parseStoredAuthorityDecision } from '../authority/authority-policy';
import { monetaryScope, monetaryScopeId, type MonetaryScope } from './monetary-scope';

export function storeMonetaryScope(db: DatabaseSync, scope: MonetaryScope) {
  const id = monetaryScopeId(scope);
  db.prepare('INSERT OR IGNORE INTO monetary_scopes (id,environment,wallet_identity,network,asset_id,asset_decimals) VALUES (?,?,?,?,?,?)')
    .run(id, scope.environment, scope.walletIdentity, scope.network, scope.assetId, scope.assetDecimals);
  return id;
}

/** Copies rows transactionally; signed payloads, JSON bindings and evidence stay byte-for-byte intact. */
export function migrateMonetaryLedger(db: DatabaseSync, managed: boolean, walletIdentity: string, now: number) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS ledger_schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);`);
    if (db.prepare("SELECT id FROM ledger_schema_migrations WHERE id='006_monetary_scope'").get()) { db.exec('COMMIT'); return; }
    db.exec(`CREATE TABLE monetary_scopes (id TEXT PRIMARY KEY, environment TEXT NOT NULL,
      wallet_identity TEXT NOT NULL, network TEXT NOT NULL, asset_id TEXT NOT NULL, asset_decimals INTEGER NOT NULL);
      CREATE TRIGGER monetary_scopes_immutable BEFORE UPDATE ON monetary_scopes BEGIN SELECT RAISE(ABORT,'monetary scope is immutable'); END;
      CREATE TABLE monetary_controls (scope_id TEXT PRIMARY KEY REFERENCES monetary_scopes(id), daily_limit TEXT CHECK(daily_limit IS NULL OR (length(daily_limit) BETWEEN 1 AND 19 AND daily_limit NOT GLOB '*[^0-9]*'
          AND (daily_limit='0' OR substr(daily_limit,1,1) BETWEEN '1' AND '9') AND (length(daily_limit)<19 OR daily_limit<='9223372036854775807'))),
        paused INTEGER NOT NULL CHECK(paused IN (0,1)));
      CREATE TABLE monetary_budget_clock (scope_id TEXT PRIMARY KEY REFERENCES monetary_scopes(id), spending_day TEXT NOT NULL,
        time_zone TEXT NOT NULL, next_boundary INTEGER NOT NULL, last_seen INTEGER NOT NULL);
      CREATE TABLE purchases_monetary (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, approval_id TEXT NOT NULL UNIQUE,
        purchase TEXT NOT NULL, quote TEXT NOT NULL, decision TEXT NOT NULL, status TEXT NOT NULL,
        amount TEXT NOT NULL CHECK(length(amount) BETWEEN 1 AND 19 AND amount NOT GLOB '*[^0-9]*'
          AND substr(amount,1,1) BETWEEN '1' AND '9' AND (length(amount)<19 OR amount<='9223372036854775807')),
        confirmed_day TEXT, transaction_id TEXT, data TEXT, payload TEXT, owner_card_member_id TEXT,
        execution_mode TEXT CHECK(execution_mode IN ('simulated','live_devnet','live_mainnet')), payment_evidence TEXT,
        monetary_scope_id TEXT NOT NULL REFERENCES monetary_scopes(id));`);
    const rows = db.prepare(`SELECT id,task_id,approval_id,purchase,quote,decision,status,confirmed_day,transaction_id,
      data,payload,owner_card_member_id,execution_mode,payment_evidence,CAST(amount AS TEXT) AS exact_amount FROM purchases`).all();
    for (const row of rows) {
      const intent = parseStoredSpendIntent(JSON.parse(String(row.purchase)), row.owner_card_member_id ? String(row.owner_card_member_id) : undefined);
      parseStoredAuthorityDecision(JSON.parse(String(row.decision)));
      const amount = atomicAmount(row.exact_amount).toString();
      if (amount !== intent.amount) throw new Error('LEGACY_MONETARY_AMOUNT_MISMATCH');
      const mode = row.execution_mode === null ? 'legacy_test' : row.execution_mode;
      if (mode !== 'legacy_test' && mode !== 'simulated' && mode !== 'live_devnet') throw new Error('LEGACY_MONETARY_SCOPE_UNCLASSIFIABLE');
      // Old managed records used this installation's fixed product test item.
      // UNKNOWN is deliberately a separate test-only bucket, never live evidence.
      const scope = monetaryScope(mode, walletIdentity, intent.network, intent.assetId, intent.assetDecimals);
      const scopeId = storeMonetaryScope(db, scope);
      db.prepare(`INSERT INTO purchases_monetary VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        String(row.id), String(row.task_id), String(row.approval_id), String(row.purchase), String(row.quote), String(row.decision),
        String(row.status), amount, row.confirmed_day, row.transaction_id, row.data, row.payload, row.owner_card_member_id,
        row.execution_mode, row.payment_evidence, scopeId);
    }
    db.exec(`DROP TABLE purchases; ALTER TABLE purchases_monetary RENAME TO purchases;
      CREATE UNIQUE INDEX purchase_request_per_member ON purchases(owner_card_member_id,task_id) WHERE owner_card_member_id IS NOT NULL;
      CREATE UNIQUE INDEX legacy_purchase_request_unique ON purchases(task_id) WHERE owner_card_member_id IS NULL;
      CREATE INDEX purchase_monetary_accounting ON purchases(monetary_scope_id,status,confirmed_day);
      CREATE TRIGGER purchases_execution_mode_immutable BEFORE UPDATE OF execution_mode ON purchases
        WHEN NEW.execution_mode IS NOT OLD.execution_mode BEGIN SELECT RAISE(ABORT,'purchase execution mode is immutable'); END;
      CREATE TRIGGER purchases_money_immutable BEFORE UPDATE OF amount,monetary_scope_id ON purchases
        WHEN NEW.amount IS NOT OLD.amount OR NEW.monetary_scope_id IS NOT OLD.monetary_scope_id
        BEGIN SELECT RAISE(ABORT,'purchase monetary scope/amount is immutable'); END;`);
    if (managed) {
      db.exec('ALTER TABLE spend_grants ADD COLUMN monetary_scope_id TEXT REFERENCES monetary_scopes(id)');
      const grants = db.prepare('SELECT id,network,asset_id,asset_decimals,CAST(total_limit AS TEXT) AS exact_total,CAST(single_limit AS TEXT) AS exact_single FROM spend_grants').all();
      for (const row of grants) {
        const total = atomicAmount(row.exact_total); const single = atomicAmount(row.exact_single);
        if (total === 0n || single === 0n || single > total) throw new Error('INVALID_LEGACY_GRANT_AMOUNT');
        const scope = monetaryScope('legacy_test', walletIdentity, String(row.network), String(row.asset_id), Number(row.asset_decimals));
        const linked = db.prepare("SELECT DISTINCT monetary_scope_id FROM purchases WHERE json_extract(purchase,'$.authority.grantId')=?").all(String(row.id));
        // A single historical environment proves this grant's accounting scope.
        // Mixed/unused legacy grants stay test-only and cannot authorize a live scope.
        const scopeId = linked.length === 1 ? String(linked[0].monetary_scope_id) : storeMonetaryScope(db, scope);
        const facts = db.prepare('SELECT wallet_identity,network,asset_id,asset_decimals FROM monetary_scopes WHERE id=?').get(scopeId)!;
        if (facts.wallet_identity !== walletIdentity || facts.network !== row.network || facts.asset_id !== row.asset_id || Number(facts.asset_decimals) !== Number(row.asset_decimals)) throw new Error('LEGACY_GRANT_SCOPE_MISMATCH');
        db.prepare('UPDATE spend_grants SET monetary_scope_id=? WHERE id=?').run(scopeId, String(row.id));
      }
      db.exec(`CREATE TABLE spend_grants_money (id TEXT PRIMARY KEY,version INTEGER NOT NULL UNIQUE,
        connection_id TEXT NOT NULL,connection_generation INTEGER NOT NULL,resource_id TEXT NOT NULL,provider_id TEXT NOT NULL,
        operation TEXT NOT NULL,network TEXT NOT NULL,asset_id TEXT NOT NULL,asset_decimals INTEGER NOT NULL,pay_to TEXT NOT NULL,
        payment_scheme TEXT NOT NULL,
        total_limit TEXT NOT NULL CHECK(length(total_limit) BETWEEN 1 AND 19 AND total_limit NOT GLOB '*[^0-9]*' AND substr(total_limit,1,1) BETWEEN '1' AND '9' AND (length(total_limit)<19 OR total_limit<='9223372036854775807')),
        single_limit TEXT NOT NULL CHECK(length(single_limit) BETWEEN 1 AND 19 AND single_limit NOT GLOB '*[^0-9]*' AND substr(single_limit,1,1) BETWEEN '1' AND '9' AND (length(single_limit)<19 OR single_limit<='9223372036854775807')),
        status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED','EXPIRED')),
        created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER,card_member_id TEXT,
        monetary_scope_id TEXT NOT NULL REFERENCES monetary_scopes(id));
        INSERT INTO spend_grants_money SELECT id,version,connection_id,connection_generation,resource_id,provider_id,operation,network,
          asset_id,asset_decimals,pay_to,payment_scheme,CAST(total_limit AS TEXT),CAST(single_limit AS TEXT),status,
          created_at,expires_at,revoked_at,card_member_id,monetary_scope_id FROM spend_grants;
        DROP TABLE spend_grants; ALTER TABLE spend_grants_money RENAME TO spend_grants;
        CREATE UNIQUE INDEX one_active_spend_grant_per_member ON spend_grants(card_member_id,monetary_scope_id) WHERE status='ACTIVE';
        CREATE TRIGGER spend_grant_money_scope_immutable BEFORE UPDATE OF monetary_scope_id ON spend_grants
        WHEN NEW.monetary_scope_id IS NOT OLD.monetary_scope_id BEGIN SELECT RAISE(ABORT,'grant monetary scope is immutable'); END;`);
      const settings = db.prepare('SELECT CAST(daily_limit AS TEXT) AS daily_limit,paused FROM app_settings WHERE id=1').get()!;
      const limit = settings.daily_limit === null ? null : atomicAmount(settings.daily_limit).toString();
      const clock = db.prepare('SELECT * FROM app_budget_clock WHERE id=1').get();
      // The former setting covered both test modes. Preserve its value only in
      // explicit test scopes; subsequent writes and all spending are per-scope.
      for (const mode of ['legacy_test', 'simulated', 'live_devnet'] as const) {
        const id = storeMonetaryScope(db, monetaryScope(mode, walletIdentity));
        db.prepare('INSERT INTO monetary_controls VALUES (?,?,?)').run(id, limit, Number(settings.paused));
        if (clock) db.prepare('INSERT INTO monetary_budget_clock VALUES (?,?,?,?,?)')
          .run(id, clock.spending_day, clock.time_zone, clock.next_boundary, clock.last_seen);
      }
    }
    db.prepare('INSERT INTO ledger_schema_migrations VALUES (?,?)').run('006_monetary_scope', now);
    db.exec('COMMIT');
  } catch {
    db.exec('ROLLBACK');
    throw new Error('MONETARY_MIGRATION_FAILED: legacy data retained; monetary scope or amount requires review');
  }
}

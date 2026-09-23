import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { PurchaseLedger } from '../../src/modules/purchases/purchase-ledger';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

it('migrates historical connection owners without merging different connectionIds or rewriting payment evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), '2049-card-member-migration-')); directories.push(directory);
  const path = join(directory, 'ledger.sqlite');
  const firstConnection = '11111111-1111-4111-8111-111111111111';
  const secondConnection = '22222222-2222-4222-8222-222222222222';
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE purchases (id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, approval_id TEXT NOT NULL UNIQUE,
      purchase TEXT NOT NULL, quote TEXT NOT NULL, decision TEXT NOT NULL, status TEXT NOT NULL,
      amount INTEGER NOT NULL, confirmed_day TEXT, transaction_id TEXT, data TEXT, payload TEXT);
    CREATE TABLE purchase_answers (purchase_id TEXT PRIMARY KEY, answer TEXT NOT NULL);
    CREATE TABLE purchase_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id TEXT NOT NULL, type TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE spend_grants (id TEXT PRIMARY KEY, version INTEGER NOT NULL UNIQUE, connection_id TEXT NOT NULL, connection_generation INTEGER NOT NULL,
      resource_id TEXT NOT NULL, provider_id TEXT NOT NULL, operation TEXT NOT NULL, network TEXT NOT NULL, asset_id TEXT NOT NULL, asset_decimals INTEGER NOT NULL,
      pay_to TEXT NOT NULL, payment_scheme TEXT NOT NULL, total_limit INTEGER NOT NULL, single_limit INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED','EXPIRED')), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER);
  `);
  const insertGrant = database.prepare(`INSERT INTO spend_grants VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertGrant.run('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, firstConnection, 1, 'resource', 'provider', 'operation', 'network', 'asset', 6, 'payee', 'exact', 100, 100, 'REVOKED', 1, 2, 2);
  insertGrant.run('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2, secondConnection, 1, 'resource', 'provider', 'operation', 'network', 'asset', 6, 'payee', 'exact', 100, 100, 'REVOKED', 1, 2, 2);
  const evidence = { quote: '{"amount":"10"}', decision: '{"decision":"APPROVED"}', data: '{"resource":"preserved"}', payload: '{"signed":"preserved"}' };
  const insertPurchase = database.prepare('INSERT INTO purchases VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const intent = (connectionId: string, generation: number) => JSON.stringify({ authority: { connectionId, connectionGeneration: generation } });
  insertPurchase.run('p1', 'request-1', 'approval-1', intent(firstConnection, 1), evidence.quote, evidence.decision, 'PAID', 10, '2026-09-22', 'transaction-1', evidence.data, evidence.payload);
  insertPurchase.run('p2', 'request-2', 'approval-2', intent(firstConnection, 7), evidence.quote, evidence.decision, 'PAID', 10, '2026-09-22', 'transaction-2', evidence.data, evidence.payload);
  insertPurchase.run('p3', 'request-3', 'approval-3', intent(secondConnection, 1), evidence.quote, evidence.decision, 'PAID', 10, '2026-09-22', 'transaction-3', evidence.data, evidence.payload);
  database.prepare("INSERT INTO purchase_events (purchase_id,type,at) VALUES ('p1','payment.PAID',1)").run();
  database.close();

  const ledger = new PurchaseLedger(path, { managed: true, requireSpendGrant: true, now: () => 10, timeZone: () => 'UTC' });
  const defaultMemberId = ledger.defaultCardMember().id;
  ledger.close();

  const migrated = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = migrated.prepare('SELECT task_id,owner_card_member_id,purchase,quote,decision,transaction_id,data,payload FROM purchases ORDER BY task_id').all();
    expect(rows[0]?.owner_card_member_id).toBe(rows[1]?.owner_card_member_id);
    expect(rows[2]?.owner_card_member_id).not.toBe(rows[0]?.owner_card_member_id);
    expect(defaultMemberId).not.toBe(rows[0]?.owner_card_member_id);
    expect(defaultMemberId).not.toBe(rows[2]?.owner_card_member_id);
    expect(rows.map(row => [row.quote, row.decision, row.data, row.payload])).toEqual([
      [evidence.quote, evidence.decision, evidence.data, evidence.payload],
      [evidence.quote, evidence.decision, evidence.data, evidence.payload],
      [evidence.quote, evidence.decision, evidence.data, evidence.payload],
    ]);
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM purchases').get()?.count).toBe(3);
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM purchase_events').get()?.count).toBe(1);
    expect(migrated.prepare('SELECT COUNT(*) AS count FROM legacy_connection_card_members').get()?.count).toBe(2);
    const grants = migrated.prepare('SELECT connection_id,card_member_id FROM spend_grants ORDER BY connection_id').all();
    expect(grants[0]?.card_member_id).toBe(rows[0]?.owner_card_member_id);
    expect(grants[1]?.card_member_id).toBe(rows[2]?.owner_card_member_id);
    expect(migrated.prepare("SELECT COUNT(*) AS count FROM app_schema_migrations WHERE id='003_stable_card_member'").get()?.count).toBe(1);
  } finally { migrated.close(); }
});

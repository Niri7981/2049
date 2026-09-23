import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { collectE2eEvidence } from '../../src/modules/e2e/evidence';
import { DEVNET_NETWORK, DEVNET_USDC_MINT, TOKEN_PROGRAM, type PaymentConfig } from '../../src/modules/payment/payment-config';
import { hash } from '../../src/modules/purchases/spending-policy';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

const config: PaymentConfig = {
  cluster: 'devnet', rpcUrl: 'https://rpc.invalid', network: DEVNET_NETWORK, mint: DEVNET_USDC_MINT,
  buyer: 'Hr937hUNE1yHzjDLhZngWn8rHUWGTuTRLMJoTzi9BUeH', merchant: '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs',
  facilitatorUrl: 'https://facilitator.invalid',
};
const grantId = '11111111-1111-4111-8111-111111111111';
const signature = '1'.repeat(64);
const basicQuote = { amount: '200000', network: config.network, asset: config.mint, payTo: config.merchant, extra: { memo: 'day4:AAAAAAAAAAAAAAAAAAAAAA' } };
const basicPayload = { x402Version: 2, accepted: basicQuote, payload: { transaction: 'signed-fixture-wire' } };
const paymentEvidence = JSON.stringify({ version: 1, payloadHash: hash(basicPayload), messageHash: 'a'.repeat(64), quoteFingerprint: hash(basicQuote),
  transaction: signature, confirmationStatus: 'confirmed', settlementConfirmed: true, verifiedAt: 1 });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), '2049-e2e-evidence-')); directories.push(directory);
  const ledgerPath = join(directory, 'app-ledger.sqlite');
  const settlementPath = join(directory, 'settlements.sqlite');
  const ledger = new DatabaseSync(ledgerPath);
  ledger.exec(`
    CREATE TABLE purchases (id TEXT PRIMARY KEY, task_id TEXT UNIQUE, approval_id TEXT, purchase TEXT, quote TEXT, decision TEXT,
      status TEXT, amount INTEGER, confirmed_day TEXT, transaction_id TEXT, data TEXT, payload TEXT, execution_mode TEXT, payment_evidence TEXT);
    CREATE TABLE purchase_events (sequence INTEGER PRIMARY KEY, purchase_id TEXT, type TEXT, at INTEGER);
    CREATE TABLE app_budget_clock (id INTEGER PRIMARY KEY, spending_day TEXT, time_zone TEXT);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, daily_limit INTEGER);
    CREATE TABLE spend_grants (id TEXT PRIMARY KEY, status TEXT, total_limit INTEGER);
    INSERT INTO app_budget_clock VALUES (1,'2026-09-22','Asia/Shanghai');
    INSERT INTO app_settings VALUES (1,5000000);
    INSERT INTO spend_grants VALUES ('${grantId}','ACTIVE',5000000);
  `);
  const intent = (requestId: string, offerId: string) => JSON.stringify({
    id: requestId === 'basic-request' ? '22222222-2222-4222-8222-222222222222' : '33333333-3333-4333-8333-333333333333',
    authority: { grantId }, offerId, ...(requestId === 'basic-request' ? { quoteFingerprint: hash(basicQuote) } : {}),
  });
  const basicData = JSON.stringify({ asset: 'SOL', price: '150', as_of: '2026-09-22T00:00:00.000Z' });
  ledger.prepare('INSERT INTO purchases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    'basic-row', 'basic-request', 'must-never-appear', intent('basic-request', 'basic'),
    JSON.stringify(basicQuote),
    JSON.stringify({ decision: 'APPROVED', reason: 'AUTHORITY_BUDGET_AND_GRANT_PASSED' }),
    'PAID', 200000, '2026-09-22', signature, basicData, JSON.stringify(basicPayload), 'live_devnet', paymentEvidence,
  );
  ledger.prepare('INSERT INTO purchases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    'premium-row', 'premium-request', 'another-hidden-approval', intent('premium-request', 'premium'),
    JSON.stringify({ amount: '20000000', network: config.network, asset: config.mint, payTo: config.merchant, extra: { memo: 'day4:BBBBBBBBBBBBBBBBBBBBBB' } }),
    JSON.stringify({ decision: 'DENIED', reason: 'SPEND_GRANT_SINGLE_LIMIT_EXCEEDED' }),
    'DENIED', 20000000, null, null, null, null, 'live_devnet', null,
  );
  ledger.exec(`
    INSERT INTO purchase_events VALUES (1,'basic-row','authority.APPROVED',1);
    INSERT INTO purchase_events VALUES (2,'basic-row','payment.PAYING',2);
    INSERT INTO purchase_events VALUES (3,'basic-row','payment.PAID',3);
    INSERT INTO purchase_events VALUES (4,'basic-row','delivery.COMPLETE',4);
    INSERT INTO purchase_events VALUES (5,'premium-row','authority.DENIED',5);
  `);
  ledger.close();

  const settlement = new DatabaseSync(settlementPath);
  settlement.exec(`
    CREATE TABLE day4_quotes (id TEXT PRIMARY KEY, resource TEXT, requirements TEXT, expires_at INTEGER);
    CREATE TABLE day4_settlements (message_hash TEXT PRIMARY KEY, quote_id TEXT UNIQUE, payload_hash TEXT, status TEXT, receipt TEXT, body TEXT);
  `);
  settlement.prepare('INSERT INTO day4_quotes VALUES (?,?,?,?)').run('day4:AAAAAAAAAAAAAAAAAAAAAA', '/basic', '{}', 1);
  settlement.prepare('INSERT INTO day4_quotes VALUES (?,?,?,?)').run('day4:BBBBBBBBBBBBBBBBBBBBBB', '/premium', '{}', 1);
  settlement.prepare('INSERT INTO day4_settlements VALUES (?,?,?,?,?,?)').run('message-hash', 'day4:AAAAAAAAAAAAAAAAAAAAAA', 'payload-hash', 'CONFIRMED', '{}', basicData);
  settlement.close();

  const tokenAccount = (owner: string, amount: string) => ({ owner: TOKEN_PROGRAM, data: { parsed: { type: 'account', info: {
    owner, mint: DEVNET_USDC_MINT, tokenAmount: { amount, decimals: 6 },
  } } } });
  const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string };
    if (body.method === 'getMultipleAccounts') return Response.json({ result: { value: [tokenAccount(config.buyer, '0'), tokenAccount(config.merchant, '340000')] } });
    if (body.method === 'getSignatureStatuses') return Response.json({ result: { value: [{ err: null, confirmationStatus: 'confirmed' }] } });
    if (body.method === 'getTransaction') return Response.json({ result: { meta: { err: null } } });
    return Response.json({ error: { message: 'unexpected method' } });
  }) as typeof fetch;
  return { directory, settlementPath, fetcher };
}

it('reports successful purchase evidence without exposing signer or authorization material', async () => {
  const value = fixture();
  const evidence = await collectE2eEvidence('basic-request', {
    dataDirectory: value.directory, settlementDatabase: value.settlementPath, config, fetcher: value.fetcher,
  });
  expect(evidence).toMatchObject({
    purchaseId: 'basic-request', decision: { status: 'APPROVED' }, paymentStatus: 'PAID', deliveryStatus: 'COMPLETE',
    executionMode: 'live_devnet', quotedAmount: '200000', amountPaid: '200000', transactionSignature: signature, paymentPayloadPresent: true,
    budget: { paid: '200000', reserved: '0', remaining: '4800000' },
    grant: { committed: '200000', remaining: '4800000' },
    settlement: { quoteCount: 1, count: 1, states: ['CONFIRMED'], totalQuoteCount: 2, totalSettlementCount: 1 },
    tokenBalances: { buyer: { amount: '0' }, merchant: { amount: '340000' } },
    rpcTransaction: { status: 'CONFIRMED', transactionFound: true },
    livePaymentProof: { verified: true, transactionSignaturePresent: true, chainConfirmation: 'confirmed', settlementConfirmed: true },
  });
  expect(evidence.events.map(event => event.type)).toEqual(['authority.APPROVED', 'payment.PAYING', 'payment.PAID', 'delivery.COMPLETE']);
  expect(evidence.resourceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(evidence.resourceMatchesSettlement).toBe(true);
  const output = JSON.stringify(evidence);
  expect(output).not.toContain('must-never-appear');
  expect(output).not.toContain('raw-payment-payload');
});

it('reports a denied premium request with no payment or settlement', async () => {
  const value = fixture();
  const evidence = await collectE2eEvidence('premium-request', {
    dataDirectory: value.directory, settlementDatabase: value.settlementPath, config, fetcher: value.fetcher,
  });
  expect(evidence).toMatchObject({
    decision: { status: 'DENIED', reason: 'SPEND_GRANT_SINGLE_LIMIT_EXCEEDED' }, paymentStatus: 'NOT_STARTED', deliveryStatus: 'NOT_PAID',
    executionMode: 'live_devnet', quotedAmount: '20000000', amountPaid: '0', transactionSignature: null, paymentPayloadPresent: false,
    budget: { paid: '200000', reserved: '0', remaining: '4800000' }, grant: { committed: '200000', remaining: '4800000' },
    settlement: { quoteCount: 1, count: 0, states: [], totalQuoteCount: 2, totalSettlementCount: 1 }, rpcTransaction: { status: 'NOT_APPLICABLE' },
  });
  expect(evidence.events.map(event => event.type)).toEqual(['authority.DENIED']);
  expect(evidence.resourceHash).toBeNull();
});

it('reports a legacy record without persisted mode as UNKNOWN rather than live', async () => {
  const value = fixture();
  const ledger = new DatabaseSync(join(value.directory, 'app-ledger.sqlite'));
  try { ledger.prepare('UPDATE purchases SET execution_mode=NULL WHERE task_id=?').run('basic-request'); }
  finally { ledger.close(); }

  const evidence = await collectE2eEvidence('basic-request', {
    dataDirectory: value.directory, settlementDatabase: value.settlementPath, config, fetcher: value.fetcher,
  });
  expect(evidence).toMatchObject({
    executionMode: 'UNKNOWN', paymentStatus: 'PAID', amountPaid: '0',
    livePaymentProof: { verified: false },
  });
});

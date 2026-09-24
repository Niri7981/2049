import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { collectE2eEvidence } from '../../src/modules/e2e/evidence';
import { DEVNET_NETWORK, DEVNET_USDC_MINT, TOKEN_PROGRAM, type PaymentConfig } from '../../src/modules/payment/payment-config';
import { getStandardTokenAccount } from '../../src/modules/payment/payment-preflight';
import { hash } from '../../src/modules/purchases/spending-policy';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

const historicalPayer = 'Hr937hUNE1yHzjDLhZngWn8rHUWGTuTRLMJoTzi9BUeH';
const config: PaymentConfig = {
  cluster: 'devnet', rpcUrl: 'https://rpc.invalid', network: DEVNET_NETWORK, mint: DEVNET_USDC_MINT,
  buyer: 'HXvqH3weDKJaVnvwVkN5MRPB28LGgoGYAmB5h4f6c9FU', merchant: '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs',
  facilitatorUrl: 'https://facilitator.invalid',
};
const grantId = '11111111-1111-4111-8111-111111111111';
const signature = '1'.repeat(64);
const basicQuote = { amount: '200000', network: config.network, asset: config.mint, payTo: config.merchant, extra: { memo: 'day4:AAAAAAAAAAAAAAAAAAAAAA' } };
const basicPayload = { x402Version: 2, accepted: basicQuote, payload: { transaction: 'signed-fixture-wire' } };
function paymentEvidence(payer = historicalPayer) {
  return JSON.stringify({ version: 2, payloadHash: hash(basicPayload), messageHash: 'a'.repeat(64), quoteFingerprint: hash(basicQuote),
    transaction: signature, payer, confirmationStatus: 'confirmed', settlementConfirmed: true, verifiedAt: 1 });
}

async function fixture(options: { mode?: string | null; includePaymentEvidence?: boolean; settlementPayer?: string; settlementStatus?: string; includeSettlementReceipt?: boolean } = {}) {
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
    'PAID', 200000, '2026-09-22', signature, basicData, JSON.stringify(basicPayload), 'live_devnet', paymentEvidence(),
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
  const settlementReceipt = options.includeSettlementReceipt === false ? null : JSON.stringify({ success: true, transaction: signature,
    payer: options.settlementPayer ?? historicalPayer, network: config.network, amount: basicQuote.amount });
  settlement.prepare('INSERT INTO day4_settlements VALUES (?,?,?,?,?,?)').run('message-hash', 'day4:AAAAAAAAAAAAAAAAAAAAAA', 'payload-hash',
    options.settlementStatus ?? 'CONFIRMED', settlementReceipt, basicData);
  settlement.close();

  const tokenAccount = (owner: string, amount: string) => ({ owner: TOKEN_PROGRAM, data: { parsed: { type: 'account', info: {
    owner, mint: DEVNET_USDC_MINT, tokenAmount: { amount, decimals: 6 },
  } } } });
  const historicalAta = await getStandardTokenAccount(historicalPayer, config.mint);
  const runtimeAta = await getStandardTokenAccount(config.buyer, config.mint);
  const merchantAta = await getStandardTokenAccount(config.merchant, config.mint);
  const requestedAccounts: string[] = [];
  const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    if (body.method === 'getMultipleAccounts') {
      const accounts = body.params[0] as string[];
      requestedAccounts.push(...accounts);
      const values = accounts.map(account => account === historicalAta ? tokenAccount(historicalPayer, '39600000')
        : account === runtimeAta ? tokenAccount(config.buyer, '39000000')
          : account === merchantAta ? tokenAccount(config.merchant, '540000') : null);
      return Response.json({ result: { value: values } });
    }
    if (body.method === 'getSignatureStatuses') return Response.json({ result: { value: [{ err: null, confirmationStatus: 'confirmed' }] } });
    if (body.method === 'getTransaction') return Response.json({ result: { meta: { err: null } } });
    return Response.json({ error: { message: 'unexpected method' } });
  }) as typeof fetch;
  if (options.mode !== undefined || options.includePaymentEvidence === false) {
    const ledger = new DatabaseSync(ledgerPath);
    try {
      if (options.mode !== undefined) ledger.prepare('UPDATE purchases SET execution_mode=? WHERE task_id=?').run(options.mode, 'basic-request');
      if (options.includePaymentEvidence === false) ledger.prepare('UPDATE purchases SET payment_evidence=NULL WHERE task_id=?').run('basic-request');
    } finally { ledger.close(); }
  }
  return { directory, settlementPath, fetcher, requestedAccounts, historicalAta, runtimeAta };
}

it('reports successful purchase evidence without exposing signer or authorization material', async () => {
  const value = await fixture();
  const evidence = await collectE2eEvidence('basic-request', {
    dataDirectory: value.directory, settlementDatabase: value.settlementPath, config, fetcher: value.fetcher,
  });
  expect(evidence).toMatchObject({
    purchaseId: 'basic-request', decision: { status: 'APPROVED' }, paymentStatus: 'PAID', deliveryStatus: 'COMPLETE',
    executionMode: 'live_devnet', quotedAmount: '200000', amountPaid: '200000', transactionSignature: signature, paymentPayloadPresent: true,
    budget: { paid: '200000', reserved: '0', remaining: '4800000' },
    grant: { committed: '200000', remaining: '4800000' },
    settlement: { quoteCount: 1, count: 1, states: ['CONFIRMED'], totalQuoteCount: 2, totalSettlementCount: 1 },
    tokenBalances: { buyer: { amount: '39600000' }, merchant: { amount: '540000' } },
    buyer: { address: historicalPayer, tokenAccount: value.historicalAta, amount: '39600000' },
    runtimeConfiguredBuyer: config.buyer, historicalBuyerEvidenceComplete: true,
    buyerMatchesSettlement: true, buyerMatchesPaymentEvidence: true,
    rpcTransaction: { status: 'CONFIRMED', transactionFound: true },
    livePaymentProof: { verified: true, transactionSignaturePresent: true, chainConfirmation: 'confirmed', settlementConfirmed: true },
  });
  expect(evidence.events.map(event => event.type)).toEqual(['authority.APPROVED', 'payment.PAYING', 'payment.PAID', 'delivery.COMPLETE']);
  expect(evidence.resourceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(evidence.resourceMatchesSettlement).toBe(true);
  const output = JSON.stringify(evidence);
  expect(output).not.toContain('must-never-appear');
  expect(output).not.toContain('raw-payment-payload');
  expect(value.requestedAccounts).toContain(value.historicalAta);
  expect(value.requestedAccounts).not.toContain(value.runtimeAta);
});

it('reports a denied premium request with no payment or settlement', async () => {
  const value = await fixture();
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
  const value = await fixture();
  const ledger = new DatabaseSync(join(value.directory, 'app-ledger.sqlite'));
  try {
    const row = ledger.prepare('SELECT payment_evidence FROM purchases WHERE task_id=?').get('basic-request') as { payment_evidence: string };
    const legacyEvidence = JSON.parse(row.payment_evidence) as Record<string, unknown>;
    delete legacyEvidence.payer;
    legacyEvidence.version = 1;
    ledger.prepare('UPDATE purchases SET execution_mode=NULL,payment_evidence=? WHERE task_id=?').run(JSON.stringify(legacyEvidence), 'basic-request');
  }
  finally { ledger.close(); }

  const evidence = await collectE2eEvidence('basic-request', {
    dataDirectory: value.directory, settlementDatabase: value.settlementPath, config, fetcher: value.fetcher,
  });
  expect(evidence).toMatchObject({
    executionMode: 'UNKNOWN', paymentStatus: 'PAID', amountPaid: '0',
    buyer: { address: historicalPayer, tokenAccount: value.historicalAta, amount: '39600000' },
    historicalBuyerEvidenceComplete: true, buyerMatchesSettlement: true, buyerMatchesPaymentEvidence: false,
    livePaymentProof: { verified: false },
  });
});

it('does not change the historical buyer when the runtime configured buyer changes', async () => {
  const value = await fixture();
  const changedRuntimeConfig = { ...config, buyer: 'BSEDrH4umjwCKUL5TqYm69ffsSjwWcV2BXQkczVp1F52' };
  const evidence = await collectE2eEvidence('basic-request', {
    dataDirectory: value.directory, settlementDatabase: value.settlementPath, config: changedRuntimeConfig, fetcher: value.fetcher,
  });
  expect(evidence).toMatchObject({ buyer: { address: historicalPayer }, runtimeConfiguredBuyer: changedRuntimeConfig.buyer });
});

it('rejects disagreement between persisted payment evidence payer and settlement receipt payer', async () => {
  const value = await fixture({ settlementPayer: config.buyer });
  await expect(collectE2eEvidence('basic-request', {
    dataDirectory: value.directory, settlementDatabase: value.settlementPath, config, fetcher: value.fetcher,
  })).rejects.toThrow('E2E_EVIDENCE_INTEGRITY_ERROR: payment evidence payer does not match settlement payer');
});

it('uses a verified settlement payer for a legacy record without payment evidence', async () => {
  const value = await fixture({ mode: null, includePaymentEvidence: false });
  const evidence = await collectE2eEvidence('basic-request', {
    dataDirectory: value.directory, settlementDatabase: value.settlementPath, config, fetcher: value.fetcher,
  });
  expect(evidence).toMatchObject({ executionMode: 'UNKNOWN', amountPaid: '0', buyer: { address: historicalPayer }, buyerMatchesSettlement: true });
});

it('reports UNKNOWN when a legacy record has no verified payer evidence', async () => {
  const value = await fixture({ mode: null, includePaymentEvidence: false, settlementStatus: 'UNKNOWN', includeSettlementReceipt: false });
  const evidence = await collectE2eEvidence('basic-request', {
    dataDirectory: value.directory, settlementDatabase: value.settlementPath, config, fetcher: value.fetcher,
  });
  expect(evidence).toMatchObject({ buyer: { address: 'UNKNOWN', tokenAccount: null, amount: null }, historicalBuyerEvidenceComplete: false,
    buyerMatchesSettlement: false, buyerMatchesPaymentEvidence: false, runtimeConfiguredBuyer: config.buyer });
  expect(value.requestedAccounts).not.toContain(value.runtimeAta);
});

it('never infers a simulated or UNKNOWN-mode buyer from the runtime config', async () => {
  for (const mode of ['simulated', null]) {
    const value = await fixture({ mode, includePaymentEvidence: false, settlementStatus: 'UNKNOWN', includeSettlementReceipt: false });
    const evidence = await collectE2eEvidence('basic-request', {
      dataDirectory: value.directory, settlementDatabase: value.settlementPath, config, fetcher: value.fetcher,
    });
    expect(evidence).toMatchObject({ buyer: { address: 'UNKNOWN' }, historicalBuyerEvidenceComplete: false, runtimeConfiguredBuyer: config.buyer });
  }
});

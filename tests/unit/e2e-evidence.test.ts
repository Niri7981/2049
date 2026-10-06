import { resolvePaymentEnvironment } from '../../src/modules/payment/payment-environment';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import type { PaymentRequirements } from '@x402/core/types';
import { z } from 'zod';
import { collectE2eEvidence } from '../../src/modules/e2e/evidence';
import { DEVNET_NETWORK, DEVNET_USDC_MINT, TOKEN_PROGRAM, type PaymentConfig } from '../../src/modules/payment/payment-config';
import { getStandardTokenAccount } from '../../src/modules/payment/payment-preflight';
import { hash } from '../../src/modules/purchases/spending-policy';
import { PurchaseLedger } from '../../src/modules/purchases/purchase-ledger';
import { OriginalPaymentRecordSchema } from '../../src/modules/purchases/original-payment-record';
import { monetaryScopeId } from '../../src/modules/purchases/monetary-scope';
import { createSignedPaymentIdentity } from '../../src/modules/payment/original-payment-evidence';
import { createStaticResourceRegistry } from '../../src/modules/resources/static-resource-registry';
import { createMarketSnapshotSpendIntent } from '../../src/modules/resources/market-spend-adapter';
import { signedPaymentFixture } from '../helpers/signed-payment-fixture';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

const historicalPayer = 'Hr937hUNE1yHzjDLhZngWn8rHUWGTuTRLMJoTzi9BUeH';
const config: PaymentConfig = { ...resolvePaymentEnvironment({}, 'live_devnet'),
  cluster: 'devnet', rpcUrl: 'https://rpc.invalid', network: DEVNET_NETWORK, mint: DEVNET_USDC_MINT,
  buyer: 'HXvqH3weDKJaVnvwVkN5MRPB28LGgoGYAmB5h4f6c9FU', merchant: '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs',
  facilitatorUrl: 'https://facilitator.invalid',
};
const grantId = '11111111-1111-4111-8111-111111111111';
const revokedGrantId = '44444444-4444-4444-8444-444444444444';
const signature = '1'.repeat(64);
const basicQuote = { amount: '200000', network: config.network, asset: config.mint, payTo: config.merchant, extra: { memo: 'day4:AAAAAAAAAAAAAAAAAAAAAA' } };
const basicPayload = { x402Version: 2, accepted: basicQuote, payload: { transaction: 'signed-fixture-wire' } };
function paymentEvidence(payer = historicalPayer) {
  return JSON.stringify({ version: 2, payloadHash: hash(basicPayload), messageHash: 'a'.repeat(64), quoteFingerprint: hash(basicQuote),
    transaction: signature, payer, confirmationStatus: 'confirmed', settlementConfirmed: true, verifiedAt: 1 });
}

async function fixture(options: { mode?: string | null; includePaymentEvidence?: boolean; settlementPayer?: string; settlementStatus?: string; includeSettlementReceipt?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'yosh-e2e-evidence-')); directories.push(directory);
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
    INSERT INTO spend_grants VALUES ('${revokedGrantId}','REVOKED',5000000);
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
  ledger.prepare('INSERT INTO purchases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    'revoked-row', 'revoked-request', 'revoked-hidden-approval',
    JSON.stringify({ id: '44444444-4444-4444-8444-444444444445', authority: { grantId: revokedGrantId }, offerId: 'basic' }),
    JSON.stringify({ amount: '200000', network: config.network, asset: config.mint, payTo: config.merchant, extra: { memo: 'day4:CCCCCCCCCCCCCCCCCCCCCC' } }),
    JSON.stringify({ decision: 'DENIED', reason: 'SPEND_GRANT_REVOKED' }),
    'DENIED', 200000, null, null, null, null, 'live_devnet', null,
  );
  ledger.exec(`
    INSERT INTO purchase_events VALUES (1,'basic-row','authority.APPROVED',1);
    INSERT INTO purchase_events VALUES (2,'basic-row','payment.PAYING',2);
    INSERT INTO purchase_events VALUES (3,'basic-row','payment.PAID',3);
    INSERT INTO purchase_events VALUES (4,'basic-row','delivery.COMPLETE',4);
    INSERT INTO purchase_events VALUES (5,'premium-row','authority.DENIED',5);
    INSERT INTO purchase_events VALUES (6,'revoked-row','authority.DENIED',6);
  `);
  ledger.close();

  const settlement = new DatabaseSync(settlementPath);
  settlement.exec(`
    CREATE TABLE day4_quotes (id TEXT PRIMARY KEY, resource TEXT, requirements TEXT, expires_at INTEGER);
    CREATE TABLE day4_settlements (message_hash TEXT PRIMARY KEY, quote_id TEXT UNIQUE, payload_hash TEXT, status TEXT, receipt TEXT, body TEXT);
  `);
  settlement.prepare('INSERT INTO day4_quotes VALUES (?,?,?,?)').run('day4:AAAAAAAAAAAAAAAAAAAAAA', '/basic', '{}', 1);
  settlement.prepare('INSERT INTO day4_quotes VALUES (?,?,?,?)').run('day4:BBBBBBBBBBBBBBBBBBBBBB', '/premium', '{}', 1);
  settlement.prepare('INSERT INTO day4_quotes VALUES (?,?,?,?)').run('day4:CCCCCCCCCCCCCCCCCCCCCC', '/basic-revoked', '{}', 1);
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
    settlement: { quoteCount: 1, count: 1, states: ['CONFIRMED'], totalQuoteCount: 3, totalSettlementCount: 1 },
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
    decision: { status: 'DENIED', reason: 'SPEND_GRANT_SINGLE_LIMIT_EXCEEDED' }, paymentStatus: 'NOT_STARTED', deliveryStatus: 'NOT_DELIVERED',
    executionMode: 'live_devnet', quotedAmount: '20000000', amountPaid: '0', transactionSignature: null, paymentPayloadPresent: false,
    budget: { paid: '200000', reserved: '0', remaining: '4800000' }, grant: { committed: '200000', remaining: '4800000' },
    settlement: { quoteCount: 1, count: 0, states: [], totalQuoteCount: 3, totalSettlementCount: 1 }, rpcTransaction: { status: 'NOT_APPLICABLE' },
  });
  expect(evidence.events.map(event => event.type)).toEqual(['authority.DENIED']);
  expect(evidence.resourceHash).toBeNull();
});

it('reports a revoked-Grant denial as a complete no-payment proof', async () => {
  const value = await fixture();
  const evidence = await collectE2eEvidence('revoked-request', {
    dataDirectory: value.directory, settlementDatabase: value.settlementPath, config, fetcher: value.fetcher,
  });
  expect(evidence).toMatchObject({
    requestId: 'revoked-request', purchaseId: 'revoked-request', executionMode: 'live_devnet',
    decision: { decision: 'DENIED', status: 'DENIED', reason: 'SPEND_GRANT_REVOKED' },
    paymentStatus: 'NOT_STARTED', deliveryStatus: 'NOT_DELIVERED', amountPaid: '0',
    paymentPayloadPresent: false, transactionSignature: null, resourcePresent: false,
    paymentPayingEventPresent: false, paymentPaidEventPresent: false,
    budget: { paid: '200000', reserved: '0', remaining: '4800000' },
    grant: { status: 'REVOKED', committed: '0', remaining: '5000000' },
    settlement: { quoteCount: 1, count: 0, states: [], totalQuoteCount: 3, totalSettlementCount: 1 },
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

it('reads scoped integer accounting without including another environment or rounding JSON amounts', async () => {
  const value = await fixture();
  const database = new DatabaseSync(join(value.directory, 'app-ledger.sqlite'));
  const scopeId = 'a'.repeat(64); const otherScopeId = 'b'.repeat(64);
  database.exec(`ALTER TABLE purchases ADD COLUMN monetary_scope_id TEXT;
    CREATE TABLE monetary_budget_clock (scope_id TEXT PRIMARY KEY,spending_day TEXT,time_zone TEXT);
    CREATE TABLE monetary_controls (scope_id TEXT PRIMARY KEY,daily_limit TEXT);`);
  database.prepare('UPDATE purchases SET monetary_scope_id=?').run(scopeId);
  database.prepare('INSERT INTO monetary_budget_clock VALUES (?,?,?)').run(scopeId, '2026-09-22', 'Asia/Shanghai');
  database.prepare('INSERT INTO monetary_controls VALUES (?,?)').run(scopeId, '9223372036854775807');
  database.prepare('UPDATE spend_grants SET total_limit=? WHERE id=?').run(9223372036854775807n, grantId);
  database.prepare(`INSERT INTO purchases SELECT 'other-row','other-request','other-approval',purchase,quote,decision,
    'PAYMENT_UNKNOWN',?,NULL,NULL,NULL,payload,'live_mainnet',NULL,? FROM purchases WHERE task_id='basic-request'`)
    .run(9223372036854775807n, otherScopeId);
  database.close();
  const evidence = await collectE2eEvidence('basic-request', { dataDirectory: value.directory, settlementDatabase: value.settlementPath,
    config, fetcher: value.fetcher });
  expect(evidence.budget).toMatchObject({ dailyLimit: '9223372036854775807', paid: '200000', reserved: '0', remaining: '9223372036854575807' });
  expect(evidence.grant).toMatchObject({ committed: '200000', remaining: '9223372036854575807' });
  expect(JSON.parse(JSON.stringify(evidence)).budget.remaining).toBe('9223372036854575807');
});

async function buyerRpcProofFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'yosh-e2e-buyer-rpc-')); directories.push(directory);
  const signer = await generateKeyPairSigner();
  const paymentConfig: PaymentConfig = { ...config, buyer: signer.address };
  const quote: PaymentRequirements = { scheme: 'exact', network: paymentConfig.network, asset: paymentConfig.mint,
    payTo: paymentConfig.merchant, amount: '10000', maxTimeoutSeconds: 300,
    extra: { feePayer: signer.address, memo: 'day4:DDDDDDDDDDDDDDDDDDDDDD' } };
  const payload = await signedPaymentFixture(signer, paymentConfig, quote);
  const identity = createSignedPaymentIdentity(payload, paymentConfig);
  if (!identity.knownSignature) throw new Error('Fixture must have a complete original signature');
  const transaction = identity.knownSignature;
  const now = Date.parse('2026-09-22T00:00:00Z');
  const ledgerPath = join(directory, 'app-ledger.sqlite');
  const ledger = new PurchaseLedger(ledgerPath, { managed: true, mode: 'live_devnet', walletIdentity: signer.address,
    now: () => now, timeZone: () => 'Asia/Shanghai' });
  let purchaseId: string;
  try {
    ledger.setDailyLimit('5000000');
    const resource = createStaticResourceRegistry({ endpoint: 'https://fixture.invalid', asset_id: paymentConfig.mint,
      network: paymentConfig.network, allowed_pay_to: paymentConfig.merchant })[0];
    const intent = createMarketSnapshotSpendIntent({ idempotencyKey: 'buyer-rpc-request', request: { asset: 'SOL' },
      requestHash: hash('buyer-rpc-request'), resource, quote, executionBinding: 'e2e-buyer-rpc-binding', now });
    const reservation = ledger.reserve(intent, quote, now, 'live_devnet');
    purchaseId = intent.id;
    ledger.claim(reservation.approvalId);
    const original = OriginalPaymentRecordSchema.parse({ version: 1, purchaseId: intent.id, requestId: intent.idempotencyKey,
      monetaryScope: reservation.monetaryScope, scopeId: monetaryScopeId(reservation.monetaryScope),
      executionBinding: intent.executionBinding, quoteFingerprint: intent.quoteFingerprint, payloadHash: hash(payload),
      recordedAt: now, identity });
    ledger.savePayload(reservation.approvalId, payload, undefined, original);
    ledger.markSubmissionAttempt(reservation.approvalId);
    ledger.confirmOriginalPayment(reservation.approvalId, transaction, 'confirmed', now);
  } finally { ledger.close(); }
  const settlementPath = join(directory, 'settlements.sqlite');
  const settlements = new DatabaseSync(settlementPath);
  settlements.exec(`CREATE TABLE day4_quotes (id TEXT PRIMARY KEY);
    CREATE TABLE day4_settlements (quote_id TEXT,status TEXT,receipt TEXT,body TEXT);`);
  settlements.close();
  const requestedAccounts: string[] = [];
  const buyerAta = await getStandardTokenAccount(signer.address, paymentConfig.mint);
  const merchantAta = await getStandardTokenAccount(paymentConfig.merchant, paymentConfig.mint);
  const tokenAccount = (owner: string) => ({ owner: TOKEN_PROGRAM, data: { parsed: { type: 'account', info: {
    owner, mint: paymentConfig.mint, tokenAmount: { amount: '1000000', decimals: 6 },
  } } } });
  const rpcRequest = z.object({ method: z.string(), params: z.array(z.unknown()) });
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const request = rpcRequest.parse(JSON.parse(String(init?.body)));
    if (request.method === 'getMultipleAccounts') {
      const accounts = z.array(z.string()).parse(request.params[0]); requestedAccounts.push(...accounts);
      return Response.json({ result: { value: accounts.map(account => account === buyerAta ? tokenAccount(signer.address)
        : account === merchantAta ? tokenAccount(paymentConfig.merchant) : null) } });
    }
    if (request.method === 'getSignatureStatuses') return Response.json({ result: { value: [{ err: null, confirmationStatus: 'confirmed' }] } });
    if (request.method === 'getTransaction') return Response.json({ result: { meta: { err: null } } });
    throw new Error('Unexpected RPC method');
  });
  return { directory, ledgerPath, settlementPath, config: paymentConfig, fetcher, buyerAta, requestedAccounts, payload,
    transaction, purchaseId, identity };
}

it('reports cryptographically bound V3 buyer RPC payment without requiring merchant settlement or exposing raw evidence', async () => {
  const value = await buyerRpcProofFixture();
  const evidence = await collectE2eEvidence('buyer-rpc-request', { dataDirectory: value.directory,
    settlementDatabase: value.settlementPath, config: { ...value.config, buyer: config.buyer }, fetcher: value.fetcher });
  expect(evidence).toMatchObject({ executionMode: 'live_devnet', paymentStatus: 'PAID', deliveryStatus: 'PENDING',
    buyer: { address: value.config.buyer, tokenAccount: value.buyerAta }, amountPaid: '10000',
    historicalBuyerEvidenceComplete: true, buyerMatchesPaymentEvidence: true, buyerMatchesSettlement: false,
    livePaymentProof: { verified: true, settlementConfirmed: false, chainConfirmation: 'confirmed' },
    settlement: { count: 0, quoteCount: 0 }, budget: { paid: '10000', reserved: '0', remaining: '4990000' } });
  expect(value.requestedAccounts).toContain(value.buyerAta);
  const output = JSON.stringify(evidence);
  expect(output).not.toContain(String(value.payload.payload.transaction));
  // For a buyer-paid fee the buyer signature is also the public transaction ID.
  // Public transaction evidence is allowed; the signed payload/identity object is not.
  expect(evidence.transactionSignature).toBe(value.transaction);
  expect(output).not.toContain('"buyerSignature"');
  expect(output).not.toContain('"wireHash"');
  expect(output).not.toContain('e2e-buyer-rpc-binding');
  expect(output).not.toContain('originalEvidenceHash');
});

it.each(['buyerSignature', 'recipient', 'messageHash'] as const)('rejects tampered V3 %s side evidence even when its wrapper proof hash is updated', async field => {
  const value = await buyerRpcProofFixture();
  const database = new DatabaseSync(value.ledgerPath);
  try {
    const row = database.prepare('SELECT evidence FROM original_payments WHERE purchase_id=?').get(value.purchaseId);
    const original = OriginalPaymentRecordSchema.parse(JSON.parse(String(row?.evidence)));
    const identity = { ...original.identity, [field]: field === 'messageHash' ? 'a'.repeat(64)
      : field === 'recipient' ? config.buyer : signature };
    const changed = { ...original, identity };
    const proofRow = database.prepare('SELECT payment_evidence FROM purchases WHERE id=?').get(value.purchaseId);
    const proof = z.record(z.string(), z.unknown()).parse(JSON.parse(String(proofRow?.payment_evidence)));
    // Model an imported/corrupt database, not an allowed runtime mutation; keep
    // proof hashes internally consistent so the signed-payload check must reject it.
    database.exec('DROP TRIGGER original_payment_evidence_immutable');
    database.prepare('UPDATE original_payments SET evidence=? WHERE purchase_id=?').run(JSON.stringify(changed), value.purchaseId);
    database.prepare('UPDATE purchases SET payment_evidence=? WHERE id=?').run(JSON.stringify({ ...proof,
      originalEvidenceHash: hash(changed), ...(field === 'messageHash' ? { messageHash: identity.messageHash } : {}) }), value.purchaseId);
  } finally { database.close(); }
  await expect(collectE2eEvidence('buyer-rpc-request', { dataDirectory: value.directory,
    settlementDatabase: value.settlementPath, config: value.config, fetcher: value.fetcher })).rejects.toThrow('E2E_EVIDENCE_INTEGRITY_ERROR');
  expect(value.fetcher).not.toHaveBeenCalled();
});

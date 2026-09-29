import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FacilitatorClient } from '@x402/core/server';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { Keypair } from '@solana/web3.js';
import { expect, it, vi } from 'vitest';
import { MARKET_SNAPSHOT_OPERATION } from '../../src/modules/authority/spend-grant';
import { createPaidMarketApi } from '../../src/modules/paid-market-api/paid-market-api';
import { SettlementStore } from '../../src/modules/paid-market-api/settlement-store';
import { DEVNET_NETWORK, DEVNET_USDC_MINT, type PaymentConfig } from '../../src/modules/payment/payment-config';
import { paymentEndpointForIntent } from '../../src/modules/purchases/approved-payment';
import { readPaidResourceQuotes } from '../../src/modules/purchases/paid-resource-quote';
import { PurchaseLedger } from '../../src/modules/purchases/purchase-ledger';
import { PurchaseRequestInputSchema, requestPaidResourcePurchase } from '../../src/modules/purchases/request-paid-resource-purchase';
import { PAID_RESOURCE_SCOPE_ID } from '../../src/modules/resources/paid-resources';
import { DEMO_MARKET_DATA_PROVIDER_ID } from '../../src/modules/resources/static-resource-registry';

const buyer = Keypair.generate().publicKey.toBase58();
const merchant = Keypair.generate().publicKey.toBase58();
const feePayer = Keypair.generate().publicKey.toBase58();
const config: PaymentConfig = { cluster: 'devnet', rpcUrl: 'https://api.devnet.solana.com', network: DEVNET_NETWORK,
  mint: DEVNET_USDC_MINT, buyer, merchant, facilitatorUrl: 'https://facilitator.invalid' };
const memberId = '11111111-1111-4111-8111-111111111111';
const principal = { cardMemberId: memberId, connectionId: '2c187121-f6f1-49a3-aea4-821c4bc0a662', connectionGeneration: 2 };
const now = Date.parse('2026-09-24T03:00:00Z');
const origin = 'http://127.0.0.1:3049';

function setup(path = ':memory:') {
  const ledger = new PurchaseLedger(path, { managed: true, requireSpendGrant: true, now: () => now,
    timeZone: () => 'Asia/Shanghai', defaultCardMemberId: memberId });
  ledger.setDailyLimit('1000000');
  ledger.createSpendGrant({ totalLimit: '400000', singleLimit: '200000', expiresAt: now + 60 * 60 * 1000 }, principal, {
    resourceId: PAID_RESOURCE_SCOPE_ID, providerId: DEMO_MARKET_DATA_PROVIDER_ID, operation: MARKET_SNAPSHOT_OPERATION,
    network: config.network, assetId: config.mint, assetDecimals: 6, payTo: config.merchant, paymentScheme: 'exact',
  }, now);
  const facilitator = { getSupported: vi.fn(async () => ({ kinds: [{ x402Version: 2 as const, scheme: 'exact', network: config.network,
    extra: { feePayer } }], extensions: [], signers: {} })), verify: vi.fn(), settle: vi.fn() } satisfies FacilitatorClient;
  const store = new SettlementStore(':memory:');
  const paidApi = createPaidMarketApi(config, facilitator, store);
  const fetcher = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input));
    return paidApi({ asset: url.searchParams.get('asset'), resource: url.pathname.endsWith('/market-analysis') ? 'analysis' : 'snapshot' });
  });
  return { ledger, store, facilitator, fetcher };
}
const request = (requestId: string, resourceId: 'market-snapshot' | 'market-analysis') => ({ requestId, resourceId, reason: 'Need SOL data' });

it('quotes both real 402 resources, then evaluates the same resource and amount under one Grant', async () => {
  const f = setup();
  try {
    const listed = await readPaidResourceQuotes(origin, config, f.fetcher);
    expect(listed.resources).toMatchObject([
      { resourceId: 'market-snapshot', resourceUrl: '/api/paid/sol-market-snapshot?asset=SOL', amount: '200000', display: '0.20 test USDC' },
      { resourceId: 'market-analysis', resourceUrl: '/api/paid/market-analysis?asset=SOL', amount: '20000000', display: '20.00 test USDC' },
    ]);
    const pay = vi.fn();
    const snapshot = await requestPaidResourcePurchase(request('snapshot-policy', 'market-snapshot'),
      { config, ledger: f.ledger, origin, principal, fetcher: f.fetcher, now: () => now, execute: false, pay });
    const analysis = await requestPaidResourcePurchase(request('analysis-policy', 'market-analysis'),
      { config, ledger: f.ledger, origin, principal, fetcher: f.fetcher, now: () => now, execute: false, pay });
    expect(snapshot).toMatchObject({ amount: '200000', status: 'APPROVED', executionMode: 'simulated',
      quote: { resourceId: 'market-snapshot', resourceUrl: listed.resources[0].resourceUrl, amount: listed.resources[0].amount } });
    expect(analysis).toMatchObject({ amount: '20000000', status: 'DENIED',
      decision: { reason: 'SPEND_GRANT_SINGLE_LIMIT_EXCEEDED' }, quote: { resourceId: 'market-analysis', resourceUrl: listed.resources[1].resourceUrl } });
    expect(f.ledger.get('snapshot-policy')?.intent).toMatchObject({ resourceScopeId: PAID_RESOURCE_SCOPE_ID,
      resourcePath: '/api/paid/sol-market-snapshot?asset=SOL' });
    expect(f.ledger.get('analysis-policy')?.intent).toMatchObject({ resourceScopeId: PAID_RESOURCE_SCOPE_ID,
      resourcePath: '/api/paid/market-analysis?asset=SOL' });
    expect(pay).not.toHaveBeenCalled();
    expect(f.facilitator.verify).not.toHaveBeenCalled();
    expect(f.facilitator.settle).not.toHaveBeenCalled();
  } finally { f.ledger.close(); f.store.close(); }
});

it('takes no Agent amount, price, offerId, payTo, or arbitrary requirements', () => {
  for (const extra of [{ amount: '1' }, { price: '1' }, { offerId: 'basic' }, { payTo: buyer }, { requirements: {} }]) {
    expect(PurchaseRequestInputSchema.safeParse({ ...request('strict-schema', 'market-snapshot'), ...extra }).success).toBe(false);
  }
});

it('rejects a 402 for the wrong registered resource before any reservation', async () => {
  const f = setup();
  try {
    const wrong = vi.fn<typeof fetch>(async input => {
      const response = await f.fetcher(input);
      const required = JSON.parse(Buffer.from(response.headers.get('PAYMENT-REQUIRED')!, 'base64').toString('utf8'));
      required.resource.url = '/api/paid/market-analysis?asset=SOL';
      return new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(required) } });
    });
    await expect(requestPaidResourcePurchase(request('wrong-quote', 'market-snapshot'),
      { config, ledger: f.ledger, origin, principal, fetcher: wrong, now: () => now, execute: false })).rejects.toThrow('INVALID_X402_QUOTE');
    expect(f.ledger.get('wrong-quote')).toBeUndefined();
  } finally { f.ledger.close(); f.store.close(); }
});

it('routes a live approval to the existing executor with persisted 402 terms and no offerId', async () => {
  const f = setup();
  const pay = vi.fn(async (ledger: PurchaseLedger, approvalId: string, _config: PaymentConfig, endpoint: string) => {
    const record = ledger.get('live-snapshot')!;
    expect(record.intent.offerId).toBeUndefined();
    expect(record.quote.amount).toBe('200000');
    expect(endpoint).toBe(`${origin}/api/paid/sol-market-snapshot?asset=SOL`);
    expect(paymentEndpointForIntent(origin, record.intent)).toBe(endpoint);
    expect(record.intent.quoteFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(approvalId).toBe(record.approvalId);
    return { transaction: '1'.repeat(88), data: {} };
  });
  try {
    const first = await requestPaidResourcePurchase(request('live-snapshot', 'market-snapshot'),
      { config, ledger: f.ledger, origin, principal, fetcher: f.fetcher, now: () => now, pay });
    expect(first).toMatchObject({ status: 'APPROVED', amount: '200000', reused: false });
    expect(pay).toHaveBeenCalledOnce();
    await requestPaidResourcePurchase(request('live-snapshot', 'market-snapshot'),
      { config, ledger: f.ledger, origin, principal, fetcher: f.fetcher, now: () => now, pay });
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(pay).toHaveBeenCalledTimes(2);
    await expect(requestPaidResourcePurchase(request('live-snapshot', 'market-analysis'),
      { config, ledger: f.ledger, origin, principal, fetcher: f.fetcher, now: () => now, pay })).rejects.toThrow('REQUEST_ID_CONFLICT');
  } finally { f.ledger.close(); f.store.close(); }
});

it('reopens new purchases without offerId and reconstructs the exact selected endpoint', async () => {
  const directory = mkdtempSync(join(tmpdir(), '2049-resource-recovery-'));
  const path = join(directory, 'ledger.sqlite');
  const f = setup(path);
  try {
    await requestPaidResourcePurchase(request('restart-resource', 'market-snapshot'),
      { config, ledger: f.ledger, origin, principal, fetcher: f.fetcher, now: () => now, execute: false });
    f.ledger.close();
    const reopened = new PurchaseLedger(path, { managed: true, requireSpendGrant: true, now: () => now, timeZone: () => 'Asia/Shanghai' });
    try {
      const record = reopened.get('restart-resource')!;
      expect(record.intent.offerId).toBeUndefined();
      expect(record.intent.resourcePath).toBe('/api/paid/sol-market-snapshot?asset=SOL');
      expect(paymentEndpointForIntent(origin, record.intent)).toBe(`${origin}${record.intent.resourcePath}`);
      expect(record.quote.amount).toBe('200000');
    } finally { reopened.close(); }
  } finally { f.store.close(); rmSync(directory, { recursive: true, force: true }); }
});

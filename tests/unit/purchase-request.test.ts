import { randomUUID } from 'node:crypto';
import type { FacilitatorClient } from '@x402/core/server';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { Keypair } from '@solana/web3.js';
import { afterEach, expect, it, vi } from 'vitest';
import { MARKET_SNAPSHOT_OPERATION } from '../../src/modules/authority/spend-grant';
import { createPaidMarketApi } from '../../src/modules/paid-market-api/paid-market-api';
import { SettlementStore } from '../../src/modules/paid-market-api/settlement-store';
import { DEVNET_NETWORK, DEVNET_USDC_MINT, type PaymentConfig } from '../../src/modules/payment/payment-config';
import { readPaymentRequiredHeader } from '../../src/modules/payment/x402-client';
import { PurchaseLedger } from '../../src/modules/purchases/purchase-ledger';
import { requestMarketPurchase } from '../../src/modules/purchases/request-market-purchase';
import { DEMO_MARKET_DATA_PROVIDER_ID, SOL_MARKET_SNAPSHOT_RESOURCE_ID } from '../../src/modules/resources/static-resource-registry';

const buyer = Keypair.generate().publicKey.toBase58();
const merchant = Keypair.generate().publicKey.toBase58();
const feePayer = Keypair.generate().publicKey.toBase58();
const config: PaymentConfig = { cluster: 'devnet', rpcUrl: 'https://api.devnet.solana.com', network: DEVNET_NETWORK,
  mint: DEVNET_USDC_MINT, buyer, merchant, facilitatorUrl: 'https://facilitator.invalid' };
const principal = { connectionId: '2c187121-f6f1-49a3-aea4-821c4bc0a662', connectionGeneration: 2 };
const now = Date.parse('2026-09-22T08:00:00Z');

function facilitator() {
  return {
    getSupported: vi.fn(async () => ({ kinds: [{ x402Version: 2 as const, scheme: 'exact', network: config.network, extra: { feePayer } }], extensions: [], signers: {} })),
    verify: vi.fn(async () => ({ isValid: true, payer: buyer })),
    settle: vi.fn(async () => ({ success: true, transaction: 'not-used', payer: buyer, network: config.network })),
  } satisfies FacilitatorClient;
}

function setup(totalLimit = '5000000') {
  const ledger = new PurchaseLedger(':memory:', { managed: true, requireSpendGrant: true, now: () => now, timeZone: () => 'Asia/Shanghai' });
  ledger.setDailyLimit('50000000');
  ledger.createSpendGrant({ totalLimit, singleLimit: String(Math.min(Number(totalLimit), 500_000)), expiresAt: now + 60 * 60 * 1000 }, principal, {
    resourceId: SOL_MARKET_SNAPSHOT_RESOURCE_ID, providerId: DEMO_MARKET_DATA_PROVIDER_ID, operation: MARKET_SNAPSHOT_OPERATION,
    network: config.network, assetId: config.mint, assetDecimals: 6, payTo: config.merchant, paymentScheme: 'exact',
  }, now);
  const remote = facilitator();
  const store = new SettlementStore(':memory:');
  const paidApi = createPaidMarketApi(config, remote, store);
  const fetcher = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input));
    return paidApi({ asset: url.searchParams.get('asset'), offer: url.searchParams.get('offer') });
  });
  return { ledger, remote, fetcher, store };
}

afterEach(() => vi.restoreAllMocks());

it('runs real quote → SpendGrant → policy for APPROVED and DENIED without payment', async () => {
  const { ledger, remote, fetcher, store } = setup();
  const claim = vi.spyOn(ledger, 'claim');
  try {
    const basic = await requestMarketPurchase({ requestId: 'request-basic', offerId: 'basic', reason: 'Need the SOL snapshot' },
      { config, ledger, origin: 'http://127.0.0.1:3049', principal, fetcher, now: () => now });
    const premium = await requestMarketPurchase({ requestId: 'request-premium', offerId: 'premium', reason: 'Compare the premium offer' },
      { config, ledger, origin: 'http://127.0.0.1:3049', principal, fetcher, now: () => now });
    expect(basic).toMatchObject({ amount: '200000', status: 'APPROVED', paymentStatus: 'NOT_STARTED', decision: { decision: 'APPROVED', reason: 'AUTHORITY_BUDGET_AND_GRANT_PASSED' } });
    expect(premium).toMatchObject({ amount: '20000000', status: 'DENIED', paymentStatus: 'NOT_STARTED', decision: { decision: 'DENIED', reason: 'SPEND_GRANT_SINGLE_LIMIT_EXCEEDED' } });
    expect(basic.quote).toMatchObject({ resourceId: SOL_MARKET_SNAPSHOT_RESOURCE_ID, network: config.network, assetId: config.mint, payTo: config.merchant, amount: '200000' });
    expect(basic.grant).toMatchObject({ id: expect.any(String), version: 1 });
    expect(premium.grant.id).toBe(basic.grant.id);
    expect(ledger.list()).toHaveLength(2);
    expect(ledger.spendGrantSummary(now)).toMatchObject({ committed: '200000', remaining: '4800000' });
    expect(remote.verify).not.toHaveBeenCalled();
    expect(remote.settle).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  } finally { ledger.close(); store.close(); }
});

it('replays the same request without another quote and rejects changed input', async () => {
  const { ledger, remote, fetcher, store } = setup();
  const input = { requestId: 'stable-request', offerId: 'basic' as const, reason: 'Need the SOL snapshot' };
  try {
    const first = await requestMarketPurchase(input, { config, ledger, origin: 'http://127.0.0.1:3049', principal, fetcher, now: () => now });
    const replay = await requestMarketPurchase(input, { config, ledger, origin: 'http://127.0.0.1:3049', principal, fetcher, now: () => now });
    expect(replay).toMatchObject({ purchaseId: first.purchaseId, status: 'APPROVED', reused: true });
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(requestMarketPurchase({ ...input, offerId: 'premium' }, { config, ledger, origin: 'http://127.0.0.1:3049', principal, fetcher, now: () => now })).rejects.toThrow('REQUEST_ID_CONFLICT');
    await expect(requestMarketPurchase(input, { config, ledger, origin: 'http://127.0.0.1:3049', principal: { ...principal, connectionGeneration: 99 }, fetcher, now: () => now })).rejects.toThrow('PURCHASE_REQUEST_OWNER_MISMATCH');
    expect(ledger.list()).toHaveLength(1);
    expect(remote.verify).not.toHaveBeenCalled(); expect(remote.settle).not.toHaveBeenCalled();
  } finally { ledger.close(); store.close(); }
});

it('rejects Agent-supplied payment terms before fetching a quote', async () => {
  const { ledger, remote, fetcher, store } = setup();
  try {
    await expect(requestMarketPurchase({ requestId: 'forged-terms', offerId: 'basic', reason: 'Need data',
      amount: '1', payTo: buyer, approved: true, transaction: 'forged' },
    { config, ledger, origin: 'http://127.0.0.1:3049', principal, fetcher, now: () => now })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(ledger.list()).toHaveLength(0);
    expect(remote.verify).not.toHaveBeenCalled(); expect(remote.settle).not.toHaveBeenCalled();
  } finally { ledger.close(); store.close(); }
});

it('rejects a changed server quote before reserving any budget', async () => {
  const { ledger, remote, fetcher, store } = setup();
  const changed = vi.fn<typeof fetch>(async input => {
    const response = await fetcher(input);
    const required = readPaymentRequiredHeader(response.headers.get('PAYMENT-REQUIRED')!);
    required.accepts[0].amount = '1';
    return new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(required) } });
  });
  try {
    await expect(requestMarketPurchase({ requestId: 'changed-quote', offerId: 'basic', reason: 'Need data' },
      { config, ledger, origin: 'http://127.0.0.1:3049', principal, fetcher: changed, now: () => now })).rejects.toThrow('INVALID_X402_QUOTE');
    expect(ledger.list()).toHaveLength(0);
    expect(ledger.spendGrantSummary(now)?.committed).toBe('0');
    expect(remote.verify).not.toHaveBeenCalled(); expect(remote.settle).not.toHaveBeenCalled();
  } finally { ledger.close(); store.close(); }
});

it('atomically applies the grant total to concurrent quoted requests', async () => {
  const { ledger, remote, fetcher, store } = setup('300000');
  try {
    const results = await Promise.all(['one', 'two'].map(id => requestMarketPurchase({ requestId: `request-${id}-${randomUUID()}`, offerId: 'basic', reason: 'Need data' },
      { config, ledger, origin: 'http://127.0.0.1:3049', principal, fetcher, now: () => now })));
    expect(results.map(value => value.decision.reason).sort()).toEqual(['AUTHORITY_BUDGET_AND_GRANT_PASSED', 'SPEND_GRANT_TOTAL_LIMIT_EXCEEDED']);
    expect(remote.verify).not.toHaveBeenCalled(); expect(remote.settle).not.toHaveBeenCalled();
  } finally { ledger.close(); store.close(); }
});

it('does not create a request when the grant is revoked while the quote is in flight', async () => {
  const { ledger, remote, store } = setup();
  const paidApi = createPaidMarketApi(config, remote, store);
  const fetcher = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input));
    const response = await paidApi({ asset: 'SOL', offer: url.searchParams.get('offer') });
    ledger.revokeActiveSpendGrant(now + 1);
    return response;
  });
  try {
    await expect(requestMarketPurchase({ requestId: 'revoked-during-quote', offerId: 'basic', reason: 'Need data' },
      { config, ledger, origin: 'http://127.0.0.1:3049', principal, fetcher, now: () => now + 2 })).rejects.toThrow('SPEND_GRANT_INACTIVE');
    expect(ledger.list()).toHaveLength(0);
    expect(remote.verify).not.toHaveBeenCalled(); expect(remote.settle).not.toHaveBeenCalled();
  } finally { ledger.close(); store.close(); }
});

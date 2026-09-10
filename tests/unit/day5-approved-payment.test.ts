import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectOriginalTransaction } from '../../src/modules/payment/reconcile-transaction';
vi.mock('../../src/modules/payment/reconcile-transaction', () => ({ inspectOriginalTransaction: vi.fn(), transactionMessageHash: () => 'original-message' }));
import { randomUUID } from 'node:crypto';
import { generateKeyPairSigner } from '@solana/kit';
import { afterEach, expect, it, vi } from 'vitest';
import { loadDay4Buyer } from '../../src/modules/payment/day4-wallet';
import { prepareDay4Payment, confirmDay4Transaction } from '../../src/modules/payment/day4-payment';
import { loadDay4Config } from '../../src/modules/payment/day4-config';
import { createStaticResourceRegistry } from '../../src/modules/resources/static-resource-registry';
import { PurchaseLedger } from '../../src/modules/purchases/purchase-ledger';
import { executeApprovedPayment, recoverApprovedPayment, paymentBinding } from '../../src/modules/purchases/approved-payment';
import { hash } from '../../src/modules/purchases/spending-policy';
vi.mock('../../src/modules/payment/day4-wallet', () => ({ loadDay4Buyer: vi.fn() }));
vi.mock('../../src/modules/payment/day4-payment', () => ({ MARKET_RESOURCE: '/api/paid/market-snapshot?asset=SOL', prepareDay4Payment: vi.fn(), confirmDay4Transaction: vi.fn() }));
const endpoint = 'http://127.0.0.1:3000/api/paid/market-snapshot?asset=SOL';
async function fixture(path = ':memory:') {
  vi.clearAllMocks();
  const signer = await generateKeyPairSigner();
  vi.mocked(loadDay4Buyer).mockResolvedValue(signer);
  const config = loadDay4Config({ DEMO_BUYER_PUBLIC_KEY: signer.address, DEMO_MERCHANT_PUBLIC_KEY: '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs' });
  const resource = createStaticResourceRegistry({ endpoint: 'https://example.com', asset_id: config.mint, network: config.network, allowed_pay_to: config.merchant })[0];
  const quote = { scheme: 'exact', network: config.network, asset: config.mint, amount: '10000', payTo: config.merchant, maxTimeoutSeconds: 300, extra: {} };
  vi.mocked(prepareDay4Payment).mockResolvedValue({ x402Version: 2, accepted: quote, payload: { transaction: 'test-wire' } });
  const ledger = new PurchaseLedger(path); const now = Date.now();
  const record = ledger.reserve({ id: randomUUID(), taskId: 'task', taskHash: hash('task'), resourceId: resource.resource_id, providerId: resource.provider_id, input: { asset: 'SOL' }, amount: 10000, currency: 'USDC', decimals: 6, mint: config.mint, network: config.network, payTo: config.merchant, scheme: 'exact', quoteFingerprint: hash(quote), createdAt: now, expiresAt: now + 300000, binding: paymentBinding(config, endpoint) }, quote, resource);
  return { ledger, record, config };
}
afterEach(() => vi.unstubAllGlobals());
it('unknown approval never accesses the wallet', async () => {
  const f = await fixture();
  try { await expect(executeApprovedPayment(f.ledger, 'untrusted-id', f.config, endpoint)).rejects.toThrow('Unknown approval'); expect(loadDay4Buyer).not.toHaveBeenCalled(); }
  finally { f.ledger.close(); }
});
it('binding mismatch stops before key access', async () => {
  const f = await fixture();
  try { await expect(executeApprovedPayment(f.ledger, f.record.approvalId, f.config, endpoint + '&changed=true')).rejects.toThrow('reconciliation'); expect(loadDay4Buyer).not.toHaveBeenCalled(); }
  finally { f.ledger.close(); }
});
it('network timeout retains UNKNOWN and prevents a second signature', async () => {
  const f = await fixture(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
  try {
    await expect(executeApprovedPayment(f.ledger, f.record.approvalId, f.config, endpoint)).rejects.toThrow('reconciliation');
    expect(f.ledger.get('task')?.status).toBe('PAYMENT_UNKNOWN');
    await expect(executeApprovedPayment(f.ledger, f.record.approvalId, f.config, endpoint)).rejects.toThrow('inactive');
    expect(prepareDay4Payment).toHaveBeenCalledTimes(1);
  } finally { f.ledger.close(); }
});
it('a receipt for another payer cannot mark the purchase paid', async () => {
  const f = await fixture();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success: true, network: f.config.network, payer: f.config.merchant, transaction: '1'.repeat(88) })).toString('base64') } })));
  try {
    await expect(executeApprovedPayment(f.ledger, f.record.approvalId, f.config, endpoint)).rejects.toThrow('reconciliation');
    expect(f.ledger.get('task')?.status).toBe('PAYMENT_UNKNOWN'); expect(confirmDay4Transaction).not.toHaveBeenCalled();
  } finally { f.ledger.close(); }
});

const snapshot = { asset: 'SOL', as_of: '2026-09-05T08:00:00Z', spot_price_usd: 140, change_24h_pct: 2.4, volume_24h_usd: 3000000000, market_cap_usd: 75000000000, volatility_7d_pct: 5.8, rsi_14d: 57, support_levels_usd: [132,136], resistance_levels_usd: [145,151], source_label: 'Demo snapshot fixture', is_demo_snapshot: true };
function paidResponse(config: Awaited<ReturnType<typeof fixture>>['config'], body = JSON.stringify(snapshot), success = true) {
  return new Response(body, { status: success ? 200 : 402, headers: { 'Content-Type': 'application/json', 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success, network: config.network, payer: config.buyer, amount: '10000', transaction: '1'.repeat(88) })).toString('base64') } });
}
it('lost response recovers using identical saved payload without wallet access or resubmission', async () => {
  const f = await fixture(); const fetcher = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockImplementation(() => Promise.resolve(paidResponse(f.config))); vi.stubGlobal('fetch', fetcher);
  vi.mocked(inspectOriginalTransaction).mockResolvedValue({ status: 'CONFIRMED', transaction: '1'.repeat(88) });
  try {
    await expect(executeApprovedPayment(f.ledger, f.record.approvalId, f.config, endpoint)).rejects.toThrow();
    await Promise.all([1,2].map(() => recoverApprovedPayment(f.ledger, 'task', f.config, endpoint)));
    expect(f.ledger.get('task')?.status).toBe('PAID');
    expect(fetcher.mock.calls[1][1].headers['PAYMENT-RECOVERY']).toBe('1');
    expect(fetcher.mock.calls[0][1].headers['PAYMENT-SIGNATURE']).toBe(fetcher.mock.calls[1][1].headers['PAYMENT-SIGNATURE']);
    expect(loadDay4Buyer).toHaveBeenCalledTimes(1); expect(prepareDay4Payment).toHaveBeenCalledTimes(1);
    expect(f.ledger.events('task').filter(e => e.type === 'payment.PAID')).toHaveLength(1);
  } finally { f.ledger.close(); }
});
it.each([JSON.stringify({ ...snapshot, rsi_14d: 999 }), JSON.stringify(snapshot) + ' '.repeat(17000)])('invalid or oversized paid data remains unavailable to the agent', async body => {
  const f = await fixture(); vi.stubGlobal('fetch', vi.fn(async () => paidResponse(f.config, body)));
  vi.mocked(inspectOriginalTransaction).mockResolvedValue({ status: 'CONFIRMED', transaction: '1'.repeat(88) });
  try {
    await expect(executeApprovedPayment(f.ledger, f.record.approvalId, f.config, endpoint)).rejects.toThrow();
    await recoverApprovedPayment(f.ledger, 'task', f.config, endpoint);
    expect(f.ledger.get('task')?.status).toBe('PAYMENT_UNKNOWN'); expect(f.ledger.get('task')?.data).toBeUndefined();
  } finally { f.ledger.close(); }
});
it('a receipt for an unrelated confirmed transaction never completes a purchase', async () => {
  const f = await fixture(); vi.stubGlobal('fetch', vi.fn(async () => paidResponse(f.config)));
  vi.mocked(inspectOriginalTransaction).mockResolvedValue({ status: 'UNKNOWN' });
  try { await expect(executeApprovedPayment(f.ledger, f.record.approvalId, f.config, endpoint)).rejects.toThrow(); expect(f.ledger.get('task')?.status).toBe('PAYMENT_UNKNOWN'); }
  finally { f.ledger.close(); }
});
it('only proven chain failure releases the payment reservation', async () => {
  const f = await fixture(); vi.stubGlobal('fetch', vi.fn(async () => paidResponse(f.config, '{}', false)));
  vi.mocked(inspectOriginalTransaction).mockResolvedValue({ status: 'FAILED', transaction: '1'.repeat(88) });
  try { await expect(executeApprovedPayment(f.ledger, f.record.approvalId, f.config, endpoint)).rejects.toThrow(); expect(f.ledger.get('task')?.status).toBe('FAILED'); expect(f.ledger.get('task')?.data).toBeUndefined(); }
  finally { f.ledger.close(); }
});
it('a simulation failure releases the unsubmitted approval without any network submission', async () => {
  const f = await fixture(); vi.mocked(prepareDay4Payment).mockRejectedValueOnce(new Error('simulation failed')); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  try { await expect(executeApprovedPayment(f.ledger, f.record.approvalId, f.config, endpoint)).rejects.toThrow(); expect(f.ledger.get('task')?.status).toBe('FAILED'); expect(fetcher).not.toHaveBeenCalled(); }
  finally { f.ledger.close(); }
});

it('recovers a client crash using the persisted original payload after reopening SQLite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'day6-client-')); const path = join(dir, 'ledger.sqlite');
  const f = await fixture(path);
  f.ledger.claim(f.record.approvalId);
  const payload = { x402Version: 2, accepted: f.record.quote, payload: { transaction: 'test-wire' } };
  f.ledger.savePayload(f.record.approvalId, payload);
  f.ledger.close();
  const reopened = new PurchaseLedger(path);
  vi.stubGlobal('fetch', vi.fn(async () => paidResponse(f.config)));
  vi.mocked(inspectOriginalTransaction).mockResolvedValue({ status: 'CONFIRMED', transaction: '1'.repeat(88) });
  try {
    await recoverApprovedPayment(reopened, 'task', f.config, endpoint);
    expect(reopened.get('task')?.status).toBe('PAID');
    expect(loadDay4Buyer).not.toHaveBeenCalled(); expect(prepareDay4Payment).not.toHaveBeenCalled();
  } finally { reopened.close(); rmSync(dir, { recursive: true, force: true }); }
});

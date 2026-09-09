import { randomUUID } from 'node:crypto';
import { generateKeyPairSigner } from '@solana/kit';
import { afterEach, expect, it, vi } from 'vitest';
import { loadDay4Buyer } from '../../src/modules/payment/day4-wallet';
import { prepareDay4Payment, confirmDay4Transaction } from '../../src/modules/payment/day4-payment';
import { loadDay4Config } from '../../src/modules/payment/day4-config';
import { createStaticResourceRegistry } from '../../src/modules/resources/static-resource-registry';
import { PurchaseLedger } from '../../src/modules/purchases/purchase-ledger';
import { executeApprovedPayment, paymentBinding } from '../../src/modules/purchases/approved-payment';
import { hash } from '../../src/modules/purchases/spending-policy';
vi.mock('../../src/modules/payment/day4-wallet', () => ({ loadDay4Buyer: vi.fn() }));
vi.mock('../../src/modules/payment/day4-payment', () => ({ MARKET_RESOURCE: '/api/paid/market-snapshot?asset=SOL', prepareDay4Payment: vi.fn(), confirmDay4Transaction: vi.fn() }));
const endpoint = 'http://127.0.0.1:3000/api/paid/market-snapshot?asset=SOL';
async function fixture() {
  vi.clearAllMocks();
  const signer = await generateKeyPairSigner();
  vi.mocked(loadDay4Buyer).mockResolvedValue(signer);
  const config = loadDay4Config({ DEMO_BUYER_PUBLIC_KEY: signer.address, DEMO_MERCHANT_PUBLIC_KEY: '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs' });
  const resource = createStaticResourceRegistry({ endpoint: 'https://example.com', asset_id: config.mint, network: config.network, allowed_pay_to: config.merchant })[0];
  const quote = { scheme: 'exact', network: config.network, asset: config.mint, amount: '10000', payTo: config.merchant, maxTimeoutSeconds: 300, extra: {} };
  vi.mocked(prepareDay4Payment).mockResolvedValue({ x402Version: 2, accepted: quote, payload: { transaction: 'test-wire' } });
  const ledger = new PurchaseLedger(':memory:'); const now = Date.now();
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

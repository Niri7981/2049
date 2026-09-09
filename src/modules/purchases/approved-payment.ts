import type { SettleResponse } from '@x402/core/types';
import type { Day4Config } from '../payment/day4-config';
import { prepareDay4Payment, confirmDay4Transaction, MARKET_RESOURCE } from '../payment/day4-payment';
import { loadDay4Buyer } from '../payment/day4-wallet';
import { MarketSnapshotOutputSchema } from '../resources/resource-schema';
import { PurchaseLedger } from './purchase-ledger';
import { hash } from './spending-policy';

export function paymentEndpoint(origin: string) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Day 5 only calls the configured local API');
  return new URL(MARKET_RESOURCE, url).href;
}
export function paymentBinding(config: Day4Config, endpoint: string) {
  return hash([config.cluster, config.network, config.mint, config.buyer, config.merchant, endpoint]);
}
/** Internal approval ID is the only caller-supplied payment parameter. */
export async function executeApprovedPayment(ledger: PurchaseLedger, approvalId: string, config: Day4Config, endpoint: string) {
  const record = ledger.claim(approvalId);
  let transaction: string | undefined;
  try {
    const p = record.purchase;
    if (p.binding !== paymentBinding(config, endpoint) || p.quoteFingerprint !== hash(record.quote) || p.amount !== Number(record.quote.amount)
      || p.mint !== config.mint || p.network !== config.network || p.payTo !== config.merchant) throw new Error('Approval binding changed');
    const signer = await loadDay4Buyer(config.buyer);
    // Never sign an approval that expired while waiting for Keychain access.
    if (Date.now() >= p.expiresAt) throw new Error('Approval expired');
    const payload = await prepareDay4Payment(config, signer, record.quote);
    if (Date.now() >= p.expiresAt) throw new Error('Approval expired before submission');
    ledger.savePayload(approvalId, payload);
    const response = await fetch(endpoint, { headers: { 'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(payload)).toString('base64') }, signal: AbortSignal.timeout(55_000), redirect: 'error' });
    const header = response.headers.get('PAYMENT-RESPONSE');
    if (!header || header.length > 16_384) throw new Error('Missing settlement receipt');
    const receipt = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as SettleResponse;
    if (typeof receipt.transaction === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(receipt.transaction)) transaction = receipt.transaction;
    if (response.status !== 200 || receipt.success !== true || receipt.network !== config.network || receipt.payer !== config.buyer || !transaction) throw new Error('Settlement not confirmed');
    await confirmDay4Transaction(config, transaction);
    const data = MarketSnapshotOutputSchema.parse(await response.json());
    ledger.finish(approvalId, { transaction, data });
    return { transaction, data };
  } catch {
    // Includes crashes after claim and validation failures after settlement: fail closed.
    ledger.unknown(approvalId, transaction);
    throw new Error('Payment outcome requires reconciliation; do not create another payment');
  }
}

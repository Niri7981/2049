import type { Trace } from '../demo/trace';
import type { PaymentPayload } from '@x402/core/types';
import type { PaymentConfig } from '../payment/payment-config';
import { prepareSolanaPayment, confirmSolanaTransaction, MARKET_RESOURCE } from '../payment/solana-payment';
import { inspectOriginalTransaction, transactionMessageHash } from '../payment/reconcile-transaction';
import { loadBuyerSigner } from '../payment/wallet';
import { readMarketSnapshot } from '../resources/read-market-snapshot';
import { PurchaseLedger, type PurchaseRecord } from './purchase-ledger';
import { hash } from './spending-policy';
import { paymentSignatureHeaders, readSettlementResponse } from '../payment/x402-client';

export function paymentEndpoint(origin: string) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Purchase only calls the configured local API');
  return new URL(MARKET_RESOURCE, url).href;
}
export function paymentBinding(config: PaymentConfig, endpoint: string) {
  return hash([config.cluster, config.network, config.mint, config.buyer, config.merchant, endpoint]);
}
function checkBinding(record: PurchaseRecord, config: PaymentConfig, endpoint: string) {
  const intent = record.intent;
  if (intent.executionBinding !== paymentBinding(config, endpoint) || intent.quoteFingerprint !== hash(record.quote) || intent.amount !== Number(record.quote.amount)
    || intent.assetId !== config.mint || intent.network !== config.network || intent.payTo !== config.merchant) throw new Error('Approval binding changed');
}
async function receivePayment(ledger: PurchaseLedger, record: PurchaseRecord, config: PaymentConfig, endpoint: string, payload: PaymentPayload, recovery: boolean, trace: Trace) {
  if (hash(payload.accepted) !== record.intent.quoteFingerprint || typeof payload.payload.transaction !== 'string') throw new Error('Saved payment changed');
  if (!recovery) trace('SUBMITTED');
  const response = await fetch(endpoint, { headers: {
    ...paymentSignatureHeaders(payload),
    ...(recovery ? { 'PAYMENT-RECOVERY': '1' } : {}),
  }, signal: AbortSignal.timeout(55_000), redirect: 'error' });
  const receipt = readSettlementResponse(response);
  const transaction = receipt.transaction;
  if (receipt.network !== config.network || receipt.payer !== config.buyer || typeof transaction !== 'string'
    || !/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(transaction)
    || (receipt.amount !== undefined && receipt.amount !== String(record.intent.amount))) throw new Error('Settlement receipt mismatch');
  if (!recovery && receipt.success === true) await confirmSolanaTransaction(config, transaction);
  const proof = await inspectOriginalTransaction(config, transaction, transactionMessageHash(payload.payload.transaction));
  if (proof.status === 'FAILED') {
    ledger.failConfirmed(record.approvalId, transaction);
    throw new Error('Original transaction failed');
  }
  if (proof.status !== 'CONFIRMED') throw new Error('Settlement not confirmed');
  // Persist chain evidence before reading delivery: bad/missing data cannot undo payment.
  ledger.confirmPayment(record.approvalId, transaction);
  trace('CHAIN_CONFIRMED', transaction);
  if (response.status !== 200 || receipt.success !== true) throw new Error('Delivery unavailable');
  const data = await readMarketSnapshot(response);
  trace('DATA_VALIDATED', `历史演示快照 · ${data.as_of}`);
  ledger.finish(record.approvalId, { transaction, data });
  return { transaction, data };
}
/** Internal approval ID is the only caller-supplied payment parameter. */
export async function executeApprovedPayment(ledger: PurchaseLedger, approvalId: string, config: PaymentConfig, endpoint: string, trace: Trace = () => {}) {
  const record = ledger.claim(approvalId);
  try {
    checkBinding(record, config, endpoint);
    trace('SIGNING');
    const signer = await loadBuyerSigner(config.buyer);
    ledger.assertCanSign(approvalId);
    const payload = await prepareSolanaPayment(config, signer, record.quote, () => ledger.assertCanSign(approvalId));
    if (Date.now() >= record.intent.expiresAt) throw new Error('Approval expired before submission');
    ledger.savePayload(approvalId, payload);
    trace('SIGNED');
    return await receivePayment(ledger, record, config, endpoint, payload, false, trace);
  } catch {
    if (!ledger.savedPayload(approvalId)) ledger.failUnsubmitted(approvalId);
    else ledger.unknown(approvalId);
    throw new Error('Payment stopped; use the same task for reconciliation, never create a replacement payment');
  }
}
/** Can run concurrently with the initial request: reads only, never signs or settles. */
export async function recoverApprovedPayment(ledger: PurchaseLedger, taskId: string, config: PaymentConfig, endpoint: string, trace: Trace = () => {}) {
  const record = ledger.get(taskId);
  if (!record || (!['PAYING', 'PAYMENT_UNKNOWN'].includes(record.status) && record.deliveryStatus !== 'PENDING')) return;
  trace('RECOVERY_STARTED');
  checkBinding(record, config, endpoint);
  const payload = ledger.savedPayload(record.approvalId);
  // An in-flight signer may not have saved yet. No evidence of failure: keep frozen.
  if (!payload) return;
  try { return await receivePayment(ledger, record, config, endpoint, payload, true, trace); }
  catch { /* Inconclusive recovery is neither permission to repay nor to release budget. */ }
}

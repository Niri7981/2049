import type { Trace } from '../demo/trace';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import type { PaymentConfig } from '../payment/payment-config';
import { prepareSolanaPayment, confirmSolanaTransaction, MARKET_RESOURCE } from '../payment/solana-payment';
import { inspectOriginalTransaction, transactionMessageHash } from '../payment/reconcile-transaction';
import { loadBuyerSigner } from '../payment/wallet';
import { readMarketSnapshot } from '../resources/read-market-snapshot';
import { PurchaseLedger, type PurchaseRecord } from './purchase-ledger';
import { hash } from './spending-policy';
import { runPaymentPreflight } from '../payment/payment-preflight';
import { MarketOfferIdSchema, marketOffer } from '../resources/market-offers';
import { paymentSignatureHeaders, readSettlementResponse } from '../payment/x402-client';

export function paymentEndpoint(origin: string, offerId?: string) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Purchase only calls the configured local API');
  return new URL(offerId ? `${MARKET_RESOURCE}&offer=${MarketOfferIdSchema.parse(offerId)}` : MARKET_RESOURCE, url).href;
}
export function paymentBinding(config: PaymentConfig, endpoint: string, quote?: PaymentRequirements) {
  const facts = [config.cluster, config.network, config.mint, config.buyer, config.merchant, endpoint];
  return hash(quote ? [...facts, 'GET', quote] : facts);
}
export function checkPaymentBinding(record: PurchaseRecord, config: PaymentConfig, endpoint: string) {
  const intent = record.intent;
  if (intent.executionBinding !== paymentBinding(config, endpoint, intent.offerId ? record.quote : undefined) || intent.quoteFingerprint !== hash(record.quote) || String(intent.amount) !== record.quote.amount
    || intent.assetId !== config.mint || intent.network !== config.network || intent.payTo !== config.merchant) throw new Error('Approval binding changed');
  if (intent.paymentScheme !== record.quote.scheme || record.quote.asset !== intent.assetId || record.quote.network !== intent.network || record.quote.payTo !== intent.payTo) throw new Error('Approval terms changed');
  if (intent.offerId) {
    const offer = marketOffer(MarketOfferIdSchema.parse(intent.offerId));
    if (endpoint !== paymentEndpoint(endpoint, intent.offerId) || record.quote.amount !== offer.amount) throw new Error('Offer binding changed');
  }
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
  const messageHash = transactionMessageHash(payload.payload.transaction);
  const proof = await inspectOriginalTransaction(config, transaction, messageHash);
  if (proof.status === 'FAILED') {
    ledger.failConfirmed(record.approvalId, transaction);
    throw new Error('Original transaction failed');
  }
  if (proof.status !== 'CONFIRMED') {
    ledger.unknown(record.approvalId, transaction);
    throw new Error('Settlement not confirmed');
  }
  if (receipt.success !== true) {
    ledger.unknown(record.approvalId, transaction);
    throw new Error('Facilitator settlement is not confirmed');
  }
  // Persist payment only after the original payload, chain transaction, and
  // facilitator settlement all agree. Delivery can still fail independently.
  ledger.confirmPayment(record.approvalId, transaction, {
    payer: receipt.payer, messageHash, confirmationStatus: proof.confirmationStatus ?? 'confirmed', settlementConfirmed: true,
  });
  trace('CHAIN_CONFIRMED', transaction);
  if (response.status !== 200 || receipt.success !== true) throw new Error('Delivery unavailable');
  const data = await readMarketSnapshot(response);
  trace('DATA_VALIDATED', `历史演示快照 · ${data.as_of}`);
  ledger.finish(record.approvalId, { transaction, data });
  return { transaction, data };
}
/** Internal approval ID is the only caller-supplied payment parameter. */
export async function executeApprovedPayment(ledger: PurchaseLedger, approvalId: string, config: PaymentConfig, endpoint: string, trace: Trace = () => {}) {
  const validate = (record: PurchaseRecord) => checkPaymentBinding(record, config, endpoint);
  const record = ledger.claim(approvalId, undefined, validate, 'live_devnet');
  const beforeSign = () => ledger.assertCanSign(approvalId, undefined, validate);
  try {
    checkPaymentBinding(record, config, endpoint);
    if (record.intent.offerId) {
      const preflight = await runPaymentPreflight(config, { amount: record.quote.amount });
      if (preflight.facilitator.feePayer !== record.quote.extra?.feePayer) throw new Error('Quote fee payer changed');
    }
    beforeSign();
    trace('SIGNING');
    const signer = await loadBuyerSigner(config.buyer);
    beforeSign();
    const payload = await prepareSolanaPayment(config, signer, record.quote, beforeSign, record.intent.offerId ? { amount: record.quote.amount, resource: new URL(endpoint).pathname + new URL(endpoint).search } : undefined);
    ledger.savePayload(approvalId, payload, validate);
    beforeSign();
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
  if (record?.executionMode === 'simulated') return;
  if (!record || (!['PAYING', 'PAYMENT_UNKNOWN'].includes(record.status) && record.deliveryStatus !== 'PENDING')) return;
  trace('RECOVERY_STARTED');
  checkPaymentBinding(record, config, endpoint);
  const payload = ledger.savedPayload(record.approvalId);
  // An in-flight signer may not have saved yet. No evidence of failure: keep frozen.
  if (!payload) return;
  try { return await receivePayment(ledger, record, config, endpoint, payload, true, trace); }
  catch { /* Inconclusive recovery is neither permission to repay nor to release budget. */ }
}

import { randomUUID } from 'node:crypto';
import type { PaymentRequirements } from '@x402/core/types';
import type { Trace } from '../demo/trace';
import { demoSnapshot } from '../paid-market-api/paid-market-api';
import { DEVNET_NETWORK, DEVNET_USDC_MINT, PAYMENT_AMOUNT, type PaymentConfig } from '../payment/payment-config';
import { runPaymentPreflight } from '../payment/payment-preflight';
import { selectPaymentQuote } from '../payment/solana-payment';
import { createStaticResourceRegistry } from '../resources/static-resource-registry';
import { executeApprovedPayment, paymentBinding, paymentEndpoint, recoverApprovedPayment } from './approved-payment';
import { PurchaseLedger, type PurchaseRecord } from './purchase-ledger';
import { hash, PurchaseSchema } from './spending-policy';

export type MarketSnapshotPurchaseMode = 'live_devnet' | 'simulated';
export type MarketSnapshotPurchaseOptions = {
  config: PaymentConfig;
  ledger: PurchaseLedger;
  origin: string;
  mode: MarketSnapshotPurchaseMode;
  preflight?: typeof runPaymentPreflight;
  pay?: typeof executeApprovedPayment;
  trace?: Trace;
  now?: () => number;
  legacyBindings?: string[];
};

export type MarketSnapshotPurchaseResult = {
  record: PurchaseRecord;
  reused: boolean;
  simulated: boolean;
};

/** Shared App/MCP-facing purchase entry. It owns no model planning or UI behavior. */
export async function purchaseMarketSnapshot(
  input: { purchaseId: string; intent: string },
  options: MarketSnapshotPurchaseOptions,
): Promise<MarketSnapshotPurchaseResult> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.purchaseId) || !input.intent.trim()) throw new Error('Invalid purchase request');
  const { config, ledger } = options;
  if (config.cluster !== 'devnet' || config.network !== DEVNET_NETWORK || config.mint !== DEVNET_USDC_MINT) {
    throw new Error('Purchase service only supports Circle USDC on Devnet');
  }
  const trace = options.trace ?? (() => {});
  const endpoint = paymentEndpoint(options.origin);
  const binding = paymentBinding(config, endpoint);
  ledger.releaseExpired();
  const existing = ledger.get(input.purchaseId);
  if (existing) {
    const acceptedBindings = [binding, ...(options.legacyBindings ?? [])];
    if (existing.purchase.taskHash !== hash(input.intent) || !acceptedBindings.includes(existing.purchase.binding)) {
      throw new Error('Purchase ID already belongs to different input or configuration');
    }
    if (options.mode === 'live_devnet') await recoverApprovedPayment(ledger, input.purchaseId, config, endpoint, trace);
    return { record: ledger.get(input.purchaseId)!, reused: true, simulated: options.mode === 'simulated' };
  }

  const resources = createStaticResourceRegistry({
    endpoint: 'https://purchase.local.invalid/api/paid/market-snapshot',
    asset_id: config.mint,
    network: config.network,
    allowed_pay_to: config.merchant,
  });
  let quote: PaymentRequirements;
  if (options.mode === 'live_devnet') {
    trace('PREFLIGHT');
    const preflight = await (options.preflight ?? runPaymentPreflight)(config);
    trace('QUOTE_REQUESTED');
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
    const header = response.headers.get('PAYMENT-REQUIRED');
    if (response.status !== 402 || !header) throw new Error('Expected a valid x402 quote');
    quote = selectPaymentQuote(header, config, preflight.facilitator.feePayer);
  } else {
    quote = {
      scheme: 'exact', network: config.network, asset: config.mint, amount: PAYMENT_AMOUNT,
      payTo: config.merchant, maxTimeoutSeconds: 300,
      extra: { feePayer: config.buyer, memo: `app-test:${input.purchaseId}` },
    };
  }
  trace('QUOTE_RECEIVED', '0.01 测试 USDC · Solana Devnet');
  const now = options.now?.() ?? Date.now();
  const purchase = PurchaseSchema.parse({
    id: randomUUID(), taskId: input.purchaseId, taskHash: hash(input.intent), resourceId: resources[0].resource_id,
    providerId: resources[0].provider_id, input: { asset: 'SOL' }, amount: Number(quote.amount), currency: 'USDC', decimals: 6,
    mint: quote.asset, network: quote.network, payTo: quote.payTo, scheme: quote.scheme, quoteFingerprint: hash(quote),
    createdAt: now, expiresAt: now + Math.min(quote.maxTimeoutSeconds, 300) * 1000, binding,
  });
  const reserved = ledger.reserve(purchase, quote, resources[0], now);
  trace(reserved.status === 'APPROVED' ? 'POLICY_APPROVED' : 'POLICY_STOPPED', reserved.decision.reason);
  if (reserved.purchase.id !== purchase.id || reserved.status !== 'APPROVED') {
    return { record: reserved, reused: reserved.purchase.id !== purchase.id, simulated: options.mode === 'simulated' };
  }

  if (options.mode === 'simulated') {
    ledger.claim(reserved.approvalId, now);
    ledger.finish(reserved.approvalId, { transaction: `simulated-${input.purchaseId}`, data: demoSnapshot }, now);
  } else {
    try { await (options.pay ?? executeApprovedPayment)(ledger, reserved.approvalId, config, endpoint, trace); }
    catch {
      trace('PAYMENT_PAUSED');
      await recoverApprovedPayment(ledger, input.purchaseId, config, endpoint, trace);
    }
  }
  return { record: ledger.get(input.purchaseId)!, reused: false, simulated: options.mode === 'simulated' };
}

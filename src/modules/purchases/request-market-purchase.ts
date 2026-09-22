import type { PaymentRequirements } from '@x402/core/types';
import { z } from 'zod';
import { SpendPrincipalSchema, type SpendAuthorityBinding, type SpendPrincipal } from '../authority/spend-grant';
import { DEVNET_NETWORK, DEVNET_USDC_MINT, type PaymentConfig } from '../payment/payment-config';
import { readPaymentRequiredHeader } from '../payment/x402-client';
import { MarketOfferIdSchema, marketOffer, marketOfferResource } from '../resources/market-offers';
import { createMarketSnapshotSpendIntent } from '../resources/market-spend-adapter';
import { PurchaseLedger, type SpendReservation } from './purchase-ledger';
import { hash } from './spending-policy';

export const PurchaseRequestInputSchema = z.object({
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  offerId: MarketOfferIdSchema,
  reason: z.string().trim().min(1).max(240),
}).strict();
export type PurchaseRequestInput = z.infer<typeof PurchaseRequestInputSchema>;

export type PurchaseRequestResult = {
  purchaseId: string;
  offerId: PurchaseRequestInput['offerId'];
  amount: string;
  display: string;
  status: string;
  decision: SpendReservation['decision'];
  quote: { resourceId: string; providerId: string; network: string; assetId: string; assetDecimals: number; payTo: string; amount: string; expiresAt: number; fingerprint: string };
  grant: { id: string; version: number };
  paymentStatus: 'NOT_STARTED';
  reused: boolean;
};

function result(record: SpendReservation, offerId: PurchaseRequestInput['offerId'], reused: boolean): PurchaseRequestResult {
  const offer = marketOffer(offerId);
  const authority = record.intent.authority;
  if (!authority) throw new Error('SPEND_GRANT_REQUIRED');
  return { purchaseId: record.intent.idempotencyKey, offerId, amount: String(record.intent.amount), display: offer.display,
    status: record.status, decision: record.decision,
    quote: { resourceId: record.intent.resourceId, providerId: record.intent.providerId, network: record.intent.network, assetId: record.intent.assetId,
      assetDecimals: record.intent.assetDecimals, payTo: record.intent.payTo, amount: String(record.intent.amount), expiresAt: record.intent.expiresAt, fingerprint: record.intent.quoteFingerprint },
    grant: { id: authority.grantId, version: authority.grantVersion }, paymentStatus: 'NOT_STARTED', reused };
}

/** Obtains and validates a real 402 quote, then stops after policy reservation. */
export async function requestMarketPurchase(raw: unknown, options: {
  config: PaymentConfig;
  ledger: PurchaseLedger;
  origin: string;
  principal: SpendPrincipal;
  fetcher?: typeof fetch;
  now?: () => number;
}): Promise<PurchaseRequestResult> {
  const input = PurchaseRequestInputSchema.parse(raw);
  const principal = SpendPrincipalSchema.parse(options.principal);
  const clock = options.now ?? Date.now;
  const requestStartedAt = clock();
  const requestHash = hash({ offerId: input.offerId, reason: input.reason });
  options.ledger.releaseExpired(requestStartedAt);
  const existing = options.ledger.get(input.requestId);
  if (existing) {
    if (existing.intent.requestHash !== requestHash || existing.intent.offerId !== input.offerId) throw new Error('REQUEST_ID_CONFLICT');
    const binding = existing.intent.authority;
    if (!binding || binding.connectionId !== principal.connectionId || binding.connectionGeneration !== principal.connectionGeneration) throw new Error('PURCHASE_REQUEST_OWNER_MISMATCH');
    return result(existing, input.offerId, true);
  }

  const { config } = options;
  if (config.cluster !== 'devnet' || config.network !== DEVNET_NETWORK || config.mint !== DEVNET_USDC_MINT) throw new Error('UNSUPPORTED_PURCHASE_NETWORK');
  const offer = marketOffer(input.offerId);
  const resourcePath = `/api/paid/market-snapshot?asset=SOL&offer=${input.offerId}`;
  const endpoint = new URL(resourcePath, options.origin);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') throw new Error('INVALID_PURCHASE_ORIGIN');
  const response = await (options.fetcher ?? fetch)(endpoint, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  let quote: PaymentRequirements;
  try {
    if (response.status !== 402) throw new Error('INVALID_X402_QUOTE');
    const required = readPaymentRequiredHeader(response.headers.get('PAYMENT-REQUIRED') ?? '');
    if (required.resource?.url !== resourcePath || required.accepts.length !== 1) throw new Error('INVALID_X402_QUOTE');
    quote = required.accepts[0];
    if (quote.scheme !== 'exact' || quote.network !== config.network || quote.asset !== config.mint || quote.payTo !== config.merchant ||
      quote.amount !== offer.amount || quote.maxTimeoutSeconds <= 0 || quote.maxTimeoutSeconds > 300) throw new Error('INVALID_X402_QUOTE');
  } finally { await response.body?.cancel(); }

  const now = clock();
  let authority: SpendAuthorityBinding;
  try { authority = options.ledger.spendAuthority(principal, 'market.snapshot.read', now); }
  catch { throw new Error('SPEND_GRANT_INACTIVE'); }
  const resource = marketOfferResource({ endpoint: 'https://purchase.local.invalid/api/paid/market-snapshot', asset_id: config.mint,
    network: config.network, allowed_pay_to: config.merchant }, input.offerId);
  const intent = createMarketSnapshotSpendIntent({ idempotencyKey: input.requestId, request: { asset: 'SOL' }, requestHash, resource, quote,
    executionBinding: hash(['purchase-request-v1', resourcePath, config.network, config.mint, config.merchant]), authority, offerId: input.offerId, reason: input.reason, now: requestStartedAt });
  const reserved = options.ledger.reserve(intent, quote, now);
  const reservedBinding = reserved.intent.authority;
  if (!reservedBinding || reservedBinding.connectionId !== principal.connectionId || reservedBinding.connectionGeneration !== principal.connectionGeneration) {
    throw new Error('PURCHASE_REQUEST_OWNER_MISMATCH');
  }
  return result(reserved, input.offerId, reserved.intent.id !== intent.id);
}

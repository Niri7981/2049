import { randomUUID } from 'node:crypto';
import type { PaymentRequirements } from '@x402/core/types';
import { SpendIntentSchema, type SpendIntent } from '../authority/spend-intent';
import { hash } from '../authority/authority-policy';
import type { SpendAuthorityBinding } from '../authority/spend-grant';
import { MarketSnapshotInputSchema, type ResourceMetadata } from './resource-schema';
import { DEMO_MARKET_DATA_PROVIDER_ID, PREMIUM_SOL_MARKET_SNAPSHOT_ID } from './static-resource-registry';

export function createMarketSnapshotSpendIntent(input: {
  idempotencyKey: string;
  request: unknown;
  requestHash: string;
  resource: ResourceMetadata;
  quote: PaymentRequirements;
  executionBinding: string;
  now?: number;
  authority?: SpendAuthorityBinding;
  offerId?: string;
  reason?: string;
}): SpendIntent {
  const now = input.now ?? Date.now();
  const resource = input.resource;
  const quote = input.quote;
  MarketSnapshotInputSchema.parse(input.request);
  if (!resource.enabled || resource.resource_id !== PREMIUM_SOL_MARKET_SNAPSHOT_ID) throw new Error('RESOURCE_NOT_ALLOWED');
  if (resource.provider_id !== DEMO_MARKET_DATA_PROVIDER_ID) throw new Error('PROVIDER_NOT_ALLOWED');
  if (resource.payment_scheme !== 'exact' || quote.scheme !== resource.payment_scheme) throw new Error('SCHEME_NOT_ALLOWED');
  if (quote.asset !== resource.asset_id || quote.network !== resource.network || quote.payTo !== resource.allowed_pay_to) throw new Error('PAYMENT_TERMS_CHANGED');
  if (quote.amount !== String(resource.expected_price_minor)) throw new Error('PRICE_CHANGED');
  if (!Number.isFinite(quote.maxTimeoutSeconds) || quote.maxTimeoutSeconds <= 0) throw new Error('QUOTE_EXPIRED_OR_INVALID');

  return SpendIntentSchema.parse({
    id: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    resourceId: resource.resource_id,
    providerId: resource.provider_id,
    ...(input.offerId ? { offerId: input.offerId } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    amount: resource.expected_price_minor,
    currency: resource.currency,
    assetDecimals: resource.asset_decimals,
    assetId: resource.asset_id,
    network: resource.network,
    payTo: resource.allowed_pay_to,
    paymentScheme: resource.payment_scheme,
    quoteFingerprint: hash(quote),
    createdAt: now,
    expiresAt: now + Math.min(quote.maxTimeoutSeconds, 300) * 1000,
    executionBinding: input.executionBinding,
    ...(input.authority ? { authority: input.authority } : {}),
  });
}

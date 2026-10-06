import { z } from 'zod';
import type { SpendIntent } from '../authority/spend-intent';
import { DeliveryRecoveryCapabilitySchema, TEST_CACHED_DELIVERY, type DeliveryRecoveryCapability } from '../resources/delivery-capability';
import { PAID_RESOURCES } from '../resources/paid-resources';
import { DEMO_MARKET_DATA_PROVIDER_ID, SOL_MARKET_SNAPSHOT_RESOURCE_ID } from '../resources/static-resource-registry';
import { DEVNET_NETWORK, DEVNET_USDC_MINT } from '../payment/payment-environment';

export const DELIVERY_RETRY_LIMIT = 4;
export const DeliveryStatusSchema = z.enum(['NOT_PAID', 'PENDING', 'DELIVERING', 'COMPLETE', 'EXHAUSTED', 'UNSUPPORTED']);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;
export const ReceiptStatusSchema = z.enum(['UNAVAILABLE', 'UNVERIFIED', 'CONFIRMED', 'FAILED', 'INVALID']);
export type ReceiptStatus = z.infer<typeof ReceiptStatusSchema>;
export const DeliveryRecoveryStateSchema = z.object({
  status: DeliveryStatusSchema, receiptStatus: ReceiptStatusSchema,
  retryCount: z.number().int().min(0).max(DELIVERY_RETRY_LIMIT), retryLimit: z.literal(DELIVERY_RETRY_LIMIT),
  nextAttemptAt: z.number().int().nonnegative(), lastError: z.string().nullable(),
});
export type DeliveryRecoveryState = z.infer<typeof DeliveryRecoveryStateSchema>;

/** Only the registered historical test resources retain their documented cached
 * replay contract. Unknown/external rows never acquire a recovery capability. */
export function persistedDeliveryCapability(intent: SpendIntent): DeliveryRecoveryCapability {
  if (intent.deliveryRecovery) return DeliveryRecoveryCapabilitySchema.parse(intent.deliveryRecovery);
  if ((!intent.httpRequest || intent.httpRequest.access === 'test_loopback')
    && intent.network === DEVNET_NETWORK && intent.assetId === DEVNET_USDC_MINT
    && intent.providerId === DEMO_MARKET_DATA_PROVIDER_ID
    && (intent.resourceId === SOL_MARKET_SNAPSHOT_RESOURCE_ID || Object.hasOwn(PAID_RESOURCES, intent.resourceId))) return TEST_CACHED_DELIVERY;
  return { kind: 'none' };
}

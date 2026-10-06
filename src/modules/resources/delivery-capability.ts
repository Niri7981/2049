import { DeliveryRecoveryCapabilitySchema, type DeliveryRecoveryCapability } from './http-resource';
export { DeliveryRecoveryCapabilitySchema, type DeliveryRecoveryCapability } from './http-resource';

export const TEST_CACHED_DELIVERY: DeliveryRecoveryCapability = Object.freeze({ kind: 'cached_replay',
  replayHeader: Object.freeze({ name: 'PAYMENT-RECOVERY', value: '1' }) });

export function validateDeliveryCapability(capability: DeliveryRecoveryCapability, original: { url: string; access: string }) {
  const parsed = DeliveryRecoveryCapabilitySchema.parse(capability);
  if (parsed.kind === 'payment_identifier' && (new URL(parsed.request.url).origin !== new URL(original.url).origin
    || parsed.request.access !== original.access || (parsed.location === 'query' && new URL(parsed.request.url).searchParams.has(parsed.name)))) throw new Error('DELIVERY_RECOVERY_RESOURCE_MISMATCH');
  return parsed;
}

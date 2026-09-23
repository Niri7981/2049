import { z } from 'zod';
import { SpendAuthorityBindingSchema } from './spend-grant';

const boundedIdentifier = z.string().min(1).max(200);

/**
 * A server-created request to spend. It contains the immutable facts that the
 * authority core needs, but it is not permission to execute a payment.
 */
export const SpendIntentSchema = z.object({
  id: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(80),
  requestHash: z.string().min(1),
  resourceId: boundedIdentifier,
  providerId: boundedIdentifier,
  offerId: boundedIdentifier.optional(),
  reason: z.string().trim().min(1).max(240).optional(),
  amount: z.number().int().positive().safe(),
  currency: boundedIdentifier,
  assetDecimals: z.number().int().nonnegative().max(255),
  assetId: boundedIdentifier,
  network: boundedIdentifier,
  payTo: boundedIdentifier,
  paymentScheme: boundedIdentifier,
  quoteFingerprint: z.string().min(1),
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  executionBinding: z.string().min(1),
  authority: SpendAuthorityBindingSchema.optional(),
}).strict();

export type SpendIntent = z.infer<typeof SpendIntentSchema>;

const LegacyPurchaseSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().min(1).max(80),
  taskHash: z.string().min(1),
  resourceId: boundedIdentifier,
  providerId: boundedIdentifier,
  input: z.unknown(),
  amount: z.number().int().positive().safe(),
  currency: boundedIdentifier,
  decimals: z.number().int().nonnegative().max(255),
  mint: boundedIdentifier,
  network: boundedIdentifier,
  payTo: boundedIdentifier,
  scheme: boundedIdentifier,
  quoteFingerprint: z.string().min(1),
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  binding: z.string().min(1),
}).passthrough();

/** Reads records written before SpendIntent without rewriting in-flight payments. */
export function parseStoredSpendIntent(raw: unknown, ownerCardMemberId?: string): SpendIntent {
  const current = SpendIntentSchema.safeParse(raw);
  if (current.success) return current.data;
  if (ownerCardMemberId && raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const authority = 'authority' in raw ? raw.authority : undefined;
    if (authority && typeof authority === 'object' && !Array.isArray(authority) && !('cardMemberId' in authority)) {
      const migrated = SpendIntentSchema.safeParse({ ...raw, authority: { ...authority, cardMemberId: ownerCardMemberId } });
      if (migrated.success) return migrated.data;
    }
  }
  const legacy = LegacyPurchaseSchema.parse(raw);
  return SpendIntentSchema.parse({
    id: legacy.id,
    idempotencyKey: legacy.taskId,
    requestHash: legacy.taskHash,
    resourceId: legacy.resourceId,
    providerId: legacy.providerId,
    amount: legacy.amount,
    currency: legacy.currency,
    assetDecimals: legacy.decimals,
    assetId: legacy.mint,
    network: legacy.network,
    payTo: legacy.payTo,
    paymentScheme: legacy.scheme,
    quoteFingerprint: legacy.quoteFingerprint,
    createdAt: legacy.createdAt,
    expiresAt: legacy.expiresAt,
    executionBinding: legacy.binding,
  });
}

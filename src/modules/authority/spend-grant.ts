import { z } from 'zod';

const identifier = z.string().min(1).max(200);
const minorUnits = z.string().regex(/^(?:0|[1-9]\d*)$/).refine(value => Number.isSafeInteger(Number(value)));
export const MARKET_SNAPSHOT_OPERATION = 'market.snapshot.read';

export const SpendPrincipalSchema = z.object({
  cardMemberId: z.string().uuid(),
  connectionId: z.string().uuid(),
  connectionGeneration: z.number().int().positive().safe(),
}).strict();

export const SpendAuthorityBindingSchema = SpendPrincipalSchema.extend({
  grantId: z.string().uuid(),
  grantVersion: z.number().int().positive().safe(),
  operation: identifier,
}).strict();

export const SpendGrantInputSchema = z.object({
  totalLimit: minorUnits,
  singleLimit: minorUnits,
  expiresAt: z.number().int().positive().safe(),
}).strict();

export const SpendGrantScopeSchema = z.object({
  resourceId: identifier,
  providerId: identifier,
  operation: identifier,
  network: identifier,
  assetId: identifier,
  assetDecimals: z.number().int().nonnegative().max(255),
  payTo: identifier,
  paymentScheme: identifier,
}).strict();

export const SpendGrantSchema = SpendPrincipalSchema.extend({
  id: z.string().uuid(),
  version: z.number().int().positive().safe(),
  resourceId: identifier,
  providerId: identifier,
  operation: identifier,
  network: identifier,
  assetId: identifier,
  assetDecimals: z.number().int().nonnegative().max(255),
  payTo: identifier,
  paymentScheme: identifier,
  totalLimit: z.number().int().positive().safe(),
  singleLimit: z.number().int().positive().safe(),
  status: z.enum(['ACTIVE', 'REVOKED', 'EXPIRED']),
  createdAt: z.number().int().nonnegative().safe(),
  expiresAt: z.number().int().positive().safe(),
  revokedAt: z.number().int().nonnegative().safe().nullable(),
}).strict();

export type SpendPrincipal = z.infer<typeof SpendPrincipalSchema>;
export type SpendAuthorityBinding = z.infer<typeof SpendAuthorityBindingSchema>;
export type SpendGrantInput = z.infer<typeof SpendGrantInputSchema>;
export type SpendGrantScope = z.infer<typeof SpendGrantScopeSchema>;
export type SpendGrant = z.infer<typeof SpendGrantSchema>;

export function parseGrantAmount(value: string, name: string) {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${name} must be an integer string`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive safe integer`);
  return parsed;
}

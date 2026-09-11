import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PaymentRequirements } from '@x402/core/types';
import { DEVNET_NETWORK, DEVNET_USDC_MINT } from '../payment/payment-config';
import type { ResourceMetadata } from '../resources/resource-schema';

export const PurchaseSchema = z.object({
  id: z.string().uuid(), taskId: z.string().min(1).max(80), taskHash: z.string(),
  resourceId: z.string(), providerId: z.string(), input: z.object({ asset: z.literal('SOL') }).strict(),
  amount: z.number().int().positive().safe(), currency: z.literal('USDC'), decimals: z.literal(6),
  mint: z.string(), network: z.string(), payTo: z.string(), scheme: z.string(),
  quoteFingerprint: z.string(), expiresAt: z.number().int(), createdAt: z.number().int(),
  binding: z.string(),
}).strict();
export type Purchase = z.infer<typeof PurchaseSchema>;
export type PolicyDecision = { decision: 'APPROVED' | 'REJECTED' | 'NEEDS_CONFIRMATION'; reason: string; committedBefore: number; remainingAfter: number };
export const POLICY = Object.freeze({ singleLimit: 100_000, dailyBudget: 1_000_000 });
export function hash(value: unknown): string {
  function normalize(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(normalize);
    if (input !== null && typeof input === 'object') return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
    return input;
  }
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}
export function spendingDay(now: number): string {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function evaluatePurchase(raw: unknown, resource: ResourceMetadata, quote: PaymentRequirements,
  ledger: { committed: number; hasUnknown: boolean }, now = Date.now()): PolicyDecision {
  const reject = (reason: string): PolicyDecision => ({ decision: 'REJECTED', reason, committedBefore: ledger.committed, remainingAfter: Math.max(0, POLICY.dailyBudget - ledger.committed) });
  const parsed = PurchaseSchema.safeParse(raw);
  if (!parsed.success) return reject('INVALID_PURCHASE');
  const p = parsed.data;
  if (!resource.enabled || resource.resource_id !== 'premium-sol-market-snapshot' || p.resourceId !== resource.resource_id) return reject('RESOURCE_NOT_ALLOWED');
  if (resource.provider_id !== 'demo-market-data-provider' || p.providerId !== resource.provider_id) return reject('PROVIDER_NOT_ALLOWED');
  if (p.scheme !== 'exact' || quote.scheme !== 'exact' || resource.payment_scheme !== 'exact') return reject('SCHEME_NOT_ALLOWED');
  if (p.mint !== DEVNET_USDC_MINT || resource.asset_id !== p.mint || quote.asset !== p.mint || resource.currency !== p.currency || resource.asset_decimals !== p.decimals) return reject('TOKEN_NOT_ALLOWED');
  if (p.network !== DEVNET_NETWORK || resource.network !== p.network || quote.network !== p.network) return reject('NETWORK_NOT_ALLOWED');
  if (p.payTo !== resource.allowed_pay_to || quote.payTo !== p.payTo) return reject('PAYEE_NOT_ALLOWED');
  if (p.quoteFingerprint !== hash(quote)) return reject('QUOTE_CHANGED');
  if (!Number.isFinite(quote.maxTimeoutSeconds) || quote.maxTimeoutSeconds <= 0 || p.createdAt > now || p.expiresAt <= now || p.expiresAt > p.createdAt + Math.min(quote.maxTimeoutSeconds, 300) * 1000) return reject('QUOTE_EXPIRED_OR_INVALID');
  if (p.amount !== resource.expected_price_minor || quote.amount !== String(p.amount)) return reject('PRICE_CHANGED');
  if (!Number.isSafeInteger(ledger.committed) || ledger.committed < 0 || ledger.hasUnknown) return reject('LEDGER_UNRESOLVED');
  if (ledger.committed + p.amount > POLICY.dailyBudget) return reject('DAILY_BUDGET_EXCEEDED');
  const decision = p.amount > POLICY.singleLimit ? 'NEEDS_CONFIRMATION' : 'APPROVED';
  return { decision, reason: decision === 'APPROVED' ? 'ALLOWLIST_AND_BUDGET_PASSED' : 'SINGLE_LIMIT_EXCEEDED', committedBefore: ledger.committed, remainingAfter: POLICY.dailyBudget - ledger.committed - p.amount };
}

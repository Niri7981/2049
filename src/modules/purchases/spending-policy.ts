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
export type SpendingControls = { dailyBudget: number | null; paused: boolean; singleLimit: number };
export function hash(value: unknown): string {
  function normalize(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(normalize);
    if (input !== null && typeof input === 'object') return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
    return input;
  }
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}
export function spendingDay(now: number, timeZone = 'Asia/Shanghai'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
  const day = `${value('year')}-${value('month')}-${value('day')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Could not determine the local spending day');
  return day;
}
export function nextSpendingDayBoundary(now: number, timeZone: string): number {
  const current = spendingDay(now, timeZone);
  let high = now + 60 * 60 * 1000;
  while (spendingDay(high, timeZone) === current && high - now <= 36 * 60 * 60 * 1000) high += 60 * 60 * 1000;
  if (spendingDay(high, timeZone) === current) throw new Error('Could not determine the next local spending day');
  let low = now;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (spendingDay(middle, timeZone) === current) low = middle;
    else high = middle;
  }
  return high;
}
export function evaluatePurchase(raw: unknown, resource: ResourceMetadata, quote: PaymentRequirements,
  ledger: { committed: number; hasUnknown: boolean }, now = Date.now(), controls: SpendingControls = { dailyBudget: POLICY.dailyBudget, paused: false, singleLimit: POLICY.singleLimit }): PolicyDecision {
  const remaining = () => controls.dailyBudget === null ? 0 : Math.max(0, controls.dailyBudget - ledger.committed);
  const reject = (reason: string): PolicyDecision => ({ decision: 'REJECTED', reason, committedBefore: ledger.committed, remainingAfter: remaining() });
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
  if (controls.paused) return reject('PAYMENTS_PAUSED');
  if (controls.dailyBudget === null) return reject('DAILY_LIMIT_NOT_SET');
  if (!Number.isSafeInteger(controls.dailyBudget) || controls.dailyBudget < 0) return reject('INVALID_DAILY_LIMIT');
  if (ledger.committed + p.amount > controls.dailyBudget) return reject(controls.dailyBudget === 0 ? 'DAILY_LIMIT_ZERO' : 'DAILY_BUDGET_EXCEEDED');
  const decision = p.amount > controls.singleLimit ? 'NEEDS_CONFIRMATION' : 'APPROVED';
  return { decision, reason: decision === 'APPROVED' ? 'ALLOWLIST_AND_BUDGET_PASSED' : 'SINGLE_LIMIT_EXCEEDED', committedBefore: ledger.committed, remainingAfter: controls.dailyBudget - ledger.committed - p.amount };
}

import { z } from 'zod';

// SQLite INTEGER is signed 64-bit. Individual values and aggregates share this
// bound; never let SQLite SUM or a JS conversion silently overflow it.
export const MAX_ATOMIC_AMOUNT = 9_223_372_036_854_775_807n;
export function atomicAmount(value: unknown): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_ATOMIC_AMOUNT');
    value = String(value); // Compatibility for exactly representable historical JSON only.
  }
  if (typeof value !== 'bigint' && (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || value.length > 19)) {
    throw new Error('INVALID_ATOMIC_AMOUNT');
  }
  const amount = BigInt(value);
  if (amount < 0n || amount > MAX_ATOMIC_AMOUNT) throw new Error('INVALID_ATOMIC_AMOUNT');
  return amount;
}
export const AtomicAmountSchema = z.union([z.string(), z.number().safe().int().nonnegative(), z.bigint()])
  .transform((value, ctx) => {
    try { return atomicAmount(value).toString(); }
    catch { ctx.addIssue({ code: 'custom', message: 'INVALID_ATOMIC_AMOUNT' }); return z.NEVER; }
  });
export const PositiveAtomicAmountSchema = AtomicAmountSchema.refine(value => value !== '0');
export function addAtomic(left: bigint, right: bigint) {
  const total = left + right;
  if (total < 0n || total > MAX_ATOMIC_AMOUNT) throw new Error('MONETARY_AGGREGATE_OVERFLOW');
  return total;
}
export function remainingAtomic(limit: string | bigint, committed: bigint) {
  const remaining = atomicAmount(limit) - committed;
  return remaining > 0n ? remaining : 0n;
}

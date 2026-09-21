import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SpendIntentSchema } from './spend-intent';

export const AuthorityDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'DENIED', 'REQUIRES_APPROVAL']),
  reason: z.string().min(1),
  committedBefore: z.number().int().nonnegative().safe(),
  remainingAfter: z.number().int().nonnegative().safe(),
}).strict();

export type AuthorityDecision = z.infer<typeof AuthorityDecisionSchema>;

export function parseStoredAuthorityDecision(raw: unknown): AuthorityDecision {
  if (raw !== null && typeof raw === 'object' && 'decision' in raw) {
    const decision = (raw as { decision?: unknown }).decision;
    if (decision === 'REJECTED') return AuthorityDecisionSchema.parse({ ...raw, decision: 'DENIED' });
    if (decision === 'NEEDS_CONFIRMATION') return AuthorityDecisionSchema.parse({ ...raw, decision: 'REQUIRES_APPROVAL' });
  }
  return AuthorityDecisionSchema.parse(raw);
}

export const DEFAULT_SPENDING_POLICY = Object.freeze({ singleLimit: 100_000, dailyBudget: 1_000_000 });

export type SpendingControls = {
  dailyBudget: number | null;
  paused: boolean;
  singleLimit: number;
};

export type AuthorityLedgerState = { committed: number; hasUnknownPayment: boolean };

export function hash(value: unknown): string {
  function normalize(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(normalize);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
    }
    return input;
  }
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

export function evaluateSpendAuthority(
  raw: unknown,
  ledger: AuthorityLedgerState,
  now = Date.now(),
  controls: SpendingControls = {
    dailyBudget: DEFAULT_SPENDING_POLICY.dailyBudget,
    paused: false,
    singleLimit: DEFAULT_SPENDING_POLICY.singleLimit,
  },
): AuthorityDecision {
  const remaining = () => controls.dailyBudget === null ? 0 : Math.max(0, controls.dailyBudget - ledger.committed);
  const deny = (reason: string): AuthorityDecision => ({
    decision: 'DENIED', reason, committedBefore: ledger.committed, remainingAfter: remaining(),
  });
  const parsed = SpendIntentSchema.safeParse(raw);
  if (!parsed.success) return deny('INVALID_SPEND_INTENT');
  const intent = parsed.data;
  if (intent.createdAt > now || intent.expiresAt <= now || intent.expiresAt <= intent.createdAt) return deny('SPEND_INTENT_EXPIRED_OR_INVALID');
  if (!Number.isSafeInteger(ledger.committed) || ledger.committed < 0 || ledger.hasUnknownPayment) return deny('LEDGER_UNRESOLVED');
  if (controls.paused) return deny('PAYMENTS_PAUSED');
  if (controls.dailyBudget === null) return deny('DAILY_LIMIT_NOT_SET');
  if (!Number.isSafeInteger(controls.dailyBudget) || controls.dailyBudget < 0) return deny('INVALID_DAILY_LIMIT');
  if (!Number.isSafeInteger(controls.singleLimit) || controls.singleLimit < 0) return deny('INVALID_SINGLE_LIMIT');
  if (ledger.committed + intent.amount > controls.dailyBudget) return deny(controls.dailyBudget === 0 ? 'DAILY_LIMIT_ZERO' : 'DAILY_BUDGET_EXCEEDED');
  const decision = intent.amount > controls.singleLimit ? 'REQUIRES_APPROVAL' : 'APPROVED';
  return {
    decision,
    reason: decision === 'APPROVED' ? 'AUTHORITY_AND_BUDGET_PASSED' : 'SINGLE_LIMIT_EXCEEDED',
    committedBefore: ledger.committed,
    remainingAfter: controls.dailyBudget - ledger.committed - intent.amount,
  };
}

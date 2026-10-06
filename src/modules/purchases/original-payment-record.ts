import { z } from 'zod';
import { MonetaryScopeSchema, monetaryScopeId } from './monetary-scope';
import { SignedPaymentIdentitySchema } from '../payment/original-payment-evidence';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
/** Immutable backend evidence; never returned through generic App/Agent queries. */
export const OriginalPaymentRecordSchema = z.object({
  version: z.literal(1), purchaseId: z.string().uuid(), requestId: z.string().min(1).max(80),
  monetaryScope: MonetaryScopeSchema, scopeId: digest,
  executionBinding: z.string().min(1), quoteFingerprint: digest, payloadHash: digest,
  recordedAt: z.number().int().nonnegative().safe(), identity: SignedPaymentIdentitySchema,
}).strict().superRefine((record, ctx) => {
  if (monetaryScopeId(record.monetaryScope) !== record.scopeId || record.monetaryScope.network !== record.identity.network
    || record.monetaryScope.assetId !== record.identity.mint || record.monetaryScope.assetDecimals !== record.identity.decimals) {
    ctx.addIssue({ code: 'custom', message: 'ORIGINAL_PAYMENT_SCOPE_MISMATCH' });
  }
});
export type OriginalPaymentRecord = z.infer<typeof OriginalPaymentRecordSchema>;
export const OriginalPaymentStateSchema = z.enum(['SIGNED_NOT_SUBMITTED', 'SUBMISSION_ATTEMPTED', 'OUTCOME_UNKNOWN', 'CONFIRMED', 'FINALIZED_FAILED', 'NOT_SUBMITTED']);
export type OriginalPaymentState = z.infer<typeof OriginalPaymentStateSchema>;
export type StoredOriginalPayment = { evidence: OriginalPaymentRecord; state: OriginalPaymentState; submissionAttemptedAt: number | null; transaction?: string };

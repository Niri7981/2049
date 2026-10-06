import { atomicAmount, addAtomic, remainingAtomic } from '../authority/atomic-money';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { address } from '@solana/kit';
import { PaymentPayloadV2Schema } from '@x402/core/schemas';
import { getStandardTokenAccount } from '../payment/payment-preflight';
import { validateSignedPaymentIdentity } from '../payment/original-payment-evidence';
import { DEVNET_NETWORK, DEVNET_USDC_MINT, TOKEN_PROGRAM, type PaymentConfig } from '../payment/payment-config';
import { PaymentEvidenceSchema, PurchaseExecutionModeSchema, type PaymentEvidence } from '../purchases/purchase-ledger';
import { OriginalPaymentRecordSchema } from '../purchases/original-payment-record';
import { MonetaryScopeSchema, monetaryScopeId } from '../purchases/monetary-scope';
import { parseStoredSpendIntent } from '../authority/spend-intent';
import { hash } from '../purchases/spending-policy';

const RequestIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const StoredIntentSchema = z.object({
  authority: z.object({ grantId: z.string().uuid() }).passthrough().optional(),
}).passthrough();
const StoredQuoteSchema = z.object({
  amount: z.string().regex(/^\d+$/),
  network: z.string(),
  asset: z.string(),
  payTo: z.string(),
  extra: z.object({ memo: z.string().optional() }).passthrough().optional(),
}).passthrough();
const StoredDecisionSchema = z.object({ decision: z.string(), reason: z.string() }).passthrough();
const signaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;
const payerAddress = z.string().refine(value => {
  try { address(value); return true; } catch { return false; }
});
const StoredSettlementReceiptSchema = z.object({
  success: z.literal(true), transaction: z.string().regex(signaturePattern), payer: payerAddress,
  network: z.string(), amount: z.string().regex(/^\d+$/).optional(),
}).passthrough();

type Fetcher = typeof fetch;
type EvidenceOptions = {
  dataDirectory: string;
  settlementDatabase: string;
  config: PaymentConfig;
  fetcher?: Fetcher;
};

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function digest(value: string | null) {
  return value === null ? null : createHash('sha256').update(value).digest('hex');
}

function paymentStatus(status: string) {
  if (status === 'PAID') return 'PAID';
  if (status === 'PAYING') return 'PAYING';
  if (status === 'PAYMENT_UNKNOWN') return 'PAYMENT_UNKNOWN';
  if (status === 'FAILED') return 'FAILED';
  return 'NOT_STARTED';
}

function decisionStatus(status: string) {
  if (status === 'REJECTED') return 'DENIED';
  if (status === 'NEEDS_CONFIRMATION') return 'REQUIRES_APPROVAL';
  return status;
}

function executionMode(value: unknown) {
  const parsed = PurchaseExecutionModeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'UNKNOWN' as const;
}

function storedPaymentEvidence(value: unknown) {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = PaymentEvidenceSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}

/** A buyer RPC proof is valid without merchant settlement only when its exact
 * signed payload and immutable purchase/scope evidence still agree. */
function verifiedOriginalPaymentProof(ledger: DatabaseSync, row: Record<string, unknown>, proof: Extract<PaymentEvidence, { version: 3 }>) {
  try {
    const stored = ledger.prepare('SELECT evidence,state,transaction_id FROM original_payments WHERE purchase_id=?').get(String(row.id));
    if (!stored || stored.state !== 'CONFIRMED' || stored.transaction_id !== proof.transaction) return false;
    const original = OriginalPaymentRecordSchema.parse(JSON.parse(String(stored.evidence)));
    const intent = parseStoredSpendIntent(JSON.parse(String(row.purchase)));
    const parsedPayload = PaymentPayloadV2Schema.parse(JSON.parse(String(row.payload)));
    const payload = { x402Version: parsedPayload.x402Version, payload: parsedPayload.payload,
      ...(parsedPayload.resource ? { resource: parsedPayload.resource } : {}),
      ...(parsedPayload.extensions === undefined ? {} : { extensions: z.record(z.string(), z.unknown()).parse(parsedPayload.extensions) }),
      accepted: { ...parsedPayload.accepted, extra: z.record(z.string(), z.unknown()).parse(parsedPayload.accepted.extra),
        network: z.templateLiteral(['solana:', z.string().min(1)]).parse(parsedPayload.accepted.network) } };
    const scopeRow = ledger.prepare('SELECT environment,wallet_identity,network,asset_id,asset_decimals FROM monetary_scopes WHERE id=?').get(String(row.monetary_scope_id));
    if (!scopeRow) return false;
    const scope = MonetaryScopeSchema.parse({ environment: scopeRow.environment, walletIdentity: scopeRow.wallet_identity,
      network: scopeRow.network, assetId: scopeRow.asset_id, assetDecimals: scopeRow.asset_decimals });
    return original.purchaseId === row.id && original.purchaseId === intent.id && original.requestId === row.task_id
      && original.requestId === intent.idempotencyKey && original.scopeId === row.monetary_scope_id
      && original.scopeId === monetaryScopeId(scope) && original.monetaryScope.environment === row.execution_mode
      && original.executionBinding === intent.executionBinding && original.quoteFingerprint === intent.quoteFingerprint
      && original.quoteFingerprint === hash(payload.accepted) && original.payloadHash === hash(payload)
      && original.payloadHash === proof.payloadHash && original.quoteFingerprint === proof.quoteFingerprint
      && original.scopeId === proof.scopeId && hash(original) === proof.originalEvidenceHash
      && original.identity.messageHash === proof.messageHash && original.identity.payer === proof.payer
      && original.identity.amount === intent.amount && original.identity.amount === String(row.amount)
      && original.identity.recipient === intent.payTo && original.identity.mint === intent.assetId
      && original.identity.network === intent.network && original.identity.decimals === intent.assetDecimals
      && (!intent.x402Challenge || (hash(payload.resource) === hash(intent.x402Challenge.resource)
        && hash(payload.extensions ?? {}) === hash(intent.x402Challenge.extensions ?? {})))
      && validateSignedPaymentIdentity(payload, original.identity);
  } catch { return false; }
}

function accountingModeFilter(mode: string) {
  if (mode === 'simulated') return " AND execution_mode='simulated'";
  if (mode === 'live_devnet') return " AND (execution_mode='live_devnet' OR execution_mode IS NULL)";
  return ' AND execution_mode IS NULL';
}

async function rpc<T>(config: PaymentConfig, method: 'getMultipleAccounts' | 'getSignatureStatuses' | 'getTransaction', params: unknown[], fetcher: Fetcher): Promise<T> {
  const response = await fetcher(config.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok || text.length > 1_000_000) throw new Error(`RPC ${method} failed`);
  const body = record(JSON.parse(text), `RPC ${method} returned invalid JSON`);
  if (body.error !== undefined || !('result' in body)) throw new Error(`RPC ${method} failed`);
  return body.result as T;
}

function tokenAmount(value: unknown, owner: string, config: PaymentConfig) {
  if (value === null) return '0';
  const account = record(value, 'RPC returned an invalid token account');
  const data = record(account.data, 'RPC returned invalid token account data');
  const parsed = record(data.parsed, 'RPC returned an unparsed token account');
  const info = record(parsed.info, 'RPC returned invalid token account info');
  const amount = record(info.tokenAmount, 'RPC returned invalid token amount');
  if (account.owner !== TOKEN_PROGRAM || parsed.type !== 'account' || info.owner !== owner || info.mint !== config.mint || amount.decimals !== 6
    || typeof amount.amount !== 'string' || !/^\d+$/.test(amount.amount)) throw new Error('RPC token account does not match the historical purchase buyer');
  return amount.amount;
}

async function balances(config: PaymentConfig, historicalBuyer: string | null, fetcher: Fetcher) {
  const buyerAta = historicalBuyer ? await getStandardTokenAccount(historicalBuyer, config.mint) : null;
  const merchantAta = await getStandardTokenAccount(config.merchant, config.mint);
  const accounts = buyerAta ? [buyerAta, merchantAta] : [merchantAta];
  const result = await rpc<{ value: unknown[] }>(config, 'getMultipleAccounts', [accounts, { encoding: 'jsonParsed', commitment: 'confirmed' }], fetcher);
  if (!Array.isArray(result.value) || result.value.length !== accounts.length) throw new Error('RPC returned incomplete token balances');
  const buyer = historicalBuyer && buyerAta
    ? { address: historicalBuyer, tokenAccount: buyerAta, amount: tokenAmount(result.value[0], historicalBuyer, config) }
    : { address: 'UNKNOWN' as const, tokenAccount: null, amount: null };
  const merchantIndex = historicalBuyer ? 1 : 0;
  return {
    buyer,
    merchant: { address: config.merchant, tokenAccount: merchantAta, amount: tokenAmount(result.value[merchantIndex], config.merchant, config) },
  };
}

function verifiedSettlementPayer(status: unknown, rawReceipt: unknown, transaction: string | null, quote: z.infer<typeof StoredQuoteSchema>) {
  if (status !== 'CONFIRMED') return null;
  let receipt: z.infer<typeof StoredSettlementReceiptSchema>;
  try { receipt = StoredSettlementReceiptSchema.parse(JSON.parse(String(rawReceipt))); }
  catch { throw new Error('E2E_EVIDENCE_INTEGRITY_ERROR: confirmed settlement receipt is invalid'); }
  if (!transaction || receipt.transaction !== transaction || receipt.network !== quote.network || (receipt.amount !== undefined && receipt.amount !== quote.amount)) {
    throw new Error('E2E_EVIDENCE_INTEGRITY_ERROR: confirmed settlement receipt does not match the purchase');
  }
  return receipt.payer;
}

async function transactionConfirmation(transaction: string | null, config: PaymentConfig, fetcher: Fetcher) {
  if (!transaction || !signaturePattern.test(transaction)) return { status: 'NOT_APPLICABLE' as const };
  const [statuses, transactionResult] = await Promise.all([
    rpc<{ value: Array<null | { err: unknown; confirmationStatus?: string }> }>(config, 'getSignatureStatuses', [[transaction], { searchTransactionHistory: true }], fetcher),
    rpc<null | { meta?: { err?: unknown } }>(config, 'getTransaction', [transaction, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }], fetcher),
  ]);
  const value = statuses.value?.[0] ?? null;
  const chainError = Boolean((value && value.err !== null) || (transactionResult?.meta && transactionResult.meta.err !== null));
  const confirmed = Boolean(value && value.err === null && ['confirmed', 'finalized'].includes(value.confirmationStatus ?? '')
    && transactionResult?.meta?.err === null);
  return {
    status: confirmed ? 'CONFIRMED' as const : chainError ? 'FAILED' as const : 'UNKNOWN' as const,
    confirmationStatus: value?.confirmationStatus ?? null,
    transactionFound: transactionResult !== null,
  };
}

/** Read-only evidence for one durable request. It hashes stored payload locally and never returns it or approval values. */
export async function collectE2eEvidence(rawRequestId: string, options: EvidenceOptions) {
  const requestId = RequestIdSchema.parse(rawRequestId);
  if (options.config.cluster !== 'devnet' || options.config.network !== DEVNET_NETWORK || options.config.mint !== DEVNET_USDC_MINT) {
    throw new Error('E2E evidence requires the fixed Solana Devnet test USDC configuration');
  }
  const ledgerPath = join(options.dataDirectory, 'app-ledger.sqlite');
  if (!existsSync(ledgerPath)) throw new Error('The E2E ledger does not exist');
  if (!existsSync(options.settlementDatabase)) throw new Error('The E2E settlement database does not exist');

  const ledger = new DatabaseSync(ledgerPath, { readOnly: true });
  const settlements = new DatabaseSync(options.settlementDatabase, { readOnly: true });
  try {
    const scoped = ledger.prepare('PRAGMA table_info(purchases)').all().some(column => column.name === 'monetary_scope_id');
    const scopeColumn = scoped ? ',monetary_scope_id' : '';
    const row = ledger.prepare(`SELECT id,task_id,purchase,quote,decision,status,CAST(amount AS TEXT) AS amount,transaction_id,execution_mode,payment_evidence${scopeColumn},
      data,data IS NOT NULL AS delivered,payload,payload IS NOT NULL AS payment_payload_present
      FROM purchases WHERE task_id=?`).get(requestId);
    if (!row) throw new Error('The requested purchase does not exist');
    const purchase = StoredIntentSchema.parse(JSON.parse(String(row.purchase)));
    const quote = StoredQuoteSchema.parse(JSON.parse(String(row.quote)));
    const decision = StoredDecisionSchema.parse(JSON.parse(String(row.decision)));
    const mode = executionMode(row.execution_mode);
    const paymentEvidence = storedPaymentEvidence(row.payment_evidence);
    const payloadPresent = Boolean(row.payment_payload_present);
    let payloadHash: string | null = null;
    if (typeof row.payload === 'string') {
      try { payloadHash = hash(JSON.parse(row.payload)); } catch { /* Malformed legacy payloads cannot prove a live payment. */ }
    }
    if (String(row.amount) !== quote.amount) throw new Error('Stored quote amount does not match the purchase');
    if (quote.network !== options.config.network || quote.asset !== options.config.mint || quote.payTo !== options.config.merchant) {
      throw new Error('Stored quote does not match the E2E network, token, or merchant');
    }

    const events = ledger.prepare('SELECT sequence,type,at FROM purchase_events WHERE purchase_id=? ORDER BY sequence').all(String(row.id))
      .map(event => ({ sequence: Number(event.sequence), type: String(event.type), at: Number(event.at) }));
    const clock = scoped ? ledger.prepare('SELECT spending_day,time_zone FROM monetary_budget_clock WHERE scope_id=?').get(String(row.monetary_scope_id)) : ledger.prepare('SELECT spending_day,time_zone FROM app_budget_clock WHERE id=1').get();
    const settings = scoped ? ledger.prepare('SELECT daily_limit FROM monetary_controls WHERE scope_id=?').get(String(row.monetary_scope_id)) : ledger.prepare('SELECT CAST(daily_limit AS TEXT) AS daily_limit FROM app_settings WHERE id=1').get();
    if (!clock || !settings) throw new Error('The managed budget state is incomplete');
    const budgetModeFilter = scoped ? ` AND monetary_scope_id='${z.string().regex(/^[a-f0-9]{64}$/).parse(row.monetary_scope_id)}'` : accountingModeFilter(mode);
    const sum = (where: string, ...values: string[]) => ledger.prepare(`SELECT CAST(amount AS TEXT) AS amount FROM purchases WHERE ${where}`).all(...values).reduce((total, item) => addAtomic(total, atomicAmount(item.amount)), 0n);
    const paid = sum(`status='PAID' AND confirmed_day=?${budgetModeFilter}`, String(clock.spending_day));
    const reserved = sum(`status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN')${budgetModeFilter}`);
    const dailyLimit = settings.daily_limit === null ? null : atomicAmount(settings.daily_limit);

    let grant: null | { status: string; committed: string; remaining: string } = null;
    const grantId = purchase.authority?.grantId;
    if (grantId) {
      const grantRow = ledger.prepare('SELECT status,CAST(total_limit AS TEXT) AS total_limit FROM spend_grants WHERE id=?').get(grantId);
      if (!grantRow) throw new Error('The purchase references a missing SpendGrant');
      const committed = sum(`json_extract(purchase,'$.authority.grantId')=? AND status IN ('APPROVED','PAYING','PAYMENT_UNKNOWN','PAID')${budgetModeFilter}`, grantId);
      const totalLimit = atomicAmount(grantRow.total_limit);
      grant = { status: String(grantRow.status), committed: String(committed), remaining: remainingAtomic(totalLimit, committed).toString() };
    }

    const memo = quote.extra?.memo ?? '';
    const quoteCount = Number(settlements.prepare('SELECT COUNT(*) AS total FROM day4_quotes WHERE id=?').get(memo)!.total);
    const settlementRows = settlements.prepare('SELECT status,receipt,body FROM day4_settlements WHERE quote_id=?').all(memo);
    const totalQuoteCount = Number(settlements.prepare('SELECT COUNT(*) AS total FROM day4_quotes').get()!.total);
    const totalSettlementCount = Number(settlements.prepare('SELECT COUNT(*) AS total FROM day4_settlements').get()!.total);
    const data = row.data === null ? null : String(row.data);
    const settlementBody = settlementRows.length === 1 && typeof settlementRows[0]?.body === 'string' ? settlementRows[0].body : null;
    const transaction = row.transaction_id === null ? null : String(row.transaction_id);
    if (settlementRows.length > 1) throw new Error('E2E_EVIDENCE_INTEGRITY_ERROR: multiple settlements exist for the purchase quote');
    const settlementPayer = settlementRows.length === 1
      ? verifiedSettlementPayer(settlementRows[0]?.status, settlementRows[0]?.receipt, transaction, quote)
      : null;
    const paymentEvidenceProofVerified = String(row.status) === 'PAID' && payloadPresent && payloadHash !== null
      && payloadHash === paymentEvidence?.payloadHash && transaction !== null && signaturePattern.test(transaction)
      && transaction === paymentEvidence?.transaction && paymentEvidence?.quoteFingerprint === purchase.quoteFingerprint
      && (paymentEvidence?.version === 3 ? verifiedOriginalPaymentProof(ledger, row, paymentEvidence) : paymentEvidence?.settlementConfirmed === true)
      && ['confirmed', 'finalized'].includes(paymentEvidence.confirmationStatus);
    const paymentEvidencePayer = paymentEvidence && paymentEvidence.version !== 1 ? paymentEvidence.payer : null;
    if (paymentEvidencePayer && !paymentEvidenceProofVerified) {
      throw new Error('E2E_EVIDENCE_INTEGRITY_ERROR: payment evidence payer is not bound to the paid purchase');
    }
    if (paymentEvidencePayer && settlementPayer && paymentEvidencePayer !== settlementPayer) {
      throw new Error('E2E_EVIDENCE_INTEGRITY_ERROR: payment evidence payer does not match settlement payer');
    }
    const hasDurablePayer = paymentEvidencePayer !== null || settlementPayer !== null;
    if (mode === 'simulated' && hasDurablePayer) {
      throw new Error('E2E_EVIDENCE_INTEGRITY_ERROR: simulated purchase has live payer evidence');
    }
    const historicalBuyer = String(row.status) === 'PAID' && mode !== 'simulated'
      ? paymentEvidencePayer ?? settlementPayer
      : null;
    const livePaymentProofVerified = mode === 'live_devnet' && paymentEvidenceProofVerified;
    const buyerMatchesSettlement = historicalBuyer !== null && settlementPayer !== null && historicalBuyer === settlementPayer;
    const buyerMatchesPaymentEvidence = historicalBuyer !== null && paymentEvidencePayer !== null && historicalBuyer === paymentEvidencePayer;
    const resourceHash = digest(data);
    const settlementResourceHash = digest(settlementBody);
    const eventTypes = new Set(events.map(event => event.type));

    const [tokenBalances, rpcConfirmation] = await Promise.all([
      balances(options.config, historicalBuyer, options.fetcher ?? fetch),
      transactionConfirmation(transaction, options.config, options.fetcher ?? fetch),
    ]);

    const status = decisionStatus(String(row.status));
    return {
      requestId,
      purchaseId: String(row.task_id),
      decision: { decision: decision.decision, status: decision.decision, reason: decision.reason },
      paymentStatus: paymentStatus(status),
      deliveryStatus: status === 'PAID' ? (Boolean(row.delivered) ? 'COMPLETE' : 'PENDING') : 'NOT_DELIVERED',
      executionMode: mode,
      buyer: tokenBalances.buyer,
      historicalBuyerEvidenceComplete: historicalBuyer !== null,
      buyerMatchesSettlement,
      buyerMatchesPaymentEvidence,
      runtimeConfiguredBuyer: options.config.buyer,
      quotedAmount: quote.amount,
      amountPaid: livePaymentProofVerified ? quote.amount : '0',
      transactionSignature: transaction,
      paymentPayloadPresent: payloadPresent,
      paymentPayingEventPresent: eventTypes.has('payment.PAYING'),
      paymentPaidEventPresent: eventTypes.has('payment.PAID'),
      livePaymentProof: {
        verified: livePaymentProofVerified,
        transactionSignaturePresent: transaction !== null && signaturePattern.test(transaction),
        chainConfirmation: paymentEvidence?.confirmationStatus ?? null,
        settlementConfirmed: paymentEvidence?.settlementConfirmed === true,
      },
      events,
      budget: {
        day: String(clock.spending_day), timeZone: String(clock.time_zone), dailyLimit: dailyLimit === null ? null : String(dailyLimit),
        paid: String(paid), reserved: String(reserved), remaining: dailyLimit === null ? null : remainingAtomic(dailyLimit, addAtomic(paid, reserved)).toString(),
      },
      grant,
      resourcePresent: Boolean(row.delivered),
      resourceHash,
      resourceMatchesSettlement: resourceHash !== null && resourceHash === settlementResourceHash,
      settlement: {
        quoteCount,
        count: settlementRows.length,
        states: settlementRows.map(item => String(item.status)),
        totalQuoteCount,
        totalSettlementCount,
      },
      tokenBalances,
      rpcTransaction: rpcConfirmation,
    };
  } finally {
    settlements.close();
    ledger.close();
  }
}

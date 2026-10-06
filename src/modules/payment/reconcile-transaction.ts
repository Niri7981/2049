import { getBase58Decoder } from '@solana/kit';
import { z } from 'zod';
import type { PaymentConfig } from './payment-config';
import { DEVNET_GENESIS, MAINNET_GENESIS, validatePaymentEnvironment } from './payment-environment';
import { solanaRpc } from './solana-payment';
import { decodeOriginalTransaction, matchesSignedPaymentIdentity, SignedPaymentIdentitySchema,
  TransactionSignatureSchema, transactionMessageHash, verifyOriginalTransactionSignatures,
  type SignedPaymentIdentity } from './original-payment-evidence';
export { transactionMessageHash } from './original-payment-evidence';

export type ChainOutcome = { status: 'CONFIRMED'; transaction: string; confirmationStatus?: 'confirmed' | 'finalized' }
  | { status: 'FAILED'; transaction: string } | { status: 'UNKNOWN' };
const unknown: ChainOutcome = { status: 'UNKNOWN' };
const TransactionResultSchema = z.object({
  transaction: z.tuple([z.string().max(1_644), z.literal('base64')]),
  meta: z.object({ err: z.union([z.null(), z.string().min(1), z.object({}).passthrough()]) }).passthrough().nullable(),
}).passthrough().nullable();
const HistorySchema = z.array(z.object({ signature: TransactionSignatureSchema, memo: z.string().max(1_024).nullable() })
  .passthrough()).max(100);
type ReadRpc = (method: string, params?: unknown[]) => Promise<unknown>;

/** A separate bounded buyer read path; it never contacts the merchant or sends a transaction. */
async function boundedRpc(config: PaymentConfig, method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(config.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.body) throw new Error('ORIGINAL_PAYMENT_RPC_UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256 * 1_024) throw new Error('ORIGINAL_PAYMENT_RPC_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const envelope = z.object({ jsonrpc: z.literal('2.0'), id: z.literal(1), result: z.unknown() }).passthrough().parse(result);
  if (!Object.hasOwn(envelope, 'result') || Object.hasOwn(envelope, 'error')) throw new Error('ORIGINAL_PAYMENT_RPC_INVALID');
  return envelope.result;
}

async function correctNetwork(config: PaymentConfig, read: ReadRpc, identity?: SignedPaymentIdentity) {
  const { mode, cluster, genesisHash, rpcUrl, network, asset, isProduction } = config;
  validatePaymentEnvironment({ mode, cluster, genesisHash, rpcUrl, network, asset, isProduction });
  if (config.mint !== asset.mint) return false;
  if (identity && (identity.network !== network || identity.mint !== config.mint || identity.payer !== config.buyer
    || identity.decimals !== asset.decimals || identity.tokenProgram !== asset.tokenProgram
    || identity.genesisHash !== genesisHash)) return false;
  const genesis = await read('getGenesisHash');
  if (typeof genesis !== 'string' || genesisHash === null || genesis !== genesisHash) return false;
  if (cluster === 'localnet' && (genesis === DEVNET_GENESIS || genesis === MAINNET_GENESIS
    || (network !== 'solana:localnet' && network !== `solana:${genesis.slice(0, 32)}`))) return false;
  return true;
}

type MatchTransaction = (wire: string, signature: string) => boolean;
async function inspect(read: ReadRpc, signature: string, matches: MatchTransaction,
  onOriginalSignature: (signature: string) => void = () => {}): Promise<ChainOutcome> {
  if (!TransactionSignatureSchema.safeParse(signature).success) return unknown;
  const readTransaction = async (commitment: 'confirmed' | 'finalized') => TransactionResultSchema.parse(await read('getTransaction',
    [signature, { encoding: 'base64', commitment, maxSupportedTransactionVersion: 0 }]));
  const result = await readTransaction('confirmed');
  if (!result || !matches(result.transaction[0], signature)) return unknown;
  onOriginalSignature(signature);
  if (!result.meta) return unknown;
  if (result.meta.err === null) return { status: 'CONFIRMED', transaction: signature, confirmationStatus: 'confirmed' };
  // A failed confirmed fork is not a conclusive failure of the original payment.
  const finalized = await readTransaction('finalized');
  if (!finalized?.meta || !matches(finalized.transaction[0], signature)) return unknown;
  return finalized.meta.err === null
    ? { status: 'CONFIRMED', transaction: signature, confirmationStatus: 'finalized' }
    : { status: 'FAILED', transaction: signature };
}

/** Reconcile immutable buyer-signed facts; disappearance, expiry, or absent history remains unknown. */
export async function reconcileStoredOriginalPayment(config: PaymentConfig, stored: SignedPaymentIdentity, knownSignature?: string,
  onSignature: (signature: string) => void = () => {}): Promise<ChainOutcome> {
  try {
    const identity = SignedPaymentIdentitySchema.parse(stored);
    const read: ReadRpc = (method, params) => boundedRpc(config, method, params);
    const signatures = [...new Set([identity.knownSignature, knownSignature].filter((value): value is string => value !== undefined))];
    // Receipt signatures remain observations until exact signed-message verification succeeds.
    for (const signature of signatures) if (TransactionSignatureSchema.safeParse(signature).success) onSignature(signature);
    if (!await correctNetwork(config, read, identity)) return unknown;
    const matches: MatchTransaction = (wire, signature) => matchesSignedPaymentIdentity(wire, identity, config, signature);
    for (const signature of signatures) {
      const outcome = await inspect(read, signature, matches);
      if (outcome.status !== 'UNKNOWN') return outcome;
    }
    const recent = HistorySchema.parse(await read('getSignaturesForAddress', [identity.payer, { limit: 100, commitment: 'confirmed' }]));
    // Memo narrows a bounded search; only the exact original buyer-signed message proves identity.
    const candidates = recent.filter(item => item.memo?.includes(identity.actualMemo)).slice(0, 3);
    for (const candidate of candidates) {
      const outcome = await inspect(read, candidate.signature, matches, onSignature);
      if (outcome.status !== 'UNKNOWN') return outcome;
    }
    return unknown;
  } catch { return unknown; }
}

function legacyMatches(config: PaymentConfig, messageHash: string): MatchTransaction {
  return (wire, signature) => {
    try {
      const tx = decodeOriginalTransaction(wire).transaction;
      const buyerIndex = tx.message.staticAccountKeys.findIndex(key => key.toBase58() === config.buyer);
      return buyerIndex >= 0 && buyerIndex < tx.message.header.numRequiredSignatures
        && verifyOriginalTransactionSignatures(tx, true) && transactionMessageHash(wire) === messageHash
        && getBase58Decoder().decode(tx.signatures[0]) === signature;
    } catch { return false; }
  };
}

/** Compatibility for the existing test merchant's already-validated message-hash records. */
export async function inspectOriginalTransaction(config: PaymentConfig, signature: string, messageHash: string): Promise<ChainOutcome> {
  try {
    const read: ReadRpc = (method, params) => solanaRpc<unknown>(config, method, params);
    if (!/^[a-f0-9]{64}$/.test(messageHash) || !await correctNetwork(config, read)) return unknown;
    return await inspect(read, signature, legacyMatches(config, messageHash));
  } catch { return unknown; }
}

/** Compatibility lookup retains exact message matching; arbitrary actual SDK memos are accepted. */
export async function reconcileOriginalTransaction(config: PaymentConfig, messageHash: string, memo: string, knownSignature?: string): Promise<ChainOutcome> {
  try {
    if (!/^[a-f0-9]{64}$/.test(messageHash) || typeof memo !== 'string' || memo.length === 0 || Buffer.byteLength(memo) > 256) return unknown;
    const read: ReadRpc = (method, params) => solanaRpc<unknown>(config, method, params);
    if (!await correctNetwork(config, read)) return unknown;
    const matches = legacyMatches(config, messageHash);
    if (knownSignature) {
      const known = await inspect(read, knownSignature, matches);
      if (known.status !== 'UNKNOWN') return known;
    }
    const recent = HistorySchema.parse(await read('getSignaturesForAddress', [config.buyer, { limit: 100, commitment: 'confirmed' }]));
    for (const candidate of recent.filter(item => item.memo?.includes(memo)).slice(0, 3)) {
      const outcome = await inspect(read, candidate.signature, matches);
      if (outcome.status !== 'UNKNOWN') return outcome;
    }
    return unknown;
  } catch { return unknown; }
}

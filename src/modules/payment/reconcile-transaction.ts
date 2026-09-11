import { createHash } from 'node:crypto';
import { VersionedTransaction } from '@solana/web3.js';
import { getBase58Decoder } from '@solana/kit';
import type { PaymentConfig } from './payment-config';
import { solanaRpc } from './solana-payment';

export type ChainOutcome = { status: 'CONFIRMED' | 'FAILED'; transaction: string } | { status: 'UNKNOWN' };
const signaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;
export function transactionMessageHash(wire: string) {
  const bytes = Buffer.from(wire, 'base64');
  const tx = VersionedTransaction.deserialize(bytes);
  if (!Buffer.from(tx.serialize()).equals(bytes)) throw new Error('Noncanonical transaction');
  return createHash('sha256').update(tx.message.serialize()).digest('hex');
}

/** Read-only proof of the exact signed message, never proof by a receipt alone. */
export async function inspectOriginalTransaction(config: PaymentConfig, signature: string, messageHash: string): Promise<ChainOutcome> {
  if (!signaturePattern.test(signature)) return { status: 'UNKNOWN' };
  type TransactionResult = { transaction: [string, string]; meta: { err: unknown } | null } | null;
  const read = (commitment: string) => solanaRpc<TransactionResult>(config, 'getTransaction', [signature, {
    encoding: 'base64', commitment, maxSupportedTransactionVersion: 0,
  }]);
  function matches(result: TransactionResult) {
    if (!result?.meta || !('err' in result.meta) || result.transaction?.[1] !== 'base64') return false;
    const wire = result.transaction[0];
    const decoded = VersionedTransaction.deserialize(Buffer.from(wire, 'base64'));
    return transactionMessageHash(wire) === messageHash && getBase58Decoder().decode(decoded.signatures[0]) === signature;
  }
  const result = await read('confirmed');
  if (!matches(result)) return { status: 'UNKNOWN' };
  if (result!.meta!.err === null) return { status: 'CONFIRMED', transaction: signature };
  // Only finalized failure can release a reservation; a transient fork cannot.
  const finalized = await read('finalized');
  return matches(finalized) && finalized!.meta!.err !== null
    ? { status: 'FAILED', transaction: signature } : { status: 'UNKNOWN' };
}

/** A missing receipt can be recovered through the unique quote memo. Bounded history only. */
export async function reconcileOriginalTransaction(config: PaymentConfig, messageHash: string, memo: string, knownSignature?: string): Promise<ChainOutcome> {
  if (knownSignature) {
    const known = await inspectOriginalTransaction(config, knownSignature, messageHash);
    if (known.status !== 'UNKNOWN') return known;
  }
  if (!/^day4:[A-Za-z0-9_-]{22}$/.test(memo)) return { status: 'UNKNOWN' };
  const recent = await solanaRpc<Array<{ signature: string; memo: string | null }>>(config, 'getSignaturesForAddress', [
    config.buyer, { limit: 100, commitment: 'confirmed' },
  ]);
  // RPC may render the memo as "[27] day4:...". It is only a search hint;
  // byte-for-byte message equality remains the authoritative binding.
  const candidates = recent.filter(item => typeof item.memo === 'string' && item.memo.includes(memo)).slice(0, 3);
  for (const item of candidates) {
    const outcome = await inspectOriginalTransaction(config, item.signature, messageHash);
    if (outcome.status !== 'UNKNOWN') return outcome;
  }
  return { status: 'UNKNOWN' };
}

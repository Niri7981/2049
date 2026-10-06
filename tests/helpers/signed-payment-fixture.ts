import { getBase58Decoder, type KeyPairSigner } from '@solana/kit';
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import type { PaymentConfig } from '../../src/modules/payment/payment-config';

/** Ephemeral deterministic boundary fixtures; no Keychain, network or real payment. */
export const FIXTURE_TRANSACTION_SIGNATURE = getBase58Decoder().decode(new Uint8Array(64).fill(1));
export async function signedPaymentFixture(signer: KeyPairSigner, config: PaymentConfig, quote: PaymentRequirements): Promise<PaymentPayload> {
  const payer = new PublicKey(config.buyer); const recipient = new PublicKey(quote.payTo); const mint = new PublicKey(quote.asset);
  const feePayer = new PublicKey(String(quote.extra?.feePayer));
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: feePayer, recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1n }),
      createTransferCheckedInstruction(getAssociatedTokenAddressSync(mint, payer, true), mint, getAssociatedTokenAddressSync(mint, recipient, true), payer, BigInt(quote.amount), 6),
      new TransactionInstruction({ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [],
        data: Buffer.from(typeof quote.extra?.memo === 'string' ? quote.extra.memo : 'fixture-random-sdk-memo') }),
    ] }).compileToV0Message());
  const index = transaction.message.staticAccountKeys.findIndex(key => key.toBase58() === signer.address);
  transaction.signatures[index] = new Uint8Array(await crypto.subtle.sign('Ed25519', signer.keyPair.privateKey, new Uint8Array(transaction.message.serialize())));
  return { x402Version: 2, accepted: quote, payload: { transaction: Buffer.from(transaction.serialize()).toString('base64') } };
}

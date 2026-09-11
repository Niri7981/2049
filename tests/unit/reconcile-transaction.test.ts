import { Keypair, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { getBase58Decoder } from '@solana/kit';
import { afterEach, expect, it, vi } from 'vitest';
import { solanaRpc } from '../../src/modules/payment/solana-payment';
import { inspectOriginalTransaction, reconcileOriginalTransaction, transactionMessageHash } from '../../src/modules/payment/reconcile-transaction';
import { loadPaymentConfig } from '../../src/modules/payment/payment-config';
vi.mock('../../src/modules/payment/solana-payment', () => ({ solanaRpc: vi.fn() }));
const buyer = Keypair.generate();
const config = loadPaymentConfig({ DEMO_BUYER_PUBLIC_KEY: buyer.publicKey.toBase58(), DEMO_MERCHANT_PUBLIC_KEY: Keypair.generate().publicKey.toBase58() });
function fixture() {
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: buyer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [] }).compileToV0Message());
  tx.sign([buyer]);
  const wire = Buffer.from(tx.serialize()).toString('base64');
  return { signature: getBase58Decoder().decode(tx.signatures[0]), hash: transactionMessageHash(wire), rpc: { transaction: [wire, 'base64'], meta: { err: null } } };
}
afterEach(() => vi.resetAllMocks());
it('confirms only the exact original message and transaction signature', async () => {
  const f = fixture(); vi.mocked(solanaRpc).mockResolvedValue(f.rpc);
  expect(await inspectOriginalTransaction(config, f.signature, f.hash)).toEqual({ status: 'CONFIRMED', transaction: f.signature });
  expect(await inspectOriginalTransaction(config, f.signature, fixture().hash)).toEqual({ status: 'UNKNOWN' });
  expect(await inspectOriginalTransaction(config, fixture().signature, f.hash)).toEqual({ status: 'UNKNOWN' });
});
it('only finalized failures can release budget', async () => {
  const f = fixture(); const failed = { ...f.rpc, meta: { err: { InstructionError: [1, 'failure'] } } };
  vi.mocked(solanaRpc).mockResolvedValueOnce(failed).mockResolvedValueOnce(null);
  expect(await inspectOriginalTransaction(config, f.signature, f.hash)).toEqual({ status: 'UNKNOWN' });
  vi.mocked(solanaRpc).mockResolvedValue(failed);
  expect(await inspectOriginalTransaction(config, f.signature, f.hash)).toEqual({ status: 'FAILED', transaction: f.signature });
  expect(solanaRpc).toHaveBeenLastCalledWith(config, 'getTransaction', [f.signature, expect.objectContaining({ commitment: 'finalized' })]);
});
it('locates a lost receipt by memo and verifies its exact message', async () => {
  const f = fixture(); const memo = 'day4:abcdefghijklmnopqrstuv';
  vi.mocked(solanaRpc).mockResolvedValueOnce([{ signature: f.signature, memo: '[27] ' + memo }]).mockResolvedValueOnce(f.rpc);
  expect(await reconcileOriginalTransaction(config, f.hash, memo)).toEqual({ status: 'CONFIRMED', transaction: f.signature });
  expect(solanaRpc).toHaveBeenNthCalledWith(1, config, 'getSignaturesForAddress', [config.buyer, { limit: 100, commitment: 'confirmed' }]);
});
it('history absence never means failure and performs no writes', async () => {
  vi.mocked(solanaRpc).mockResolvedValue([]);
  expect(await reconcileOriginalTransaction(config, fixture().hash, 'day4:abcdefghijklmnopqrstuv')).toEqual({ status: 'UNKNOWN' });
  expect(solanaRpc).toHaveBeenCalledTimes(1);
});

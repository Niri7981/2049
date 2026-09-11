import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setupWalletAccounts } from '../../scripts/wallet-accounts';
import { solanaRpc } from '../../src/modules/payment/solana-payment';
import { loadBuyerSigner } from '../../src/modules/payment/wallet';
import { DEVNET_GENESIS, TOKEN_PROGRAM, DEVNET_USDC_MINT, DEVNET_NETWORK } from '../../src/modules/payment/payment-config';
vi.mock('../../src/modules/payment/solana-payment', () => ({ solanaRpc: vi.fn(), confirmSolanaTransaction: vi.fn() }));
vi.mock('../../src/modules/payment/wallet', () => ({ loadBuyerSigner: vi.fn() }));
vi.mock('../../src/modules/payment/payment-config', async original => ({ ...await original<typeof import('../../src/modules/payment/payment-config')>(), loadPaymentConfig: () => ({ cluster: 'devnet', network: DEVNET_NETWORK, mint: DEVNET_USDC_MINT, buyer: 'HXvqH3weDKJaVnvwVkN5MRPB28LGgoGYAmB5h4f6c9FU', merchant: '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs', rpcUrl: 'https://api.devnet.solana.com' }) }));
let directory: string;
beforeEach(async () => { vi.clearAllMocks(); directory = await mkdtemp(join(tmpdir(), 'day4-accounts-test-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
it('refuses the wrong chain before accessing a signer', async () => {
  vi.mocked(solanaRpc).mockResolvedValue('wrong-chain');
  await expect(setupWalletAccounts(directory)).rejects.toThrow('verified Devnet');
  expect(loadBuyerSigner).not.toHaveBeenCalled();
});
it('refuses an invalid mint before accessing a signer', async () => {
  vi.mocked(solanaRpc).mockResolvedValueOnce(DEVNET_GENESIS).mockResolvedValueOnce({ value: [null, null, null] });
  await expect(setupWalletAccounts(directory)).rejects.toThrow('Invalid test USDC mint');
  expect(loadBuyerSigner).not.toHaveBeenCalled();
});
it('refuses insufficient setup funds without signing or sending', async () => {
  vi.mocked(solanaRpc).mockResolvedValueOnce(DEVNET_GENESIS).mockResolvedValueOnce({ value: [{ owner: TOKEN_PROGRAM, data: { parsed: { type: 'mint', info: { decimals: 6, isInitialized: true } } } }, null, null] }).mockResolvedValueOnce({ value: 0 }).mockResolvedValueOnce(2039280);
  await expect(setupWalletAccounts(directory)).rejects.toThrow('0.01 test SOL');
  expect(loadBuyerSigner).not.toHaveBeenCalled();
  expect(vi.mocked(solanaRpc).mock.calls.some(call => call[1] === 'sendTransaction')).toBe(false);
});

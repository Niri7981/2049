import { randomBytes } from 'node:crypto';
import { createKeyPairSignerFromPrivateKeyBytes, getBase58Decoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { initializeProductWallet, loadProductWalletSigner, type WalletSecretStore } from '../../src/modules/app-wallet/product-wallet';

class MemorySecrets implements WalletSecretStore {
  value?: string;
  creates = 0;
  async read() { return this.value; }
  async create(secret: string) { this.creates += 1; this.value = secret; }
}

describe('product Keychain wallet lifecycle', () => {
  it('creates once, verifies, and reuses the same signer after restart', async () => {
    const store = new MemorySecrets();
    const first = await initializeProductWallet(store);
    const second = await initializeProductWallet(store);
    expect(first.reused).toBe(false);
    expect(second).toEqual({ address: first.address, reused: true });
    expect(store.creates).toBe(1);
    expect((await loadProductWalletSigner(first.address, store)).address).toBe(first.address);
  });

  it('refuses a signer mismatch instead of replacing the saved wallet', async () => {
    const store = new MemorySecrets();
    const saved = await initializeProductWallet(store);
    const seed = new Uint8Array(randomBytes(32));
    const other = await createKeyPairSignerFromPrivateKeyBytes(seed);
    const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', other.keyPair.publicKey));
    store.value = getBase58Decoder().decode(new Uint8Array([...seed, ...publicBytes]));
    seed.fill(0);
    await expect(loadProductWalletSigner(saved.address, store)).rejects.toThrow('does not match');
  });

  it('does not create a replacement when reading the secret fails', async () => {
    let creates = 0;
    const store: WalletSecretStore = { read: async () => { throw new Error('denied'); }, create: async () => { creates += 1; } };
    await expect(initializeProductWallet(store)).rejects.toThrow('denied');
    expect(creates).toBe(0);
  });
});

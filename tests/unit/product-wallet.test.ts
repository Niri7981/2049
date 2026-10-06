import { randomBytes } from 'node:crypto';
import { createKeyPairSignerFromPrivateKeyBytes, getBase58Decoder } from '@solana/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeProductWallet, loadProductWalletSigner, initializeEnvironmentWallet, loadEnvironmentWalletSigner, type WalletSecretStore } from '../../src/modules/app-wallet/product-wallet';
import { APP_WALLET_KEYCHAIN, MAINNET_WALLET_KEYCHAIN, productWalletKeychain } from '../../src/modules/payment/keychain';
import { resolvePaymentEnvironment } from '../../src/modules/payment/payment-environment';

afterEach(() => vi.unstubAllEnvs());

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

describe('environment-aware product wallets', () => {
  const devnet = resolvePaymentEnvironment({}, 'live_devnet');
  const mainnet = resolvePaymentEnvironment({ YOSH_EXECUTION_MODE: 'live_mainnet' });
  it('preserves the existing test item and uses distinct Mainnet service and account identities', () => {
    expect(productWalletKeychain(devnet)).toBe(APP_WALLET_KEYCHAIN);
    expect(APP_WALLET_KEYCHAIN).toEqual({ service: 'com.2049.wallet.v1', account: 'consumer-wallet-v1' });
    expect(productWalletKeychain(mainnet)).toBe(MAINNET_WALLET_KEYCHAIN);
    expect(MAINNET_WALLET_KEYCHAIN.service).not.toBe(APP_WALLET_KEYCHAIN.service);
    expect(MAINNET_WALLET_KEYCHAIN.account).not.toBe(APP_WALLET_KEYCHAIN.account);
  });
  it('creates Mainnet independently, then switches and reloads only the correct wallet', async () => {
    const stores = { test: new MemorySecrets(), mainnet: new MemorySecrets() };
    const test = await initializeProductWallet(stores.test);
    const originalSecret = stores.test.value;
    const production = await initializeEnvironmentWallet(mainnet, stores);
    expect(production.address).not.toBe(test.address);
    expect(stores.test.value).toBe(originalSecret);
    expect(stores.test.creates).toBe(1);
    expect(stores.mainnet.creates).toBe(1);
    expect(await initializeEnvironmentWallet(devnet, stores)).toEqual({ ...test, reused: true });
    expect(await initializeEnvironmentWallet(mainnet, stores)).toEqual({ ...production, reused: true });
    expect((await loadEnvironmentWalletSigner(test.address, devnet, stores)).address).toBe(test.address);
    expect((await loadEnvironmentWalletSigner(production.address, mainnet, stores)).address).toBe(production.address);
    await expect(loadEnvironmentWalletSigner(test.address, mainnet, stores)).rejects.toThrow('test wallet identity is forbidden');
    await expect(loadEnvironmentWalletSigner(production.address, devnet, stores)).rejects.toThrow('does not match');
  });
  it('rejects an accidentally copied Devnet secret without replacing either item', async () => {
    const stores = { test: new MemorySecrets(), mainnet: new MemorySecrets() };
    const test = await initializeProductWallet(stores.test);
    stores.mainnet.value = stores.test.value;
    await expect(initializeEnvironmentWallet(mainnet, stores)).rejects.toThrow('test wallet identity is forbidden');
    await expect(loadEnvironmentWalletSigner(test.address, mainnet, stores)).rejects.toThrow('test wallet identity is forbidden');
    expect(stores.mainnet.creates).toBe(0);
    expect(stores.mainnet.value).toBe(stores.test.value);
  });
  it('does not create Mainnet when either isolation check or Mainnet Keychain access is denied', async () => {
    const mainnetStore = new MemorySecrets();
    const denied: WalletSecretStore = { read: async () => { throw new Error('access denied'); }, create: async () => { throw new Error('must not create'); } };
    await expect(initializeEnvironmentWallet(mainnet, { test: denied, mainnet: mainnetStore })).rejects.toThrow('access denied');
    expect(mainnetStore.creates).toBe(0);
    await expect(initializeEnvironmentWallet(mainnet, { test: new MemorySecrets(), mainnet: denied })).rejects.toThrow('access denied');
  });
  it('rejects legacy product-wallet entry points after switching to Mainnet', async () => {
    const test = new MemorySecrets();
    const original = await initializeProductWallet(test);
    vi.stubEnv('YOSH_EXECUTION_MODE', 'live_mainnet');
    await expect(initializeProductWallet(test)).rejects.toThrow('explicit environment wallet required');
    await expect(loadProductWalletSigner(original.address, test)).rejects.toThrow('explicit environment wallet required');
    expect(test.creates).toBe(1);
  });
  it('reuses the winner of a Mainnet create race and verifies its separate identity', async () => {
    const stores = { test: new MemorySecrets(), mainnet: new MemorySecrets() };
    await initializeProductWallet(stores.test);
    const winner = new MemorySecrets();
    const wallet = await initializeProductWallet(winner);
    stores.mainnet.create = async () => { stores.mainnet.value = winner.value; throw new Error('duplicate item'); };
    expect(await initializeEnvironmentWallet(mainnet, stores)).toEqual({ address: wallet.address, reused: true });
  });
});

import { randomBytes } from 'node:crypto';
import { createKeyPairSignerFromBytes, createKeyPairSignerFromPrivateKeyBytes, getBase58Decoder, getBase58Encoder } from '@solana/kit';
import { createAppWalletKeychain, readAppWalletKeychain } from '../payment/keychain';

export type WalletSecretStore = { read(): Promise<string | undefined>; create(secret: string): Promise<void> };
export const macOSWalletSecretStore: WalletSecretStore = { read: readAppWalletKeychain, create: createAppWalletKeychain };

async function signerFromSecret(secret: string) {
  const bytes = new Uint8Array(getBase58Encoder().encode(secret));
  try {
    if (bytes.length !== 64) throw new Error();
    return await createKeyPairSignerFromBytes(bytes);
  } catch {
    throw new Error('The 2049 Keychain wallet is invalid; it was not replaced');
  } finally {
    bytes.fill(0);
  }
}

export async function initializeProductWallet(store: WalletSecretStore = macOSWalletSecretStore) {
  const saved = await store.read();
  if (saved) return { address: (await signerFromSecret(saved)).address, reused: true };

  const seed = new Uint8Array(randomBytes(32));
  try {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
    const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', signer.keyPair.publicKey));
    const secretBytes = new Uint8Array([...seed, ...publicBytes]);
    try {
      const encoded = getBase58Decoder().decode(secretBytes);
      try { await store.create(encoded); }
      catch {
        // Another instance may have won the fixed-item create race. Reuse only a
        // signer that can actually be read back; never silently substitute one.
        const raced = await store.read();
        if (!raced) throw new Error('The 2049 wallet could not be saved to Keychain');
        return { address: (await signerFromSecret(raced)).address, reused: true };
      }
      const verified = await store.read();
      if (!verified) throw new Error('The 2049 wallet could not be verified in Keychain');
      const storedSigner = await signerFromSecret(verified);
      if (storedSigner.address !== signer.address) throw new Error('The saved 2049 wallet does not match the generated signer');
      return { address: signer.address, reused: false };
    } finally { secretBytes.fill(0); }
  } finally { seed.fill(0); }
}

export async function loadProductWalletSigner(expectedAddress: string, store: WalletSecretStore = macOSWalletSecretStore) {
  const secret = await store.read();
  if (!secret) throw new Error('The 2049 wallet is unavailable in Keychain');
  const signer = await signerFromSecret(secret);
  if (signer.address !== expectedAddress) throw new Error('The 2049 signer does not match the configured wallet');
  return signer;
}

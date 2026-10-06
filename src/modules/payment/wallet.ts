import { readFile } from "node:fs/promises";
import { createKeyPairSignerFromBytes, getBase58Encoder } from "@solana/kit";
import { readDemoKeychain } from "./keychain";
import { resolveYoshConfiguration } from '../app/yosh-configuration';
import { resolvePaymentEnvironment, validatePaymentEnvironment, type PaymentEnvironment } from './payment-environment';

export async function loadBuyerSigner(expectedAddress: string, env: Record<string, string | undefined> = process.env,
  environment: PaymentEnvironment = resolvePaymentEnvironment(env, 'live_devnet')) {
  // The immutable purchase environment and current configuration must still agree.
  const { mode, cluster, genesisHash, rpcUrl, network, asset, isProduction, productionExecutionEnabled } = environment;
  const selected = validatePaymentEnvironment({ mode, cluster, genesisHash, rpcUrl, network, asset, isProduction, productionExecutionEnabled });
  const assertCurrentEnvironment = () => {
    const current = resolvePaymentEnvironment(env, 'live_devnet');
    if (selected.mode !== current.mode || selected.cluster !== current.cluster || selected.genesisHash !== current.genesisHash
      || selected.rpcUrl !== current.rpcUrl || selected.network !== current.network || selected.asset.mint !== current.asset.mint || selected.productionExecutionEnabled !== current.productionExecutionEnabled) {
      throw new Error('WALLET_ENVIRONMENT_MISMATCH');
    }
  };
  assertCurrentEnvironment();
  if (selected.mode === 'live_mainnet') {
    // Reject configured legacy sources even when the product-wallet flag would hide them.
    const forbidden = ['DEMO_BUYER_PRIVATE_KEY', 'DEMO_BUYER_KEYPAIR', 'DEMO_BUYER_KEYCHAIN_SERVICE',
      'DEMO_BUYER_PUBLIC_KEY', 'DEMO_MERCHANT_PUBLIC_KEY'];
    if (forbidden.some(key => env[key] !== undefined)) throw new Error('MAINNET_WALLET_ISOLATION: Demo configuration is forbidden');
    if (!env.YOSH_MAINNET_WALLET_PUBLIC_KEY || env.YOSH_MAINNET_WALLET_PUBLIC_KEY !== expectedAddress) {
      throw new Error('MAINNET_WALLET_ISOLATION: explicit Mainnet wallet identity required');
    }
    const { loadEnvironmentWalletSigner } = await import('../app-wallet/product-wallet');
    const signer = await loadEnvironmentWalletSigner(expectedAddress, selected);
    assertCurrentEnvironment();
    return signer;
  }
  if (resolveYoshConfiguration(env).useProductWallet) {
    const { loadEnvironmentWalletSigner } = await import('../app-wallet/product-wallet');
    const signer = await loadEnvironmentWalletSigner(expectedAddress, selected);
    assertCurrentEnvironment();
    return signer;
  }
  // Only the runtime consumes the secret. Never log input or parser exceptions.
  let bytes: Uint8Array;
  try {
    const sources = [env.DEMO_BUYER_KEYCHAIN_SERVICE, env.DEMO_BUYER_KEYPAIR, env.DEMO_BUYER_PRIVATE_KEY].filter(Boolean);
    if (sources.length !== 1) throw new Error();
    const raw = env.DEMO_BUYER_KEYCHAIN_SERVICE
      ? await readDemoKeychain(env.DEMO_BUYER_KEYCHAIN_SERVICE, expectedAddress)
      : env.DEMO_BUYER_KEYPAIR
      ? await readFile(env.DEMO_BUYER_KEYPAIR, "utf8")
      : env.DEMO_BUYER_PRIVATE_KEY;
    if (!raw) throw new Error();
    if (raw.trim().startsWith("[")) {
      const values: unknown = JSON.parse(raw);
      if (!Array.isArray(values) || values.length !== 64 ||
          !values.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error();
      bytes = Uint8Array.from(values);
    } else {
      bytes = new Uint8Array(getBase58Encoder().encode(raw.trim()));
    }
    if (bytes.length !== 64) throw new Error();
  } catch {
    throw new Error("Configure a valid dedicated test buyer signer via DEMO_BUYER_KEYCHAIN_SERVICE, DEMO_BUYER_KEYPAIR or DEMO_BUYER_PRIVATE_KEY");
  }
  try {
    const signer = await createKeyPairSignerFromBytes(bytes);
    if (signer.address !== expectedAddress) throw new Error();
    assertCurrentEnvironment();
    return signer;
  } catch {
    throw new Error("Buyer signer does not match DEMO_BUYER_PUBLIC_KEY");
  } finally {
    bytes.fill(0);
  }
}

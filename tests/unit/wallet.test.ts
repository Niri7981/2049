import { randomBytes } from "node:crypto";
import { createKeyPairSignerFromPrivateKeyBytes, getBase58Decoder } from "@solana/kit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadBuyerSigner } from "../../src/modules/payment/wallet";

vi.mock("../../src/modules/payment/keychain", async importOriginal => ({
  ...await importOriginal<typeof import('../../src/modules/payment/keychain')>(),
  readDemoKeychain: vi.fn(), readAppWalletKeychain: vi.fn(), createAppWalletKeychain: vi.fn(),
  readMainnetWalletKeychain: vi.fn(), createMainnetWalletKeychain: vi.fn(),
}));
import { readDemoKeychain, readAppWalletKeychain, readMainnetWalletKeychain, createMainnetWalletKeychain } from "../../src/modules/payment/keychain";
import { resolvePaymentEnvironment } from '../../src/modules/payment/payment-environment';
import { loadPaymentConfig, TOKEN_PROGRAM } from '../../src/modules/payment/payment-config';

const SAFE_CONFIG_ERROR = "Configure a valid dedicated test buyer signer via DEMO_BUYER_KEYCHAIN_SERVICE, DEMO_BUYER_KEYPAIR or DEMO_BUYER_PRIVATE_KEY";
const SAFE_ADDRESS_ERROR = "Buyer signer does not match DEMO_BUYER_PUBLIC_KEY";
let publicAddress: string;
let secretBytes: Uint8Array;

beforeAll(async () => {
  const seed = new Uint8Array(randomBytes(32));
  const generated = await createKeyPairSignerFromPrivateKeyBytes(seed);
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", generated.keyPair.publicKey));
  publicAddress = generated.address;
  secretBytes = new Uint8Array([...seed, ...publicBytes]);
  seed.fill(0);
});

afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Payment dedicated buyer signer", () => {
  it("loads the configured Keychain signer and verifies its public address", async () => {
    vi.mocked(readDemoKeychain).mockResolvedValue(getBase58Decoder().decode(secretBytes));
    const signer = await loadBuyerSigner(publicAddress, { DEMO_BUYER_KEYCHAIN_SERVICE: "com.2049.day4.0123456789abcdef" });
    expect(signer.address).toBe(publicAddress);
    expect(readDemoKeychain).toHaveBeenCalledWith("com.2049.day4.0123456789abcdef", publicAddress);
  });

  it("rejects conflicting signer sources", async () => {
    await expect(loadBuyerSigner(publicAddress, { DEMO_BUYER_KEYCHAIN_SERVICE: "com.2049.day4.0123456789abcdef", DEMO_BUYER_PRIVATE_KEY: getBase58Decoder().decode(secretBytes) })).rejects.toThrow(SAFE_CONFIG_ERROR);
  });

  it("does not expose Keychain diagnostics", async () => {
    vi.mocked(readDemoKeychain).mockRejectedValue(new Error("secret-diagnostic"));
    await expect(loadBuyerSigner(publicAddress, { DEMO_BUYER_KEYCHAIN_SERVICE: "com.2049.day4.0123456789abcdef" })).rejects.toThrow(SAFE_CONFIG_ERROR);
  });

  it("loads an in-memory JSON keypair without logging or contacting a network", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const signer = await loadBuyerSigner(publicAddress, { NODE_ENV: "test", DEMO_BUYER_PRIVATE_KEY: JSON.stringify([...secretBytes]) });

    expect(signer.address).toBe(publicAddress);
    expect(signer.keyPair.privateKey.extractable).toBe(false);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads an in-memory base58 keypair with surrounding whitespace", async () => {
    const encoded = getBase58Decoder().decode(secretBytes);
    const signer = await loadBuyerSigner(publicAddress, { NODE_ENV: "test", DEMO_BUYER_PRIVATE_KEY: `  ${encoded}\n` });
    expect(signer.address).toBe(publicAddress);
  });

  it.each([
    undefined, "", "private-key-secret-INVALID-0", "[secret-json-not-valid]",
    "{}", "[]", JSON.stringify(Array(63).fill(1)), JSON.stringify(Array(65).fill(1)),
    JSON.stringify([...Array(63).fill(1), -1]), JSON.stringify([...Array(63).fill(1), 256]),
    JSON.stringify([...Array(63).fill(1), 1.5]), JSON.stringify([...Array(63).fill(1), "1"]),
  ])("rejects malformed secret input with a fixed safe error (%#)", async raw => {
    const error = await loadBuyerSigner(publicAddress, { NODE_ENV: "test", DEMO_BUYER_PRIVATE_KEY: raw }).catch(value => value);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(SAFE_CONFIG_ERROR);
    expect(error.cause).toBeUndefined();
    if (raw && raw.length > 10) expect(String(error)).not.toContain(raw);
  });

  it("rejects an invalid 64-byte keypair without returning SDK diagnostics or secret bytes", async () => {
    const invalid = JSON.stringify(Array(64).fill(0));
    const error = await loadBuyerSigner(publicAddress, { NODE_ENV: "test", DEMO_BUYER_PRIVATE_KEY: invalid }).catch(value => value);
    expect(error.message).toBe(SAFE_ADDRESS_ERROR);
    expect(error.cause).toBeUndefined();
    expect(String(error)).not.toContain(invalid);
  });

  it("rejects a valid keypair belonging to a different configured buyer", async () => {
    const encoded = getBase58Decoder().decode(secretBytes);
    const error = await loadBuyerSigner("11111111111111111111111111111111", { NODE_ENV: "test", DEMO_BUYER_PRIVATE_KEY: encoded }).catch(value => value);
    expect(error.message).toBe(SAFE_ADDRESS_ERROR);
    expect(error.cause).toBeUndefined();
    expect(String(error)).not.toContain(encoded);
    expect(String(error)).not.toContain(publicAddress);
  });
});

describe('Mainnet signer source isolation', () => {
  const mainnet = { YOSH_EXECUTION_MODE: 'live_mainnet' };
  it('preserves Devnet product-wallet loading with the immutable payment configuration', async () => {
    vi.mocked(readAppWalletKeychain).mockResolvedValue(getBase58Decoder().decode(secretBytes));
    const env = { YOSH_USE_PRODUCT_WALLET: '1', DEMO_BUYER_PUBLIC_KEY: publicAddress, DEMO_MERCHANT_PUBLIC_KEY: TOKEN_PROGRAM };
    const signer = await loadBuyerSigner(publicAddress, env, loadPaymentConfig(env));
    expect(signer.address).toBe(publicAddress);
    expect(readAppWalletKeychain).toHaveBeenCalledOnce();
    expect(readMainnetWalletKeychain).not.toHaveBeenCalled();
  });
  it.each(['DEMO_BUYER_PRIVATE_KEY', 'DEMO_BUYER_KEYPAIR', 'DEMO_BUYER_KEYCHAIN_SERVICE',
    'DEMO_BUYER_PUBLIC_KEY', 'DEMO_MERCHANT_PUBLIC_KEY'])('rejects %s before reading any signer', async key => {
    await expect(loadBuyerSigner(publicAddress, { ...mainnet, YOSH_USE_PRODUCT_WALLET: '1',
      YOSH_MAINNET_WALLET_PUBLIC_KEY: publicAddress, [key]: 'legacy-fixture' })).rejects.toThrow('MAINNET_WALLET_ISOLATION');
    expect(readDemoKeychain).not.toHaveBeenCalled();
    expect(readAppWalletKeychain).not.toHaveBeenCalled();
    expect(readMainnetWalletKeychain).not.toHaveBeenCalled();
  });
  it('rejects missing Keychain identity and mismatching optional Mainnet assertion', async () => {
    await expect(loadBuyerSigner(publicAddress, mainnet)).rejects.toThrow('unavailable in Keychain');
    expect(readMainnetWalletKeychain).toHaveBeenCalledOnce();
    vi.mocked(readMainnetWalletKeychain).mockClear();
    await expect(loadBuyerSigner(publicAddress, { ...mainnet,
      YOSH_MAINNET_WALLET_PUBLIC_KEY: '11111111111111111111111111111111' })).rejects.toThrow('Mainnet wallet identity assertion mismatch');
    expect(readMainnetWalletKeychain).not.toHaveBeenCalled();
  });
  it('loads only the dedicated Mainnet item and proves its signer address', async () => {
    vi.mocked(readAppWalletKeychain).mockResolvedValue(undefined);
    vi.mocked(readMainnetWalletKeychain).mockResolvedValue(getBase58Decoder().decode(secretBytes));
    const signer = await loadBuyerSigner(publicAddress, { ...mainnet, YOSH_MAINNET_WALLET_PUBLIC_KEY: publicAddress });
    expect(signer.address).toBe(publicAddress);
    expect(signer.keyPair.privateKey.extractable).toBe(false);
    expect(readMainnetWalletKeychain).toHaveBeenCalledOnce();
    expect(readDemoKeychain).not.toHaveBeenCalled();
    expect(createMainnetWalletKeychain).not.toHaveBeenCalled();
  });
  it('rejects a configured address that does not match the actual Mainnet signer', async () => {
    vi.mocked(readAppWalletKeychain).mockResolvedValue(undefined);
    vi.mocked(readMainnetWalletKeychain).mockResolvedValue(getBase58Decoder().decode(secretBytes));
    const other = '11111111111111111111111111111111';
    await expect(loadBuyerSigner(other, { ...mainnet, YOSH_MAINNET_WALLET_PUBLIC_KEY: other })).rejects.toThrow('does not match');
  });
  it('does not reuse a product signer when the purchase and active environments disagree', async () => {
    await expect(loadBuyerSigner(publicAddress, mainnet, resolvePaymentEnvironment({}, 'live_devnet'))).rejects.toThrow('WALLET_ENVIRONMENT_MISMATCH');
    expect(readAppWalletKeychain).not.toHaveBeenCalled();
    expect(readMainnetWalletKeychain).not.toHaveBeenCalled();
  });
  it('rechecks the environment after an asynchronous Keychain read', async () => {
    const env = { ...mainnet, YOSH_MAINNET_WALLET_PUBLIC_KEY: publicAddress };
    vi.mocked(readAppWalletKeychain).mockResolvedValue(undefined);
    vi.mocked(readMainnetWalletKeychain).mockImplementation(async () => {
      env.YOSH_EXECUTION_MODE = 'live_devnet';
      return getBase58Decoder().decode(secretBytes);
    });
    await expect(loadBuyerSigner(publicAddress, env)).rejects.toThrow('WALLET_ENVIRONMENT_MISMATCH');
  });
  it('fails closed on an inaccessible or missing Mainnet item without creating a replacement', async () => {
    vi.mocked(readAppWalletKeychain).mockResolvedValue(undefined);
    vi.mocked(readMainnetWalletKeychain).mockRejectedValue(new Error('Keychain unavailable'));
    const env = { ...mainnet, YOSH_MAINNET_WALLET_PUBLIC_KEY: publicAddress };
    await expect(loadBuyerSigner(publicAddress, env)).rejects.toThrow('Keychain unavailable');
    vi.mocked(readMainnetWalletKeychain).mockResolvedValue(undefined);
    await expect(loadBuyerSigner(publicAddress, env)).rejects.toThrow('unavailable in Keychain');
    expect(createMainnetWalletKeychain).not.toHaveBeenCalled();
  });
});

import { randomBytes } from "node:crypto";
import { createKeyPairSignerFromPrivateKeyBytes, getBase58Decoder } from "@solana/kit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadDay4Buyer } from "../../src/modules/payment/day4-wallet";

vi.mock("../../src/modules/payment/day4-keychain", () => ({ readDemoKeychain: vi.fn() }));
import { readDemoKeychain } from "../../src/modules/payment/day4-keychain";

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

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Day 4 dedicated buyer signer", () => {
  it("loads the configured Keychain signer and verifies its public address", async () => {
    vi.mocked(readDemoKeychain).mockResolvedValue(getBase58Decoder().decode(secretBytes));
    const signer = await loadDay4Buyer(publicAddress, { DEMO_BUYER_KEYCHAIN_SERVICE: "com.2049.day4.0123456789abcdef" });
    expect(signer.address).toBe(publicAddress);
    expect(readDemoKeychain).toHaveBeenCalledWith("com.2049.day4.0123456789abcdef", publicAddress);
  });

  it("rejects conflicting signer sources", async () => {
    await expect(loadDay4Buyer(publicAddress, { DEMO_BUYER_KEYCHAIN_SERVICE: "com.2049.day4.0123456789abcdef", DEMO_BUYER_PRIVATE_KEY: getBase58Decoder().decode(secretBytes) })).rejects.toThrow(SAFE_CONFIG_ERROR);
  });

  it("does not expose Keychain diagnostics", async () => {
    vi.mocked(readDemoKeychain).mockRejectedValue(new Error("secret-diagnostic"));
    await expect(loadDay4Buyer(publicAddress, { DEMO_BUYER_KEYCHAIN_SERVICE: "com.2049.day4.0123456789abcdef" })).rejects.toThrow(SAFE_CONFIG_ERROR);
  });

  it("loads an in-memory JSON keypair without logging or contacting a network", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const signer = await loadDay4Buyer(publicAddress, { NODE_ENV: "test", DEMO_BUYER_PRIVATE_KEY: JSON.stringify([...secretBytes]) });

    expect(signer.address).toBe(publicAddress);
    expect(signer.keyPair.privateKey.extractable).toBe(false);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads an in-memory base58 keypair with surrounding whitespace", async () => {
    const encoded = getBase58Decoder().decode(secretBytes);
    const signer = await loadDay4Buyer(publicAddress, { NODE_ENV: "test", DEMO_BUYER_PRIVATE_KEY: `  ${encoded}\n` });
    expect(signer.address).toBe(publicAddress);
  });

  it.each([
    undefined, "", "private-key-secret-INVALID-0", "[secret-json-not-valid]",
    "{}", "[]", JSON.stringify(Array(63).fill(1)), JSON.stringify(Array(65).fill(1)),
    JSON.stringify([...Array(63).fill(1), -1]), JSON.stringify([...Array(63).fill(1), 256]),
    JSON.stringify([...Array(63).fill(1), 1.5]), JSON.stringify([...Array(63).fill(1), "1"]),
  ])("rejects malformed secret input with a fixed safe error (%#)", async raw => {
    const error = await loadDay4Buyer(publicAddress, { NODE_ENV: "test", DEMO_BUYER_PRIVATE_KEY: raw }).catch(value => value);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(SAFE_CONFIG_ERROR);
    expect(error.cause).toBeUndefined();
    if (raw && raw.length > 10) expect(String(error)).not.toContain(raw);
  });

  it("rejects an invalid 64-byte keypair without returning SDK diagnostics or secret bytes", async () => {
    const invalid = JSON.stringify(Array(64).fill(0));
    const error = await loadDay4Buyer(publicAddress, { NODE_ENV: "test", DEMO_BUYER_PRIVATE_KEY: invalid }).catch(value => value);
    expect(error.message).toBe(SAFE_ADDRESS_ERROR);
    expect(error.cause).toBeUndefined();
    expect(String(error)).not.toContain(invalid);
  });

  it("rejects a valid keypair belonging to a different configured buyer", async () => {
    const encoded = getBase58Decoder().decode(secretBytes);
    const error = await loadDay4Buyer("11111111111111111111111111111111", { NODE_ENV: "test", DEMO_BUYER_PRIVATE_KEY: encoded }).catch(value => value);
    expect(error.message).toBe(SAFE_ADDRESS_ERROR);
    expect(error.cause).toBeUndefined();
    expect(String(error)).not.toContain(encoded);
    expect(String(error)).not.toContain(publicAddress);
  });
});

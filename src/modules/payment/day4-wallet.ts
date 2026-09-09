import { readFile } from "node:fs/promises";
import { createKeyPairSignerFromBytes, getBase58Encoder } from "@solana/kit";

export async function loadDay4Buyer(expectedAddress: string, env = process.env) {
  // Only the runtime consumes the secret. Never log input or parser exceptions.
  let bytes: Uint8Array;
  try {
    const raw = env.DEMO_BUYER_KEYPAIR
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
    throw new Error("Configure a valid dedicated test buyer signer via DEMO_BUYER_KEYPAIR or DEMO_BUYER_PRIVATE_KEY");
  }
  try {
    const signer = await createKeyPairSignerFromBytes(bytes);
    if (signer.address !== expectedAddress) throw new Error();
    return signer;
  } catch {
    throw new Error("Buyer signer does not match DEMO_BUYER_PUBLIC_KEY");
  } finally {
    bytes.fill(0);
  }
}

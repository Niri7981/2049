import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename, realpath } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createKeyPairSignerFromPrivateKeyBytes, getBase58Decoder } from "@solana/kit";
import { createDemoKeychain, readDemoKeychain } from "../src/modules/payment/keychain";
import { loadBuyerSigner } from "../src/modules/payment/wallet";
import { DEVNET_USDC_MINT } from "../src/modules/payment/payment-config";

type WalletRecord = { version: 1; cluster: "devnet"; address: string; keychainService: string; createdAt: string };
async function optionalRead(path: string) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
async function main() {
  if (process.platform !== "darwin") throw new Error("Wallet setup uses macOS Keychain");
  await mkdir(".data", { recursive: true, mode: 0o700 });
  const lock = new DatabaseSync(".data/day4-wallet-lock.sqlite");
  try {
    lock.exec("PRAGMA busy_timeout=1000; BEGIN EXCLUSIVE");
    const saved = await optionalRead(".data/day4-wallet.json");
    let wallet: WalletRecord;
    if (saved) {
      wallet = JSON.parse(saved);
      if (wallet.version !== 1 || wallet.cluster !== "devnet") throw new Error("Invalid existing wallet record; refusing to replace it");
      await readDemoKeychain(wallet.keychainService, wallet.address);
    } else {
      if (await optionalRead(".data/day4-client.json")) throw new Error("An existing payment journal must be reconciled before changing the buyer");
      const seed = new Uint8Array(randomBytes(32));
      try {
        const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
        const publicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", signer.keyPair.publicKey));
        const bytes = new Uint8Array([...seed, ...publicBytes]);
        const keychainService = `com.2049.day4.${createHash("sha256").update(await realpath(".")).digest("hex").slice(0, 16)}`;
        try { await createDemoKeychain(keychainService, signer.address, getBase58Decoder().decode(bytes)); }
        finally { bytes.fill(0); }
        wallet = { version: 1, cluster: "devnet", address: signer.address, keychainService, createdAt: new Date().toISOString() };
        await writeFile(".data/day4-wallet.json.tmp", JSON.stringify(wallet, null, 2), { mode: 0o600 });
        await rename(".data/day4-wallet.json.tmp", ".data/day4-wallet.json");
      } finally { seed.fill(0); }
    }
    const journal = await optionalRead(".data/day4-client.json");
    if (journal && JSON.parse(JSON.parse(journal).binding)[2] !== wallet.address) {
      throw new Error("Existing payment belongs to another buyer; refusing to change configuration");
    }
    // Actually reload and validate the public key before telling the user to fund it.
    await loadBuyerSigner(wallet.address, { DEMO_BUYER_KEYCHAIN_SERVICE: wallet.keychainService });
    let config = await optionalRead(".env.local") || "";
    const values: Record<string, string> = { SOLANA_CLUSTER: "devnet", DEMO_BUYER_PUBLIC_KEY: wallet.address,
      DEMO_BUYER_KEYCHAIN_SERVICE: wallet.keychainService, DEMO_BUYER_KEYPAIR: "", DEMO_BUYER_PRIVATE_KEY: "" };
    for (const [key, value] of Object.entries(values)) {
      const expression = new RegExp(`^${key}=.*$`, "gm");
      config = expression.test(config) ? config.replace(expression, `${key}=${value}`) : `${config.trimEnd()}\n${key}=${value}\n`;
    }
    await writeFile(".env.local.tmp", config, { mode: 0o600 });
    await rename(".env.local.tmp", ".env.local");
    console.log(JSON.stringify({ cluster: "devnet", buyer: wallet.address, signer: "macOS Keychain", reused: Boolean(saved),
      funding: { testSOL: "0.01", testUSDC: "1", mint: DEVNET_USDC_MINT },
      next: "Transfer test funds to this buyer, then run npm run wallet:accounts and npm run payment:preflight" }, null, 2));
  } finally { lock.close(); }
}
main().catch(() => {
  console.error("Demo wallet setup failed. No private key was printed. Check macOS Keychain access and existing .data wallet/payment records before retrying.");
  process.exitCode = 1;
});

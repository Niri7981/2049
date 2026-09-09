import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PaymentPayload, SettleResponse } from "@x402/core/types";
import { loadDay4Config } from "../src/modules/payment/day4-config";
import { runDay4Preflight } from "../src/modules/payment/day4-preflight";
import { loadDay4Buyer } from "../src/modules/payment/day4-wallet";
import { MARKET_RESOURCE, selectDay4Quote, prepareDay4Payment, confirmDay4Transaction } from "../src/modules/payment/day4-payment";
import { MarketSnapshotOutputSchema } from "../src/modules/resources/resource-schema";

type Journal = { status: "PREPARED" | "UNKNOWN" | "CONFIRMED"; binding: string; payload: PaymentPayload; transaction?: string };
let processLock: DatabaseSync | undefined;
async function main() {
  const config = loadDay4Config();
  const apiOrigin = new URL(process.env.DAY4_API_ORIGIN || "http://127.0.0.1:3000");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(apiOrigin.hostname) || apiOrigin.protocol !== "http:") {
    throw new Error("Day 4 CLI only calls the local API over HTTP");
  }
  const endpoint = new URL(MARKET_RESOURCE, apiOrigin);
  const binding = JSON.stringify([config.network, config.mint, config.buyer, config.merchant, endpoint.href]);
  const journalPath = resolve(".data/day4-client.json");
  await mkdir(resolve(".data"), { recursive: true, mode: 0o700 });
  // An OS-backed SQLite lock serializes CLI invocations and releases on crash.
  processLock = new DatabaseSync(resolve(".data/day4-client-lock.sqlite"));
  processLock.exec("PRAGMA busy_timeout=1000; BEGIN EXCLUSIVE");
  const save = async (journal: Journal) => {
    await writeFile(`${journalPath}.tmp`, JSON.stringify(journal, null, 2), { mode: 0o600 });
    await rename(`${journalPath}.tmp`, journalPath);
  };
  let journal: Journal | undefined;
  try { journal = JSON.parse(await readFile(journalPath, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot read saved payment; do not start a new payment"); }
  if (journal && journal.binding !== binding) throw new Error("Saved payment belongs to a different configuration; reconcile it first");
  if (journal?.status === "CONFIRMED" && !process.argv.includes("--new-payment")) {
    console.log(JSON.stringify({ status: "CONFIRMED", transaction: journal.transaction, message: "Already paid. Use --new-payment only to explicitly buy another call." }, null, 2));
    return;
  }
  if (!journal || journal.status === "CONFIRMED") {
    const preflight = await runDay4Preflight(config);
    const unpaid = await fetch(endpoint, { signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (unpaid.status !== 402) throw new Error(`Expected 402, received ${unpaid.status}`);
    const header = unpaid.headers.get("PAYMENT-REQUIRED");
    if (!header) throw new Error("Missing PAYMENT-REQUIRED");
    const requirement = selectDay4Quote(header, config, preflight.facilitator.feePayer);
    console.log(JSON.stringify({ cluster: config.cluster, buyer: config.buyer, merchant: config.merchant,
      token: "test USDC", amount: "0.01", mint: config.mint, feePayer: preflight.facilitator.feePayer }, null, 2));
    const signer = await loadDay4Buyer(config.buyer);
    const payload = await prepareDay4Payment(config, signer, requirement, () => console.log("Simulation passed; signing the fixed test payment."));
    journal = { status: "PREPARED", binding, payload };
    await save(journal);
  }
  // A crash or timeout always resumes this exact payload. Never re-sign automatically.
  journal.status = "UNKNOWN";
  await save(journal);
  const response = await fetch(endpoint, {
    headers: { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(journal.payload)).toString("base64") },
    signal: AbortSignal.timeout(55_000), redirect: "error",
  });
  const receiptHeader = response.headers.get("PAYMENT-RESPONSE");
  if (receiptHeader) {
    const receipt = JSON.parse(Buffer.from(receiptHeader, "base64").toString("utf8")) as SettleResponse;
    if (receipt.transaction) { journal.transaction = receipt.transaction; await save(journal); }
    if (response.status === 200 && receipt.success && receipt.network === config.network && receipt.payer === config.buyer && receipt.transaction) {
      const data = MarketSnapshotOutputSchema.parse(await response.json());
      await confirmDay4Transaction(config, receipt.transaction);
      journal.status = "CONFIRMED";
      await save(journal);
      console.log(JSON.stringify({ status: "CONFIRMED", cluster: config.cluster, transaction: receipt.transaction,
        explorer: config.cluster === "devnet" ? `https://explorer.solana.com/tx/${receipt.transaction}?cluster=devnet` : undefined,
        data }, null, 2));
      return;
    }
  }
  throw new Error(`Payment outcome requires reconciliation (HTTP ${response.status}). Saved payload retained; no new payment will be created.`);
}
main().catch(() => {
  console.error("Day 4 payment did not complete. Check configuration/preflight and the saved .data/day4-client.json state. Never delete an UNKNOWN payment to retry.");
  process.exitCode = 1;
}).finally(() => processLock?.close());

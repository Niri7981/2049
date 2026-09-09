import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile, mkdtemp, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { createKeyPairSignerFromBytes, createSolanaRpc, devnet } from "@solana/kit";
import { toFacilitatorSvmSigner } from "@x402/svm";
import { ExactSvmScheme } from "@x402/svm/exact/facilitator";
import { x402Facilitator } from "@x402/core/facilitator";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { loadDay4Config, PAYMENT_AMOUNT } from "../src/modules/payment/day4-config";
import { runDay4Preflight } from "../src/modules/payment/day4-preflight";
import { createPaidMarketApi } from "../src/modules/paid-market-api/paid-market-api";
import { SettlementStore } from "../src/modules/paid-market-api/settlement-store";
import { MARKET_RESOURCE, confirmDay4Transaction, prepareDay4Payment, selectDay4Quote } from "../src/modules/payment/day4-payment";

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function main() {
  const rpcUrl = process.env.SOLANA_LOCALNET_RPC_URL || "http://127.0.0.1:8899";
  const url = new URL(rpcUrl);
  assert(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Smoke test requires loopback RPC");
  // Legacy web3 is isolated to fixture creation; application payment code uses Kit.
  const connection = new Connection(rpcUrl, "confirmed");
  const genesis = await connection.getGenesisHash();
  assert(!["EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"].includes(genesis), "Refusing a public network");
  const network = `solana:${genesis.slice(0, 32)}` as const;
  const buyer = Keypair.generate();
  const merchant = Keypair.generate();
  const sponsor = Keypair.generate();
  const mintAuthority = Keypair.generate();
  const airdrop = await connection.requestAirdrop(sponsor.publicKey, 2 * LAMPORTS_PER_SOL);
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await connection.getBalance(sponsor.publicKey) > 0) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  console.log("Localnet: temporary wallets funded; creating test USDC accounts.");
  const mint = await createMint(connection, sponsor, mintAuthority.publicKey, null, 6);
  const buyerAta = await getOrCreateAssociatedTokenAccount(connection, sponsor, mint, buyer.publicKey);
  const merchantAta = await getOrCreateAssociatedTokenAccount(connection, sponsor, mint, merchant.publicKey);
  await mintTo(connection, sponsor, mint, buyerAta.address, mintAuthority, 1_000_000n);
  const signer = await createKeyPairSignerFromBytes(buyer.secretKey);
  const sponsorSigner = await createKeyPairSignerFromBytes(sponsor.secretKey);
  const facilitator = new x402Facilitator().register(network,
    new ExactSvmScheme(toFacilitatorSvmSigner(sponsorSigner, { [network]: createSolanaRpc(devnet(rpcUrl)) })));
  let settlements = 0;
  const facilitatorHttp = createServer(async (request, response) => {
    try {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url === "/supported") {
        response.end(JSON.stringify(facilitator.getSupported())); return;
      }
      if (request.method !== "POST" || !["/verify", "/settle"].includes(request.url || "")) {
        response.writeHead(404).end(); return;
      }
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (request.url === "/settle") settlements++;
      const result = request.url === "/verify"
        ? await facilitator.verify(body.paymentPayload, body.paymentRequirements)
        : await facilitator.settle(body.paymentPayload, body.paymentRequirements);
      if (("isValid" in result && !result.isValid) || ("success" in result && !result.success)) {
        console.log("Local test facilitator rejected:", JSON.stringify(result));
      }
      response.end(JSON.stringify(result));
    } catch { response.writeHead(500).end(JSON.stringify({ error: "Local test facilitator failed" })); }
  });
  const facilitatorUrl = await listen(facilitatorHttp);
  const config = loadDay4Config({ SOLANA_CLUSTER: "localnet", SOLANA_LOCALNET_RPC_URL: rpcUrl,
    SOLANA_LOCALNET_NETWORK: network, LOCAL_USDC_MINT: mint.toBase58(),
    DEMO_BUYER_PUBLIC_KEY: buyer.publicKey.toBase58(), DEMO_MERCHANT_PUBLIC_KEY: merchant.publicKey.toBase58(),
    X402_FACILITATOR_URL: facilitatorUrl });
  const directory = await mkdtemp(join(tmpdir(), "2049-day4-smoke-"));
  const dbPath = join(directory, "payments.sqlite");
  let store = new SettlementStore(dbPath);
  let api = createPaidMarketApi(config, new HTTPFacilitatorClient({ url: facilitatorUrl }), store);
  const apiHttp = createServer(async (request, response) => {
    try {
      if (request.url !== MARKET_RESOURCE) { response.writeHead(404).end(); return; }
      const result = await api({ asset: "SOL" }, request.headers["payment-signature"] as string | undefined);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch { response.writeHead(500).end(); }
  });
  try {
    const origin = await listen(apiHttp);
    const endpoint = `${origin}${MARKET_RESOURCE}`;
    const preflight = await runDay4Preflight(config);
    assert.equal(await connection.getBalance(buyer.publicKey), 0, "Sponsor should pay all fees");
    const unpaid = await fetch(endpoint);
    assert.equal(unpaid.status, 402);
    const requirement = selectDay4Quote(unpaid.headers.get("PAYMENT-REQUIRED")!, config, preflight.facilitator.feePayer);
    console.log(JSON.stringify({ cluster: "localnet", amount: "0.01 test USDC", buyer: config.buyer,
      merchant: config.merchant, mint: config.mint, feePayer: sponsorSigner.address }, null, 2));
    const payload = await prepareDay4Payment(config, signer, requirement, () => console.log("Simulation passed before signing."));
    const headers = { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payload)).toString("base64") };
    const malformed = await fetch(endpoint, { headers: { "PAYMENT-SIGNATURE": "demo-signature" } });
    assert.equal(malformed.status, 402);
    const paid = await fetch(endpoint, { headers });
    if (paid.status !== 200) {
      const rejection = paid.headers.get("PAYMENT-REQUIRED");
      throw new Error(`Paid retry returned ${paid.status}: ${rejection ? JSON.parse(Buffer.from(rejection, "base64").toString()).error : await paid.text()}`);
    }
    const body = await paid.json();
    assert.equal(paid.status, 200, JSON.stringify(body));
    const receipt = JSON.parse(Buffer.from(paid.headers.get("PAYMENT-RESPONSE")!, "base64").toString());
    assert.equal(receipt.success, true);
    assert.equal(body.is_demo_snapshot, true);
    await confirmDay4Transaction(config, receipt.transaction);
    const afterBuyer = await getAccount(connection, buyerAta.address);
    const afterMerchant = await getAccount(connection, merchantAta.address);
    assert.equal(afterBuyer.amount, 1_000_000n - BigInt(PAYMENT_AMOUNT));
    assert.equal(afterMerchant.amount, BigInt(PAYMENT_AMOUNT));
    const duplicates = await Promise.all([fetch(endpoint, { headers }), fetch(endpoint, { headers })]);
    for (const duplicate of duplicates) assert.equal(duplicate.status, 200);
    store.close();
    store = new SettlementStore(dbPath);
    api = createPaidMarketApi(config, new HTTPFacilitatorClient({ url: facilitatorUrl }), store);
    assert.equal((await fetch(endpoint, { headers })).status, 200);
    assert.equal(settlements, 1, "Replay must not settle again, even across restart");
    assert.equal((await getAccount(connection, merchantAta.address)).amount, BigInt(PAYMENT_AMOUNT));
    const cliEnv = { ...process.env, SOLANA_CLUSTER: "localnet", SOLANA_LOCALNET_RPC_URL: rpcUrl,
      SOLANA_LOCALNET_NETWORK: network, LOCAL_USDC_MINT: config.mint, DEMO_BUYER_PUBLIC_KEY: config.buyer,
      DEMO_MERCHANT_PUBLIC_KEY: config.merchant, X402_FACILITATOR_URL: facilitatorUrl,
      DAY4_API_ORIGIN: origin, DEMO_BUYER_KEYPAIR: "", DEMO_BUYER_PRIVATE_KEY: JSON.stringify([...buyer.secretKey]) };
    const cliArgs = ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("scripts/day4-pay.ts")];
    const firstCli = await promisify(execFile)(process.execPath, cliArgs, { cwd: directory, env: cliEnv, timeout: 60_000 });
    assert(firstCli.stdout.includes('"status": "CONFIRMED"'), "Real CLI must confirm its payment");
    const saved = JSON.parse(await readFile(join(directory, ".data/day4-client.json"), "utf8"));
    assert.equal(saved.status, "CONFIRMED");
    const repeatCli = await promisify(execFile)(process.execPath, cliArgs, { cwd: directory, env: cliEnv, timeout: 10_000 });
    assert(repeatCli.stdout.includes("Already paid"));
    assert.equal(settlements, 2, "CLI rerun must not create a third payment");
    assert.equal((await getAccount(connection, merchantAta.address)).amount, 2n * BigInt(PAYMENT_AMOUNT));
    const report = { status: "PASS", cluster: "localnet", network, checkedAt: new Date().toISOString(),
      transaction: receipt.transaction, mint: config.mint, buyer: config.buyer, merchant: config.merchant,
      feePayer: sponsorSigner.address, buyerBeforeBaseUnits: "1000000", buyerAfterBaseUnits: afterBuyer.amount.toString(),
      merchantBeforeBaseUnits: "0", merchantAfterBaseUnits: afterMerchant.amount.toString(), firstPaymentSettlementCalls: 1,
      cliTransaction: saved.transaction, totalSettlementCalls: settlements,
      checks: ["HTTP 402", "preflight", "unsigned simulation", "signed x402 payment", "facilitator verify/settle", "confirmed transaction",
        "HTTP 200 + fixture", "exact balance delta", "invalid proof rejected", "parallel replay", "replay after database reopen",
        "real CLI payment", "CLI rerun does not repay"],
      devnetAcceptance: "NOT_RUN: requires dedicated funded Devnet buyer" };
    await mkdir(".data", { recursive: true });
    await writeFile(".data/day4-localnet-result.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    apiHttp.closeAllConnections(); facilitatorHttp.closeAllConnections();
    apiHttp.close(); facilitatorHttp.close(); store.close();
    buyer.secretKey.fill(0); sponsor.secretKey.fill(0); mintAuthority.secretKey.fill(0);
    void airdrop;
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Localnet test failed"); process.exitCode = 1; });

import { reconcileOriginalTransaction } from '../../src/modules/payment/reconcile-transaction';
vi.mock('../../src/modules/payment/reconcile-transaction', () => ({ reconcileOriginalTransaction: vi.fn() }));
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequired, SettleResponse } from "@x402/core/types";
import {
  createPaidMarketApi, paidMarketSnapshotResponse, MARKET_RESOURCE_URL, PAYMENT_REQUIRED_HEADER, PAYMENT_RESPONSE_HEADER,
} from "../../src/modules/paid-market-api/paid-market-api";
import { SettlementStore } from "../../src/modules/paid-market-api/settlement-store";
import type { Day4Config } from "../../src/modules/payment/day4-config";

const buyer = Keypair.generate();
const merchant = Keypair.generate();
const feePayer = Keypair.generate();
const config: Day4Config = {
  cluster: "devnet", rpcUrl: "https://api.devnet.solana.com",
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  buyer: buyer.publicKey.toBase58(), merchant: merchant.publicKey.toBase58(),
  facilitatorUrl: "https://facilitator.invalid",
};
const receipt: SettleResponse = {
  success: true, transaction: "confirmed-test-signature", payer: config.buyer, network: config.network,
};
const stores: SettlementStore[] = [];
const directories: string[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function mockFacilitator() {
  return {
    getSupported: vi.fn(async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: config.network, extra: { feePayer: feePayer.publicKey.toBase58() } }],
      extensions: [], signers: {},
    })),
    verify: vi.fn(async () => ({ isValid: true, payer: config.buyer })),
    settle: vi.fn(async () => receipt),
  } satisfies FacilitatorClient;
}

function setup(path = ":memory:", facilitator = mockFacilitator()) {
  const store = new SettlementStore(path);
  stores.push(store);
  return { handler: createPaidMarketApi(config, facilitator, store), store, facilitator };
}

function encode(value: unknown) { return Buffer.from(JSON.stringify(value)).toString("base64"); }

async function paymentFor(handler: ReturnType<typeof createPaidMarketApi>) {
  const response = await handler({ asset: "SOL" });
  expect(response.status).toBe(402);
  const quote = JSON.parse(Buffer.from(response.headers.get(PAYMENT_REQUIRED_HEADER)!, "base64").toString()) as PaymentRequired;
  const tx = new VersionedTransaction(new TransactionMessage({
    payerKey: new PublicKey(config.buyer), recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [],
  }).compileToV0Message());
  tx.sign([buyer]);
  const payload: PaymentPayload = {
    x402Version: 2, resource: quote.resource, accepted: quote.accepts[0],
    payload: { transaction: Buffer.from(tx.serialize()).toString("base64") },
  };
  return { quote, payload, header: encode(payload) };
}

describe("x402 paid market API", () => {
  it("returns 503 with no quote when runtime wallet configuration is missing", async () => {
    vi.stubEnv("DEMO_BUYER_PUBLIC_KEY", "");
    const response = await paidMarketSnapshotResponse({ asset: "SOL" });
    expect(response.status).toBe(503);
    expect(response.headers.get(PAYMENT_REQUIRED_HEADER)).toBeNull();
  });

  it("returns V2 accepts with a unique, persisted resource-bound memo and no market data", async () => {
    const { handler, store } = setup();
    const first = await paymentFor(handler);
    const second = await paymentFor(handler);
    expect(first.quote.x402Version).toBe(2);
    expect(first.quote.resource.url).toBe(MARKET_RESOURCE_URL);
    expect(first.quote.accepts[0]).toMatchObject({ scheme: "exact", amount: "10000", payTo: config.merchant, asset: config.mint });
    expect(first.quote.accepts[0].extra.memo).not.toBe(second.quote.accepts[0].extra.memo);
    expect(store.getQuote(String(first.quote.accepts[0].extra.memo))?.resource).toBe(MARKET_RESOURCE_URL);
    expect(await (await handler({ asset: "SOL" })).text()).toBe("");
  });

  it("verifies and settles before returning data and PAYMENT-RESPONSE", async () => {
    const { handler, facilitator } = setup();
    const { header, payload } = await paymentFor(handler);
    const response = await handler({ asset: "SOL" }, header);
    expect(response.status).toBe(200);
    expect((await response.json()).is_demo_snapshot).toBe(true);
    expect(JSON.parse(Buffer.from(response.headers.get(PAYMENT_RESPONSE_HEADER)!, "base64").toString())).toEqual(receipt);
    expect(facilitator.verify).toHaveBeenCalledWith(payload, payload.accepted);
    expect(facilitator.settle).toHaveBeenCalledOnce();
    expect(facilitator.verify.mock.invocationCallOrder[0]).toBeLessThan(facilitator.settle.mock.invocationCallOrder[0]);
  });

  it("rejects the old unsigned demo marker and malformed transactions", async () => {
    const { handler, facilitator } = setup();
    const { payload } = await paymentFor(handler);
    expect((await handler({ asset: "SOL" }, encode({ ...payload.accepted, signature: "demo-signature" }))).status).toBe(402);
    expect((await handler({ asset: "SOL" }, encode({ ...payload, payload: { transaction: "fake" } }))).status).toBe(402);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it.each(["network", "asset", "amount", "payTo", "maxTimeoutSeconds", "memo", "feePayer", "resource"])("rejects altered quote field %s before verification", async (field) => {
    const { handler, facilitator } = setup();
    const { payload } = await paymentFor(handler);
    const changed = structuredClone(payload);
    if (field === "resource") changed.resource = { url: "/different-resource" };
    else if (field === "memo" || field === "feePayer") changed.accepted.extra[field] = "changed";
    else if (field === "maxTimeoutSeconds") changed.accepted.maxTimeoutSeconds = 9999;
    else Object.assign(changed.accepted, { [field]: field === "network" ? "solana:wrong" : "changed" });
    expect((await handler({ asset: "SOL" }, encode(changed))).status).toBe(402);
    expect(facilitator.verify).not.toHaveBeenCalled();
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it("does not settle when verification fails or identifies a different buyer", async () => {
    const { handler, facilitator } = setup();
    const { header } = await paymentFor(handler);
    facilitator.verify.mockResolvedValueOnce({ isValid: false, payer: config.buyer });
    expect((await handler({ asset: "SOL" }, header)).status).toBe(402);
    facilitator.verify.mockResolvedValueOnce({ isValid: true, payer: config.merchant });
    expect((await handler({ asset: "SOL" }, header)).status).toBe(402);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it("replays confirmed data without paying twice, including after reopening SQLite", async () => {
    const directory = mkdtempSync(join(tmpdir(), "day4-store-"));
    directories.push(directory);
    const path = join(directory, "payments.sqlite");
    const first = setup(path);
    const { header } = await paymentFor(first.handler);
    const paid = await first.handler({ asset: "SOL" }, header);
    expect(paid.status).toBe(200);
    const body = await paid.text();
    expect((await first.handler({ asset: "SOL" }, header)).status).toBe(200);
    const second = setup(path);
    const replayed = await second.handler({ asset: "SOL" }, header);
    expect(replayed.status).toBe(200);
    expect(await replayed.text()).toBe(body);
    expect(first.facilitator.settle).toHaveBeenCalledOnce();
    expect(second.facilitator.settle).not.toHaveBeenCalled();
    expect(second.facilitator.getSupported).not.toHaveBeenCalled();
  });

  it("settles once under concurrent retries", async () => {
    const { handler, facilitator } = setup();
    const { header } = await paymentFor(handler);
    let release!: (value: SettleResponse) => void;
    facilitator.settle.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = handler({ asset: "SOL" }, header);
    await vi.waitFor(() => expect(facilitator.settle).toHaveBeenCalledOnce());
    expect((await handler({ asset: "SOL" }, header)).status).toBe(202);
    release(receipt);
    expect((await first).status).toBe(200);
    expect(facilitator.settle).toHaveBeenCalledOnce();
  });

  it("rejects a previously paid transaction when relabeled with a new quote", async () => {
    const { handler, facilitator } = setup();
    const first = await paymentFor(handler);
    expect((await handler({ asset: "SOL" }, first.header)).status).toBe(200);
    const second = await paymentFor(handler);
    second.payload.payload = first.payload.payload;
    expect((await handler({ asset: "SOL" }, encode(second.payload))).status).toBe(409);
    expect(facilitator.settle).toHaveBeenCalledOnce();
  });

  it("does not release cached data for replaced signatures or settle a new transaction on the same quote", async () => {
    const { handler, facilitator } = setup();
    const { header, payload } = await paymentFor(handler);
    expect((await handler({ asset: "SOL" }, header)).status).toBe(200);
    const decoded = VersionedTransaction.deserialize(Buffer.from(String(payload.payload.transaction), "base64"));
    decoded.signatures[0].fill(0);
    const changed = { ...payload, payload: { transaction: Buffer.from(decoded.serialize()).toString("base64") } };
    expect((await handler({ asset: "SOL" }, encode(changed))).status).toBe(409);
    decoded.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
    decoded.sign([buyer]);
    changed.payload.transaction = Buffer.from(decoded.serialize()).toString("base64");
    expect((await handler({ asset: "SOL" }, encode(changed))).status).toBe(409);
    expect(facilitator.settle).toHaveBeenCalledOnce();
  });

  it("keeps timeout outcomes UNKNOWN across restarts and never resubmits settlement", async () => {
    const directory = mkdtempSync(join(tmpdir(), "day4-unknown-"));
    directories.push(directory);
    const path = join(directory, "payments.sqlite");
    const first = setup(path);
    first.facilitator.settle.mockRejectedValueOnce(new Error("timeout after possible broadcast"));
    const { header } = await paymentFor(first.handler);
    const pending = await first.handler({ asset: "SOL" }, header);
    expect(pending.status).toBe(202);
    expect(pending.headers.get(PAYMENT_RESPONSE_HEADER)).toBeNull();
    const second = setup(path);
    expect((await second.handler({ asset: "SOL" }, header)).status).toBe(202);
    expect(second.facilitator.settle).not.toHaveBeenCalled();
  });

  it("does not return data or a success header after rejected settlement", async () => {
    const { handler, facilitator } = setup();
    facilitator.settle.mockResolvedValueOnce({ ...receipt, success: false, transaction: "", errorReason: "insufficient_funds" });
    const { header } = await paymentFor(handler);
    const response = await handler({ asset: "SOL" }, header);
    expect(response.status).toBe(402);
    expect(response.headers.get(PAYMENT_RESPONSE_HEADER)).toBeNull();
    expect((await handler({ asset: "SOL" }, header)).status).toBe(402);
    expect(facilitator.settle).toHaveBeenCalledOnce();
  });

  it("preserves a pending transaction ID without labeling it failed or resettling", async () => {
    const { handler, facilitator } = setup();
    const pendingReceipt = { ...receipt, success: false, errorReason: "settlement_pending" };
    facilitator.settle.mockResolvedValue(pendingReceipt);
    const { header } = await paymentFor(handler);
    for (let i = 0; i < 2; i++) {
      const response = await handler({ asset: "SOL" }, header);
      expect(response.status).toBe(202);
      expect(JSON.parse(Buffer.from(response.headers.get(PAYMENT_RESPONSE_HEADER)!, "base64").toString())).toEqual(pendingReceipt);
    }
    // SDK reconciles the same pending payload once internally; API replay adds no calls.
    expect(facilitator.settle).toHaveBeenCalledTimes(2);
  });

  it("rejects expired unpaid quotes and unsupported assets", async () => {
    const { handler, facilitator } = setup();
    const { header } = await paymentFor(handler);
    const currentTime = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(currentTime + 301_000);
    expect((await handler({ asset: "SOL" }, header)).status).toBe(402);
    expect((await handler({ asset: "BTC" })).status).toBe(400);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it("fails closed if facilitator discovery is unavailable", async () => {
    const { handler, facilitator } = setup();
    facilitator.getSupported.mockRejectedValue(new Error("unavailable"));
    const response = await handler({ asset: "SOL" });
    expect(response.status).toBe(503);
    expect(response.headers.get(PAYMENT_REQUIRED_HEADER)).toBeNull();
  });
});

it('recovery never initiates an unclaimed payment', async () => {
  const { handler, facilitator } = setup(); const { header } = await paymentFor(handler);
  expect((await handler({ asset: 'SOL' }, header, true)).status).toBe(202);
  expect(facilitator.verify).not.toHaveBeenCalled();
  expect(facilitator.settle).not.toHaveBeenCalled();
});
it('recovers a lost settlement receipt through chain proof after server restart without settling again', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'day6-recovery-')); directories.push(directory);
  const path = join(directory, 'payments.sqlite'); const first = setup(path);
  first.facilitator.settle.mockRejectedValueOnce(new Error('lost receipt'));
  const { header, payload } = await paymentFor(first.handler);
  expect((await first.handler({ asset: 'SOL' }, header)).status).toBe(202);
  const second = setup(path);
  vi.mocked(reconcileOriginalTransaction).mockResolvedValueOnce({ status: 'UNKNOWN' });
  expect((await second.handler({ asset: 'SOL' }, header, true)).status).toBe(202);
  vi.mocked(reconcileOriginalTransaction).mockResolvedValueOnce({ status: 'CONFIRMED', transaction: 'recovered-signature' });
  const response = await second.handler({ asset: 'SOL' }, header, true);
  expect(response.status).toBe(200);
  expect((await response.json()).is_demo_snapshot).toBe(true);
  expect(reconcileOriginalTransaction).toHaveBeenLastCalledWith(config, expect.any(String), payload.accepted.extra?.memo, undefined);
  expect(first.facilitator.settle).toHaveBeenCalledOnce();
  expect(second.facilitator.settle).not.toHaveBeenCalled();
  expect(second.facilitator.getSupported).not.toHaveBeenCalled();
});
it('chain-proven failure returns failure evidence and never data', async () => {
  const { handler, facilitator } = setup(); facilitator.settle.mockRejectedValueOnce(new Error('lost receipt'));
  const { header } = await paymentFor(handler); await handler({ asset: 'SOL' }, header);
  vi.mocked(reconcileOriginalTransaction).mockResolvedValueOnce({ status: 'FAILED', transaction: 'failed-signature' });
  const response = await handler({ asset: 'SOL' }, header, true);
  expect(response.status).toBe(402);
  expect(JSON.parse(Buffer.from(response.headers.get(PAYMENT_RESPONSE_HEADER)!, 'base64').toString())).toMatchObject({ success: false, transaction: 'failed-signature' });
  expect((await response.json()).is_demo_snapshot).toBeUndefined();
  expect(facilitator.settle).toHaveBeenCalledOnce();
});
it('replaced signatures cannot trigger chain reconciliation or receive cached data', async () => {
  const { handler, facilitator } = setup(); facilitator.settle.mockRejectedValueOnce(new Error('lost receipt'));
  const { header, payload } = await paymentFor(handler); await handler({ asset: 'SOL' }, header);
  const tx = VersionedTransaction.deserialize(Buffer.from(String(payload.payload.transaction), 'base64'));
  tx.signatures[0].fill(0); payload.payload.transaction = Buffer.from(tx.serialize()).toString('base64');
  vi.mocked(reconcileOriginalTransaction).mockClear();
  expect((await handler({ asset: 'SOL' }, encode(payload), true)).status).toBe(409);
  expect(reconcileOriginalTransaction).not.toHaveBeenCalled();
});

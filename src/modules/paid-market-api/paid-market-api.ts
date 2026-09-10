import { reconcileOriginalTransaction } from '../payment/reconcile-transaction';
import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { VersionedTransaction } from "@solana/web3.js";
import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import { PaymentPayloadV2Schema } from "@x402/core/schemas";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { loadDay4Config, type Day4Config } from "../payment/day4-config";
import { MarketSnapshotInputSchema, MarketSnapshotOutputSchema } from "../resources/resource-schema";
import { SettlementStore, type StoredSettlement } from "./settlement-store";

export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
export const PAYMENT_RECOVERY_HEADER = "PAYMENT-RECOVERY";
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";
export const MARKET_RESOURCE_URL = "/api/paid/market-snapshot?asset=SOL";
export const PAYMENT_AMOUNT = "10000";

const snapshotBody = JSON.stringify(MarketSnapshotOutputSchema.parse({
  asset: "SOL", as_of: "2026-09-05T08:00:00.000Z", spot_price_usd: 140,
  change_24h_pct: 2.4, volume_24h_usd: 3_000_000_000, market_cap_usd: 75_000_000_000,
  volatility_7d_pct: 5.8, rsi_14d: 57, support_levels_usd: [132, 136],
  resistance_levels_usd: [145, 151], source_label: "Demo snapshot fixture",
  is_demo_snapshot: true,
}));

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return Response.json({ error, ...extra }, { status, headers: { "cache-control": "no-store" } });
}

function paidResponse(body: string, receipt: SettleResponse) {
  return new Response(body, { status: 200, headers: {
    "content-type": "application/json", "cache-control": "private, no-store",
    [PAYMENT_RESPONSE_HEADER]: encode(receipt),
  } });
}

function previousResponse(previous: StoredSettlement, payloadHash: string): Response {
  // Message hashes ignore signatures for duplicate-settlement protection. A cached
  // response still requires the identical previously verified signed transaction.
  if (previous.payloadHash !== payloadHash) return jsonError(409, "Payment transaction already claimed");
  if (previous.status === "CONFIRMED" && previous.receipt && previous.body) {
    return paidResponse(previous.body, previous.receipt);
  }
  if (previous.status === "FAILED") {
    const response = jsonError(402, "Settlement failed; this payment cannot be resubmitted");
    if (previous.receipt?.transaction) response.headers.set(PAYMENT_RESPONSE_HEADER, encode(previous.receipt));
    return response;
  }
  const response = jsonError(202, "Settlement outcome unknown; do not create another payment", { paymentId: previous.messageHash });
  if (previous.receipt) response.headers.set(PAYMENT_RESPONSE_HEADER, encode(previous.receipt));
  return response;
}

function decodePayment(header: string): PaymentPayload | undefined {
  try {
    if (header.length > 20_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header)) return;
    const parsed = PaymentPayloadV2Schema.safeParse(JSON.parse(Buffer.from(header, "base64").toString("utf8")));
    if (!parsed.success) return;
    return parsed.data as PaymentPayload;
  } catch { return; }
}

export function createPaidMarketApi(
  config: Day4Config,
  facilitator: FacilitatorClient = new HTTPFacilitatorClient({ url: config.facilitatorUrl, timeoutMs: 30_000 }),
  store = new SettlementStore(),
): (input: unknown, payment?: string, recoveryOnly?: boolean) => Promise<Response> {
  const server = new x402ResourceServer(facilitator).register(config.network, new ExactSvmScheme());
  let initialized: Promise<void> | undefined;

  async function initialize() {
    initialized ??= server.initialize().catch((error) => { initialized = undefined; throw error; });
    await initialized;
  }

  async function quote(error?: string) {
    await initialize();
    // 128-bit nonce in 22 ASCII characters keeps Memo within the SDK's 20k CU budget.
    const memo = `day4:${randomBytes(16).toString("base64url")}`;
    const requirements = await server.buildPaymentRequirements({
      scheme: "exact", network: config.network, payTo: config.merchant,
      price: { amount: PAYMENT_AMOUNT, asset: config.mint }, maxTimeoutSeconds: 300,
      extra: { memo },
    });
    if (requirements.length !== 1 || typeof requirements[0].extra.feePayer !== "string") {
      return jsonError(503, "Facilitator does not support the configured test payment");
    }
    store.saveQuote({ id: memo, resource: MARKET_RESOURCE_URL, requirements: requirements[0], expiresAt: Date.now() + 300_000 });
    const required = await server.createPaymentRequiredResponse(requirements, {
      url: MARKET_RESOURCE_URL, description: "Premium SOL market snapshot (demo fixture)", mimeType: "application/json",
    }, error);
    return new Response(null, { status: 402, headers: {
      [PAYMENT_REQUIRED_HEADER]: encode(required), "cache-control": "no-store",
    } });
  }

  return async (input, payment, recoveryOnly = false) => {
    if (!MarketSnapshotInputSchema.safeParse(input).success) return jsonError(400, "Unsupported asset");
    try {
      if (!payment) return recoveryOnly ? jsonError(400, "Recovery requires original payment") : await quote();
      const payload = decodePayment(payment);
      if (!payload) return await quote("Invalid x402 V2 payment payload");
      const memo = payload.accepted.extra?.memo;
      const storedQuote = typeof memo === "string" ? store.getQuote(memo) : undefined;
      if (!storedQuote || storedQuote.resource !== MARKET_RESOURCE_URL ||
          (payload.resource && payload.resource.url !== MARKET_RESOURCE_URL) ||
          !isDeepStrictEqual(payload.accepted, storedQuote.requirements) ||
          !matchesConfig(storedQuote.requirements, config)) {
        return await quote("Payment does not match the server-issued quote");
      }
      const transaction = payload.payload.transaction;
      if (typeof transaction !== "string" || transaction.length > 2_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(transaction)) {
        return await quote("Invalid Solana payment transaction");
      }
      let messageHash: string;
      let payloadHash: string;
      try {
        const bytes = Buffer.from(transaction, "base64");
        const decoded = VersionedTransaction.deserialize(bytes);
        if (!Buffer.from(decoded.serialize()).equals(bytes)) throw new Error("Noncanonical transaction");
        messageHash = createHash("sha256").update(decoded.message.serialize()).digest("hex");
        payloadHash = createHash("sha256").update(bytes).digest("hex");
      } catch { return await quote("Invalid Solana payment transaction"); }

      const previous = store.get(messageHash);
      if (previous) {
        if (previous.quoteId !== storedQuote.id) return jsonError(409, "Transaction belongs to a different quote");
        if (previous.payloadHash !== payloadHash) return jsonError(409, "Payment transaction already claimed");
        if (recoveryOnly && previous.status === "UNKNOWN") {
          const outcome = await reconcileOriginalTransaction(config, messageHash, storedQuote.id, previous.receipt?.transaction);
          if (outcome.status !== "UNKNOWN") {
            const receipt: SettleResponse = { success: outcome.status === "CONFIRMED", transaction: outcome.transaction,
              network: config.network, payer: config.buyer, amount: PAYMENT_AMOUNT };
            if (outcome.status === "CONFIRMED") store.confirm(messageHash, receipt, previous.body ?? snapshotBody);
            else store.fail(messageHash, { ...receipt, errorReason: "transaction_failed_on_chain" });
          }
        }
        return previousResponse(store.get(messageHash)!, payloadHash);
      }
      // Recovery must never turn an unsubmitted payload into a first payment.
      if (recoveryOnly) return jsonError(202, "No settlement claim found; payment remains unresolved");
      if (store.getByQuote(storedQuote.id)) return jsonError(409, "Quote already claimed; do not create another payment");
      if (storedQuote.expiresAt <= Date.now()) return await quote("Payment quote expired");

      await initialize();
      const verification = await server.verifyPayment(payload, storedQuote.requirements);
      if (!verification.isValid || verification.payer !== config.buyer) return await quote("Payment verification rejected");

      // Prepare output first. Commit the durable UNKNOWN claim before calling
      // settlement: timeouts, process exits and write failures never permit re-pay.
      if (!store.claim(messageHash, storedQuote.id, payloadHash, snapshotBody)) {
        const claimed = store.get(messageHash);
        return claimed ? previousResponse(claimed, payloadHash) : jsonError(409, "Quote already claimed");
      }
      try {
        const receipt = await server.settlePayment(payload, storedQuote.requirements);
        if (!receipt.success) {
          if (receipt.errorReason === "settlement_pending" || receipt.transaction) {
            store.pending(messageHash, receipt);
            return previousResponse(store.get(messageHash)!, payloadHash);
          }
          store.fail(messageHash, receipt);
          return jsonError(402, "Settlement failed; no market data released");
        }
        if (!receipt.transaction || receipt.network !== config.network || receipt.payer !== config.buyer ||
            (receipt.amount !== undefined && receipt.amount !== PAYMENT_AMOUNT)) {
          return previousResponse(store.get(messageHash)!, payloadHash);
        }
        store.confirm(messageHash, receipt, snapshotBody);
        return paidResponse(snapshotBody, receipt);
      } catch {
        return previousResponse(store.get(messageHash)!, payloadHash);
      }
    } catch {
      return jsonError(503, "Payment service unavailable; do not submit a replacement payment");
    }
  };
}

function matchesConfig(requirements: PaymentRequirements, config: Day4Config) {
  return requirements.scheme === "exact" && requirements.network === config.network &&
    requirements.asset === config.mint && requirements.payTo === config.merchant && requirements.amount === PAYMENT_AMOUNT;
}

let configuredHandler: ReturnType<typeof createPaidMarketApi> | undefined;

export async function paidMarketSnapshotResponse(input: unknown, payment?: string, recoveryOnly = false) {
  if (!MarketSnapshotInputSchema.safeParse(input).success) return jsonError(400, "Unsupported asset");
  try {
    configuredHandler ??= createPaidMarketApi(loadDay4Config());
    return await configuredHandler(input, payment, recoveryOnly);
  } catch {
    return jsonError(503, "Day 4 payment configuration is incomplete");
  }
}

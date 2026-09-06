import {
  MarketSnapshotInputSchema,
  MarketSnapshotOutputSchema,
} from "../resources/resource-schema";

export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

export const demoPaymentRequirement = {
  x402Version: 2,
  scheme: "exact",
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  amount: "10000",
  payTo: "11111111111111111111111111111111",
  resource: "premium-sol-market-snapshot",
  description: "Premium SOL market snapshot",
  mimeType: "application/json",
} as const;

const snapshot = MarketSnapshotOutputSchema.parse({
  asset: "SOL",
  as_of: "2026-09-05T08:00:00.000Z",
  spot_price_usd: 140,
  change_24h_pct: 2.4,
  volume_24h_usd: 3_000_000_000,
  market_cap_usd: 75_000_000_000,
  volatility_7d_pct: 5.8,
  rsi_14d: 57,
  support_levels_usd: [132, 136],
  resistance_levels_usd: [145, 151],
  source_label: "Demo snapshot fixture",
  is_demo_snapshot: true,
});

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function paidMarketSnapshotResponse(input: unknown, payment?: string) {
  const parsedInput = MarketSnapshotInputSchema.safeParse(input);
  if (!parsedInput.success) return new Response("Unsupported asset", { status: 400 });
  if (payment !== "demo-valid-payment") {
    return new Response(null, {
      status: 402,
      headers: { [PAYMENT_REQUIRED_HEADER]: encode(demoPaymentRequirement) },
    });
  }
  return new Response(JSON.stringify(snapshot), {
    status: 200,
    headers: {
      "content-type": "application/json",
      [PAYMENT_RESPONSE_HEADER]: encode({ success: true, transaction: "demo-transaction" }),
    },
  });
}

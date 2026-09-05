import { z } from "zod";

const identifierSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);

const solanaAddressSchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana address");

const solanaNetworkSchema = z
  .string()
  .regex(/^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana CAIP-2 network");

const httpsUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === "https:", "Endpoint must use HTTPS");

const ascendingPositiveNumbersSchema = z
  .array(z.number().finite().positive())
  .max(3)
  .refine(
    (values) => values.every((value, index) => index === 0 || value > values[index - 1]),
    "Values must be strictly ascending",
  );

export const MarketSnapshotInputSchema = z
  .object({
    asset: z.literal("SOL"),
  })
  .strict();

export const MarketSnapshotOutputSchema = z
  .object({
    asset: z.literal("SOL"),
    as_of: z.string().datetime({ offset: true }),
    spot_price_usd: z.number().finite().positive(),
    change_24h_pct: z.number().finite(),
    volume_24h_usd: z.number().finite().nonnegative(),
    market_cap_usd: z.number().finite().positive(),
    volatility_7d_pct: z.number().finite().nonnegative(),
    rsi_14d: z.number().finite().min(0).max(100),
    support_levels_usd: ascendingPositiveNumbersSchema,
    resistance_levels_usd: ascendingPositiveNumbersSchema,
    source_label: z.string().trim().min(1).max(120),
    is_demo_snapshot: z.literal(true),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (Date.parse(snapshot.as_of) > Date.now()) {
      context.addIssue({
        code: "custom",
        path: ["as_of"],
        message: "Snapshot timestamp cannot be in the future",
      });
    }

    if (snapshot.support_levels_usd.some((level) => level >= snapshot.spot_price_usd)) {
      context.addIssue({
        code: "custom",
        path: ["support_levels_usd"],
        message: "Support levels must be below the spot price",
      });
    }

    if (snapshot.resistance_levels_usd.some((level) => level <= snapshot.spot_price_usd)) {
      context.addIssue({
        code: "custom",
        path: ["resistance_levels_usd"],
        message: "Resistance levels must be above the spot price",
      });
    }
  });

export const ResourceMetadataSchema = z
  .object({
    resource_id: identifierSchema,
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(500),
    capability: z.literal("crypto.market.snapshot"),
    provider_id: identifierSchema,
    endpoint: httpsUrlSchema,
    method: z.literal("GET"),
    input_schema: z.literal("MarketSnapshotInput"),
    output_schema: z.literal("MarketSnapshotOutput"),
    expected_price_minor: z.number().int().positive().safe(),
    currency: z.literal("USDC"),
    asset_id: solanaAddressSchema,
    asset_decimals: z.literal(6),
    network: solanaNetworkSchema,
    allowed_pay_to: solanaAddressSchema,
    payment_scheme: z.literal("exact"),
    enabled: z.boolean(),
  })
  .strict();

export type MarketSnapshotInput = z.infer<typeof MarketSnapshotInputSchema>;
export type MarketSnapshotOutput = z.infer<typeof MarketSnapshotOutputSchema>;
export type ResourceMetadata = z.infer<typeof ResourceMetadataSchema>;

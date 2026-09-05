import {
  ResourceMetadataSchema,
  type ResourceMetadata,
} from "./resource-schema";

export const PREMIUM_SOL_MARKET_SNAPSHOT_ID = "premium-sol-market-snapshot";

export type StaticResourceRegistryConfig = Pick<
  ResourceMetadata,
  "endpoint" | "asset_id" | "network" | "allowed_pay_to"
>;

export type StaticResourceRegistry = readonly [Readonly<ResourceMetadata>];

export function createStaticResourceRegistry(
  config: StaticResourceRegistryConfig,
): StaticResourceRegistry {
  const resource = ResourceMetadataSchema.parse({
    resource_id: PREMIUM_SOL_MARKET_SNAPSHOT_ID,
    name: "Premium SOL Market Snapshot API",
    description:
      "Returns a timestamped SOL market snapshot with price, volume, volatility, and technical indicators.",
    capability: "crypto.market.snapshot",
    provider_id: "demo-market-data-provider",
    endpoint: config.endpoint,
    method: "GET",
    input_schema: "MarketSnapshotInput",
    output_schema: "MarketSnapshotOutput",
    expected_price_minor: 10_000,
    currency: "USDC",
    asset_id: config.asset_id,
    asset_decimals: 6,
    network: config.network,
    allowed_pay_to: config.allowed_pay_to,
    payment_scheme: "exact",
    enabled: true,
  });

  return Object.freeze([Object.freeze(resource)]) as StaticResourceRegistry;
}

export function getResourceById(
  registry: StaticResourceRegistry,
  resourceId: string,
): Readonly<ResourceMetadata> | undefined {
  return registry.find((resource) => resource.resource_id === resourceId);
}

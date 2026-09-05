import { describe, expect, it } from "vitest";

import {
  createStaticResourceRegistry,
  getResourceById,
  PREMIUM_SOL_MARKET_SNAPSHOT_ID,
} from "../../src/modules/resources/static-resource-registry";

const registryConfig = {
  endpoint: "https://api.example.test/v1/market-snapshot",
  asset_id: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  allowed_pay_to: "11111111111111111111111111111111",
} as const;

describe("static resource registry", () => {
  it("contains exactly one frozen V0 resource", () => {
    const registry = createStaticResourceRegistry(registryConfig);

    expect(registry).toHaveLength(1);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry[0])).toBe(true);
  });

  it("returns the premium SOL market resource by its stable ID", () => {
    const registry = createStaticResourceRegistry(registryConfig);
    const resource = getResourceById(registry, PREMIUM_SOL_MARKET_SNAPSHOT_ID);

    expect(resource).toMatchObject({
      resource_id: PREMIUM_SOL_MARKET_SNAPSHOT_ID,
      capability: "crypto.market.snapshot",
      expected_price_minor: 10_000,
      currency: "USDC",
      network: registryConfig.network,
      enabled: true,
    });
  });

  it("returns undefined for an unknown resource ID", () => {
    const registry = createStaticResourceRegistry(registryConfig);

    expect(getResourceById(registry, "unknown-resource")).toBeUndefined();
  });

  it("rejects invalid deployment-controlled configuration", () => {
    expect(() =>
      createStaticResourceRegistry({
        ...registryConfig,
        endpoint: "http://api.example.test/v1/market-snapshot",
      }),
    ).toThrow();
  });
});

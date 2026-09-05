import { describe, expect, it } from "vitest";

import { discoverResource } from "../../src/modules/resources/resource-discovery";
import { createStaticResourceRegistry } from "../../src/modules/resources/static-resource-registry";

const registry = createStaticResourceRegistry({
  endpoint: "https://api.example.test/v1/market-snapshot",
  asset_id: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  allowed_pay_to: "11111111111111111111111111111111",
});

describe("resource discovery", () => {
  it("finds the single enabled SOL market resource", () => {
    const result = discoverResource(registry, {
      capability: "crypto.market.snapshot",
      asset: "SOL",
    });

    expect(result).toMatchObject({
      status: "found",
      resource: {
        resource_id: "premium-sol-market-snapshot",
        expected_price_minor: 10_000,
        currency: "USDC",
      },
    });
  });

  it("does not expose endpoint, mint, or payee to the Agent", () => {
    const result = discoverResource(registry, {
      capability: "crypto.market.snapshot",
      asset: "SOL",
    });

    expect(result.resource).not.toHaveProperty("endpoint");
    expect(result.resource).not.toHaveProperty("asset_id");
    expect(result.resource).not.toHaveProperty("allowed_pay_to");
  });

  it("returns not_found for BTC", () => {
    expect(
      discoverResource(registry, {
        capability: "crypto.market.snapshot",
        asset: "BTC",
      }),
    ).toMatchObject({ status: "not_found", resource: null });
  });

  it("does not return a disabled resource", () => {
    const disabledRegistry = [{ ...registry[0], enabled: false }];

    expect(
      discoverResource(disabledRegistry, {
        capability: "crypto.market.snapshot",
        asset: "SOL",
      }),
    ).toMatchObject({ status: "not_found", resource: null });
  });

  it("reports a configuration error instead of choosing between duplicates", () => {
    const duplicateRegistry = [
      registry[0],
      { ...registry[0], resource_id: "duplicate-sol-resource" },
    ];

    expect(
      discoverResource(duplicateRegistry, {
        capability: "crypto.market.snapshot",
        asset: "SOL",
      }),
    ).toMatchObject({ status: "configuration_error", resource: null });
  });
});

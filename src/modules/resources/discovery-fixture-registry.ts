import { createStaticResourceRegistry } from "./static-resource-registry";

export function createDiscoveryFixtureRegistry() {
  // Discovery uses a non-routable endpoint and a placeholder payee by design.
  // Payment work must replace both through server-owned configuration.
  return createStaticResourceRegistry({
    endpoint: "https://paid-api.discovery.invalid/v1/market-snapshot",
    asset_id: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    allowed_pay_to: "11111111111111111111111111111111",
  });
}

import { z } from 'zod';
import { ResourceMetadataSchema, type ResourceMetadata } from './resource-schema';
import { DEMO_MARKET_DATA_PROVIDER_ID, SOL_MARKET_SNAPSHOT_RESOURCE_ID, type StaticResourceRegistryConfig } from './static-resource-registry';

export const MarketOfferIdSchema = z.enum(['basic', 'premium']);
export type MarketOfferId = z.infer<typeof MarketOfferIdSchema>;

const offers = Object.freeze({
  basic: Object.freeze({ id: 'basic' as const, amount: '200000', display: '0.20 test USDC' }),
  premium: Object.freeze({ id: 'premium' as const, amount: '20000000', display: '20.00 test USDC' }),
});

export function marketOffer(id: MarketOfferId) { return offers[id]; }

export function marketOfferResource(config: StaticResourceRegistryConfig, id: MarketOfferId): Readonly<ResourceMetadata> {
  const offer = marketOffer(id);
  return Object.freeze(ResourceMetadataSchema.parse({
    resource_id: SOL_MARKET_SNAPSHOT_RESOURCE_ID,
    name: `${id === 'basic' ? 'Basic' : 'Premium'} SOL Market Snapshot API`,
    description: 'Returns the fixed demo SOL market snapshot for purchase-request policy evaluation.',
    capability: 'crypto.market.snapshot',
    provider_id: DEMO_MARKET_DATA_PROVIDER_ID,
    endpoint: config.endpoint,
    method: 'GET',
    input_schema: 'MarketSnapshotInput',
    output_schema: 'MarketSnapshotOutput',
    expected_price_minor: Number(offer.amount),
    currency: 'USDC',
    asset_id: config.asset_id,
    asset_decimals: 6,
    network: config.network,
    allowed_pay_to: config.allowed_pay_to,
    payment_scheme: 'exact',
    enabled: true,
  }));
}

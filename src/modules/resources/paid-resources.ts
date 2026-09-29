import { z } from 'zod';
import { PAID_MARKET_RESOURCE_URLS } from '../paid-market-api/paid-market-api';
import { DEMO_MARKET_DATA_PROVIDER_ID } from './static-resource-registry';

export const PAID_RESOURCE_SCOPE_ID = 'demo-sol-market-resources';
export const PaidResourceIdSchema = z.enum(['market-snapshot', 'market-analysis']);
export type PaidResourceId = z.infer<typeof PaidResourceIdSchema>;

const common = { asset: z.literal('SOL'), as_of: z.string().datetime({ offset: true }),
  source_label: z.string().min(1).max(120) };
const snapshot = z.object({ resource_id: z.literal('sol-market-snapshot'), ...common,
  spot_price_usd: z.number().finite().positive(), is_demo_snapshot: z.literal(true) }).strict();
const analysis = z.object({ resource_id: z.literal('sol-market-analysis'), ...common,
  assessment: z.string().min(1).max(500), indicators: z.object({ change_24h_pct: z.number().finite(),
    volatility_7d_pct: z.number().finite().nonnegative(), rsi_14d: z.number().finite().min(0).max(100) }).strict(),
  is_demo_analysis: z.literal(true) }).strict();

export const PAID_RESOURCES = Object.freeze({
  'market-snapshot': Object.freeze({ id: 'market-snapshot', name: 'SOL Market Snapshot',
    path: PAID_MARKET_RESOURCE_URLS.snapshot, providerId: DEMO_MARKET_DATA_PROVIDER_ID, output: snapshot }),
  'market-analysis': Object.freeze({ id: 'market-analysis', name: 'SOL Market Analysis',
    path: PAID_MARKET_RESOURCE_URLS.analysis, providerId: DEMO_MARKET_DATA_PROVIDER_ID, output: analysis }),
});

export function paidResource(id: PaidResourceId) { return PAID_RESOURCES[id]; }

export function parsePaidResourceDelivery(id: PaidResourceId, raw: unknown): Record<string, unknown> {
  return paidResource(id).output.parse(raw);
}

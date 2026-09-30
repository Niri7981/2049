import { beforeEach, expect, it, vi } from 'vitest';

const paidResponse = vi.hoisted(() => vi.fn(async () => new Response(null, { status: 402 })));
vi.mock('../../src/modules/paid-market-api/paid-market-api', () => ({
  paidMarketSnapshotResponse: paidResponse,
  PAYMENT_SIGNATURE_HEADER: 'PAYMENT-SIGNATURE',
  PAYMENT_RECOVERY_HEADER: 'PAYMENT-RECOVERY',
}));

import { GET as getSnapshot } from '../../src/app/api/paid/sol-market-snapshot/route';
import { GET as getAnalysis } from '../../src/app/api/paid/market-analysis/route';
import { GET as getRisk } from '../../src/app/api/paid/token-risk-report/route';

beforeEach(() => paidResponse.mockClear());

it.each([
  ['sol-market-snapshot', 'snapshot', getSnapshot],
  ['market-analysis', 'analysis', getAnalysis],
  ['token-risk-report', 'risk', getRisk],
] as const)('binds the %s route to its own paid resource', async (path, resource, get) => {
  const request = new Request(`http://127.0.0.1:3049/api/paid/${path}?asset=SOL`, {
    headers: { 'PAYMENT-SIGNATURE': 'signed-fixture', 'PAYMENT-RECOVERY': '1' },
  });
  expect((await get(request)).status).toBe(402);
  expect(paidResponse).toHaveBeenCalledWith({ asset: 'SOL', resource }, 'signed-fixture', true);
  expect((await get(new Request(`${request.url}&offer=premium`))).status).toBe(400);
  expect(paidResponse).toHaveBeenCalledOnce();
});

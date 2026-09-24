import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  authenticate: vi.fn(),
  overview: vi.fn(),
}));

vi.mock('@/modules/app/app-runtime', () => ({
  appRuntime: () => ({ agentConnection: { authenticate: state.authenticate }, overview: state.overview }),
}));
vi.mock('@/modules/purchases/market-quote', () => ({ readMarketQuote: vi.fn() }));

import { GET } from '../../src/app/api/agent/route';

beforeEach(() => {
  vi.clearAllMocks();
});

function overview(purchaseMode: 'simulated' | 'live_devnet') {
  return {
    service: { purchaseMode }, wallet: { address: 'buyer' }, budget: { paid: '0' },
    grant: { status: 'ACTIVE' }, connection: { enabled: true, access: 'purchase_intent' },
  };
}

it.each([
  ['simulated', false],
  ['live_devnet', true],
] as const)('reports paymentEnabled from the %s purchase mode', async (purchaseMode, paymentEnabled) => {
  state.overview.mockResolvedValueOnce(overview(purchaseMode));
  const response = await GET(new Request('http://127.0.0.1:3049/api/agent?operation=status'));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ paymentEnabled, spendingAuthorized: true });
});

it('does not equate purchase-intent capability with spending authorization after Grant revoke', async () => {
  state.overview.mockResolvedValueOnce({ ...overview('live_devnet'), grant: { status: 'REVOKED' } });
  const response = await GET(new Request('http://127.0.0.1:3049/api/agent?operation=status'));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ spendingAuthorized: false, paymentEnabled: true });
});

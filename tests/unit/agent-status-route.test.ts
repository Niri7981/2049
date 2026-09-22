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
    grant: { status: 'ACTIVE' }, connection: { access: 'spending_request' },
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

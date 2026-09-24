import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  appRuntime: vi.fn(),
  requireManagementRequest: vi.fn(),
  managementError: vi.fn((error: unknown) => Response.json({ error: String(error) }, { status: 400 })),
  smallJson: vi.fn(),
  createTestPurchase: vi.fn(),
}));

vi.mock('@/modules/app/app-runtime', () => ({ appRuntime: state.appRuntime }));
vi.mock('@/modules/app/management-auth', () => ({
  requireManagementRequest: state.requireManagementRequest,
  managementError: state.managementError,
}));
vi.mock('@/modules/demo/local-request', () => ({ smallJson: state.smallJson }));

import { POST } from '../../src/app/api/app/test-purchases/route';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it('keeps the canonical App test-purchase route independent of the legacy task opt-in', async () => {
  vi.stubEnv('APP2049_ENABLE_LEGACY_DEMO_TASKS', '');
  state.appRuntime.mockReturnValue({ createTestPurchase: state.createTestPurchase });
  state.smallJson.mockResolvedValue({ purchaseId: 'app-route-test' });
  state.createTestPurchase.mockResolvedValue({ purchaseId: 'app-route-test', status: 'PAID', simulated: true });

  const request = new Request('http://127.0.0.1:3049/api/app/test-purchases', { method: 'POST' });
  const response = await POST(request);

  expect(response.status).toBe(200);
  expect(state.requireManagementRequest).toHaveBeenCalledWith(request, true);
  expect(state.createTestPurchase).toHaveBeenCalledWith('app-route-test', 'http://127.0.0.1:3049');
  await expect(response.json()).resolves.toMatchObject({ purchase: { status: 'PAID', simulated: true } });
});

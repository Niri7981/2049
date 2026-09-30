import { afterEach, expect, it, vi } from 'vitest';
import { signedManagementRequest } from '../helpers/management-request';

const state = vi.hoisted(() => ({
  appRuntime: vi.fn(),
  createTestPurchase: vi.fn(),
}));

vi.mock('@/modules/app/app-runtime', () => ({ appRuntime: state.appRuntime }));
// Resolve aliases to the real modules; authentication and body parsing remain active.
vi.mock('@/modules/app/management-auth', async () => await import('../../src/modules/app/management-auth'));
vi.mock('@/modules/http/local-request', async () => await import('../../src/modules/http/local-request'));

import { POST } from '../../src/app/api/app/test-purchases/route';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it('keeps the canonical App test-purchase route independent of the legacy task opt-in', async () => {
  const origin = 'http://127.0.0.1:3049';
  const token = 'm'.repeat(43);
  vi.stubEnv('APP2049_MANAGEMENT_TOKEN', token);
  vi.stubEnv('APP2049_ENABLE_LEGACY_DEMO_TASKS', '');
  state.appRuntime.mockReturnValue({ createTestPurchase: state.createTestPurchase });
  state.createTestPurchase.mockResolvedValue({ purchaseId: 'app-route-test', status: 'PAID', simulated: true });

  const request = signedManagementRequest(`${origin}/api/app/test-purchases`, token, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ purchaseId: 'app-route-test' }) });
  const response = await POST(request);

  expect(response.status).toBe(200);
  expect(state.createTestPurchase).toHaveBeenCalledWith('app-route-test', origin);
  await expect(response.json()).resolves.toMatchObject({ purchase: { status: 'PAID', simulated: true } });
});

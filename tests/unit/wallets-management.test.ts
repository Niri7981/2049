import { afterEach, expect, it, vi } from 'vitest';
import { GET } from '../../src/app/api/app/wallets/route';
import { appRuntime } from '../../src/modules/app/app-runtime';
import { signedManagementRequest } from '../helpers/management-request';

const { existingWallets } = vi.hoisted(() => ({ existingWallets: vi.fn() }));
vi.mock('../../src/modules/app/app-runtime', () => ({ appRuntime: vi.fn(() => ({ existingWallets })) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

const url = 'http://127.0.0.1:3049/api/app/wallets';
const token = 'wallets-management-fixture-'.repeat(2);

it('rejects unauthenticated inventory requests before accessing wallets', async () => {
  vi.stubEnv('YOSH_MANAGEMENT_TOKEN', token);
  expect((await GET(new Request(url, { headers: { host: '127.0.0.1:3049' } }))).status).toBe(401);
  expect(appRuntime).not.toHaveBeenCalled();
});

it('returns only public inventory through the authenticated read-only management endpoint', async () => {
  vi.stubEnv('YOSH_MANAGEMENT_TOKEN', token);
  const wallets = [{ id: 'mainnet', label: 'Mainnet', address: null, status: 'missing' }];
  existingWallets.mockResolvedValue(wallets);
  const request = signedManagementRequest(url, token);
  const response = await GET(request);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.has('x-2049-response-proof')).toBe(true);
  expect(await response.json()).toEqual({ wallets });
  expect(existingWallets).toHaveBeenCalledTimes(1);
  expect((await GET(signedManagementRequest(url, token, {}, Number(request.headers.get('x-2049-timestamp')),
    request.headers.get('x-2049-nonce')!))).status).toBe(401);
  expect(existingWallets).toHaveBeenCalledTimes(1);
});

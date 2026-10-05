import { afterEach, expect, it, vi } from 'vitest';
import { DataDirectoryInUseError } from '../../src/modules/app/data-directory-owner';
import { signedManagementRequest } from '../helpers/management-request';

const state = vi.hoisted(() => ({ appRuntime: vi.fn() }));
vi.mock('@/modules/app/app-runtime', () => ({ appRuntime: state.appRuntime }));
vi.mock('@/modules/app/management-auth', async () => await import('../../src/modules/app/management-auth'));
vi.mock('@/modules/http/local-request', async () => await import('../../src/modules/http/local-request'));

import { GET as overview } from '../../src/app/api/app/overview/route';
import { PUT as settings } from '../../src/app/api/app/settings/route';

const origin = 'http://127.0.0.1:3049';
const token = 'm'.repeat(43);
const request = (headers: Record<string, string> = {}) => {
  const result = signedManagementRequest(`${origin}/api/app/overview`, token);
  for (const [name, value] of Object.entries(headers)) result.headers.set(name, value);
  return result;
};

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

it('preserves management authentication and safe client errors', async () => {
  vi.stubEnv('APP2049_MANAGEMENT_TOKEN', token);
  const unauthorized = await overview(request({ 'x-2049-proof': '0'.repeat(64) }));
  expect(unauthorized.status).toBe(401);
  await expect(unauthorized.json()).resolves.toEqual({ code: 'UNAUTHORIZED', error: '未授权的管理请求。' });
  const forbidden = await overview(request({ 'sec-fetch-site': 'cross-site' }));
  expect(forbidden.status).toBe(403);
  await expect(forbidden.json()).resolves.toEqual({ code: 'LOCAL_REQUEST_FORBIDDEN', error: '请求来源不被允许。' });
  const invalidHost = await overview(request({ host: 'not a valid host' }));
  expect(invalidHost.status).toBe(403);
  const wrongOrigin = await settings(signedManagementRequest(`${origin}/api/app/settings`, token, { method: 'PUT',
    headers: { origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{}' }));
  expect(wrongOrigin.status).toBe(403);
  const wrongType = await settings(signedManagementRequest(`${origin}/api/app/settings`, token, { method: 'PUT',
    headers: { origin, 'content-type': 'text/plain' }, body: '{}' }));
  expect(wrongType.status).toBe(403);
  const malformed = await settings(signedManagementRequest(`${origin}/api/app/settings`, token, { method: 'PUT',
    headers: { origin, 'content-type': 'application/json' }, body: '{' }));
  expect(malformed.status).toBe(400);
  await expect(malformed.json()).resolves.toEqual({ code: 'INVALID_REQUEST', error: '请求内容无效。' });
  expect(state.appRuntime).not.toHaveBeenCalled();
});

it('sanitizes internal failures and reports ownership contention as unavailable', async () => {
  vi.stubEnv('APP2049_MANAGEMENT_TOKEN', token);
  state.appRuntime.mockImplementationOnce(() => { throw new Error('private SDK token and database path'); });
  const internal = await overview(request());
  expect(internal.status).toBe(500);
  expect(JSON.stringify(await internal.json())).not.toContain('private SDK token');
  state.appRuntime.mockImplementationOnce(() => { throw new SyntaxError('private SDK response'); });
  const internalParse = await overview(request());
  expect(internalParse.status).toBe(500);
  expect(JSON.stringify(await internalParse.json())).not.toContain('private SDK response');
  state.appRuntime.mockImplementationOnce(() => { throw new DataDirectoryInUseError(); });
  const busy = await overview(request());
  expect(busy.status).toBe(503);
  await expect(busy.json()).resolves.toEqual({ code: 'DATA_DIRECTORY_IN_USE', error: 'Yosh 数据已由另一服务使用。' });
});

import { afterEach, expect, it, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { managementRoute, requireManagementRequest } from '../../src/modules/app/management-auth';
import { signedManagementRequest } from '../helpers/management-request';

const secret = 'test-installation-secret-'.repeat(2);
const url = 'http://127.0.0.1:3049/api/app/health';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  const globals = globalThis as typeof globalThis & { __app2049ManagementNonces?: Map<string, number> };
  globals.__app2049ManagementNonces?.clear();
});

it('accepts a signed management request without transmitting the reusable secret', () => {
  vi.stubEnv('APP2049_MANAGEMENT_TOKEN', secret);
  const request = signedManagementRequest(url, secret);
  expect(JSON.stringify([...request.headers])).not.toContain(secret);
  expect(request.url).not.toContain(secret);
  expect(request.headers.has('authorization')).toBe(false);
  expect(() => requireManagementRequest(request)).not.toThrow();
});

it('binds proofs to method, full request target, timestamp, nonce and body digest', () => {
  vi.stubEnv('APP2049_MANAGEMENT_TOKEN', secret);
  for (const [header, value] of [['x-2049-timestamp', String(Date.now() + 1000)],
    ['x-2049-nonce', '0'.repeat(64)], ['x-2049-body-sha256', '0'.repeat(64)], ['x-2049-proof', '0'.repeat(64)]]) {
    const request = signedManagementRequest(url, secret);
    request.headers.set(header, value);
    expect(() => requireManagementRequest(request)).toThrow('UNAUTHORIZED');
  }
  const signed = signedManagementRequest(url, secret);
  expect(() => requireManagementRequest(new Request(url + '?different=true', { headers: signed.headers }))).toThrow('UNAUTHORIZED');
  expect(() => requireManagementRequest(new Request(url, { method: 'POST', headers: signed.headers }))).toThrow('UNAUTHORIZED');
});

it('verifies actual body bytes before invoking a handler and authenticates the error response', async () => {
  vi.stubEnv('APP2049_MANAGEMENT_TOKEN', secret);
  const origin = new URL(url).origin;
  const request = signedManagementRequest(url, secret, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
  const tampered = new Request(url, { method: 'POST', headers: request.headers, body: '{"tampered":true}' });
  const handler = vi.fn(async () => Response.json({ ready: true }));
  const response = await managementRoute(tampered, true, handler);
  expect(handler).not.toHaveBeenCalled();
  expect(response.status).toBe(401);
  const body = Buffer.from(await response.arrayBuffer());
  const message = ['2049-management-response-v1', request.headers.get('x-2049-nonce'), '401',
    createHash('sha256').update(body).digest('hex')].join('\n');
  expect(response.headers.get('x-2049-response-proof')).toBe(createHmac('sha256', secret).update(message).digest('hex'));
});

it('signs exact success bytes and preserves authenticated handler failures', async () => {
  vi.stubEnv('APP2049_MANAGEMENT_TOKEN', secret);
  for (const fail of [false, true]) {
    const request = signedManagementRequest(url, secret);
    const response = await managementRoute(request, false, async () => {
      if (fail) throw new Error('private diagnostic');
      return Response.json({ ready: true });
    });
    const body = Buffer.from(await response.arrayBuffer());
    const message = ['2049-management-response-v1', request.headers.get('x-2049-nonce'), String(response.status),
      createHash('sha256').update(body).digest('hex')].join('\n');
    expect(response.headers.get('x-2049-response-proof')).toBe(createHmac('sha256', secret).update(message).digest('hex'));
    expect(body.toString()).not.toContain(secret);
    expect(body.toString()).not.toContain('private diagnostic');
    expect(response.status).toBe(fail ? 500 : 200);
  }
});

it('bounds the replay cache without evicting still-valid future-dated nonces', () => {
  vi.stubEnv('APP2049_MANAGEMENT_TOKEN', secret);
  vi.useFakeTimers();
  const now = Date.now();
  vi.setSystemTime(now);
  const future = signedManagementRequest(url, secret, {}, now + 29_000);
  requireManagementRequest(future);
  for (let i = 1; i < 4096; i++) requireManagementRequest(signedManagementRequest(url, secret));
  expect(() => requireManagementRequest(signedManagementRequest(url, secret))).toThrow('MANAGEMENT_BUSY');
  vi.setSystemTime(now + 31_000);
  expect(() => requireManagementRequest(future)).toThrow('MANAGEMENT_REPLAY');
  expect(() => requireManagementRequest(signedManagementRequest(url, secret))).not.toThrow();
});

it('bounds request bodies before any business handler runs', async () => {
  vi.stubEnv('APP2049_MANAGEMENT_TOKEN', secret);
  const request = signedManagementRequest(url, secret, { method: 'POST',
    headers: { origin: new URL(url).origin, 'content-type': 'application/json' }, body: 'x'.repeat(8193) });
  const handler = vi.fn(async () => Response.json({ ready: true }));
  expect((await managementRoute(request, true, handler)).status).toBe(400);
  expect(handler).not.toHaveBeenCalled();
});

it('rejects replay of an accepted nonce and expired or future timestamps', () => {
  vi.stubEnv('APP2049_MANAGEMENT_TOKEN', secret);
  const request = signedManagementRequest(url, secret);
  requireManagementRequest(request);
  expect(() => requireManagementRequest(request)).toThrow('MANAGEMENT_REPLAY');
  expect(() => requireManagementRequest(signedManagementRequest(url, secret, {}, Date.now() - 31_000))).toThrow('UNAUTHORIZED');
  expect(() => requireManagementRequest(signedManagementRequest(url, secret, {}, Date.now() + 31_000))).toThrow('UNAUTHORIZED');
});

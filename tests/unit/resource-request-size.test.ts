import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { smallJson } from '../../src/modules/http/local-request';
import { managementRoute } from '../../src/modules/app/management-auth';
import { RuntimeResourceRegistry } from '../../src/modules/resources/runtime-resource-registry';
import { MAINNET_NETWORK, MAINNET_USDC_MINT } from '../../src/modules/payment/payment-environment';
import { POST as register } from '../../src/app/api/app/resources/route';
import { POST as purchase } from '../../src/app/api/agent/purchases/route';
import { POST as quote } from '../../src/app/api/agent/quote/route';
import { signedManagementRequest } from '../helpers/management-request';

const state = vi.hoisted(() => ({ add: vi.fn(), request: vi.fn(), quote: vi.fn() }));
vi.mock('../../src/modules/app/app-runtime', () => ({ appRuntime: () => ({
  addRegisteredResource: state.add, authenticateAgent: () => ({ cardMemberId: 'isolated-agent' }),
  requestPurchase: state.request, quoteRegisteredResource: state.quote,
}) }));
const origin = 'http://127.0.0.1:3049'; const secret = 'isolated-resource-size-management-secret';
const body = JSON.stringify({ payload: 'a'.repeat(16_384 - 14) });
const entryLimit = 128 * 1024;
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
const jsonRequest = (path: string, input: unknown) => new Request(`${origin}${path}`, { method: 'POST',
  headers: { host: '127.0.0.1:3049', 'content-type': 'application/json', 'content-length': '2' }, body: JSON.stringify(input) });

it('supports a full 16 KiB Resource body through authenticated registration even with six-byte JSON escaping', async () => {
  vi.stubEnv('YOSH_MANAGEMENT_TOKEN', secret);
  const db = new DatabaseSync(':memory:'); const registry = new RuntimeResourceRegistry(db);
  state.add.mockImplementation(raw => registry.add(raw));
  const definition = { resourceId: 'body-limit', providerId: 'generic-provider', displayName: 'Generic resource',
    request: { url: 'https://generic.example/data', method: 'POST', access: 'https', headers: { 'content-type': 'application/json' }, body },
    network: MAINNET_NETWORK, mint: MAINNET_USDC_MINT, decimals: 6, recipientSource: 'live_challenge', maximumAmount: '10000' };
  const wire = JSON.stringify(definition).replace(/a/g, '\\u0061');
  expect(Buffer.byteLength(body)).toBe(16_384);
  expect(Buffer.byteLength(wire)).toBeGreaterThan(96 * 1024);
  expect(Buffer.byteLength(wire)).toBeLessThan(entryLimit);
  try {
    const response = await register(signedManagementRequest(`${origin}/api/app/resources`, secret,
      { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: wire }));
    expect(response.status).toBe(201);
    expect(registry.inspect('body-limit').definition.request.body).toBe(body);
  } finally { db.close(); }
});

it('accepts valid full-size dynamic JSON bodies at Agent purchase and quote entries', async () => {
  const input: unknown = JSON.parse(body);
  state.request.mockResolvedValue({ status: 'DENIED', paymentStatus: 'NOT_STARTED' });
  state.quote.mockResolvedValue({ paymentSent: false });
  expect((await purchase(jsonRequest('/api/agent/purchases', { requestId: 'body-limit', resourceId: 'registered', reason: 'fixture',
    request: { jsonBody: input } }))).status).toBe(200);
  expect((await quote(jsonRequest('/api/agent/quote', { resourceId: 'registered', sample: { jsonBody: input } }))).status).toBe(200);
  expect(state.request).toHaveBeenCalledOnce(); expect(state.quote).toHaveBeenCalledOnce();
});

it('counts streamed bytes for Resource envelopes while keeping both generic and Resource entries bounded', async () => {
  await expect(smallJson(jsonRequest('/resource', { body }), entryLimit)).resolves.toEqual({ body });
  await expect(smallJson(jsonRequest('/generic', { body }))).rejects.toThrow('过长');
  await expect(smallJson(jsonRequest('/resource', { body: 'x'.repeat(entryLimit) }), entryLimit)).rejects.toThrow('过长');
  vi.stubEnv('YOSH_MANAGEMENT_TOKEN', secret);
  const handler = vi.fn(async () => Response.json({ ready: true }));
  const request = signedManagementRequest(`${origin}/api/app/resources`, secret, { method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'content-length': '2' }, body: JSON.stringify({ body: 'x'.repeat(entryLimit) }) });
  expect((await managementRoute(request, true, handler, entryLimit)).status).toBe(400);
  expect(handler).not.toHaveBeenCalled();
});

import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeResourceRegistry, RuntimeResourceSchema } from '../../src/modules/resources/runtime-resource-registry';
import { X402ResourceSchema } from '../../src/modules/resources/http-resource';
import { MAINNET_NETWORK, MAINNET_USDC_MINT } from '../../src/modules/payment/payment-environment';
import { POST } from '../../src/app/api/app/resources/route';
import { signedManagementRequest } from '../helpers/management-request';

const state = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('../../src/modules/app/app-runtime', () => ({ appRuntime: () => ({ addRegisteredResource: state.add }) }));
const origin = 'http://127.0.0.1:3049';
const secret = 'isolated-method-safety-management-secret';
const definition = { resourceId: 'method-safety', providerId: 'unknown-provider', displayName: 'Unknown provider',
  request: { url: 'https://unknown.example/data', method: 'GET', access: 'https', headers: {} },
  network: MAINNET_NETWORK, mint: MAINNET_USDC_MINT, decimals: 6, recipientSource: 'live_challenge', maximumAmount: '10000' };
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

it.each(['HEAD', 'PUT', 'PATCH', 'DELETE'])('rejects %s at the authenticated management registration boundary', async method => {
  vi.stubEnv('YOSH_MANAGEMENT_TOKEN', secret);
  const db = new DatabaseSync(':memory:'); const registry = new RuntimeResourceRegistry(db);
  state.add.mockImplementation(raw => registry.add(raw));
  try {
    const response = await POST(signedManagementRequest(`${origin}/api/app/resources`, secret, { method: 'POST',
      headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ ...definition,
        request: { ...definition.request, method } }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(registry.list()).toEqual([]);
  } finally { db.close(); }
});

it('accepts only JSON POST registration and leaves unsupported historical definitions readable', () => {
  const unsupported = X402ResourceSchema.parse({ ...definition, request: { ...definition.request, method: 'DELETE' } });
  const db = new DatabaseSync(':memory:'); const registry = new RuntimeResourceRegistry(db);
  try {
    registry.initialize([unsupported]);
    expect(registry.inspect(definition.resourceId).definition).toEqual(unsupported);
    for (const request of [{ ...definition.request, method: 'POST' },
      { ...definition.request, method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }]) {
      expect(RuntimeResourceSchema.safeParse({ ...definition, request }).success).toBe(false);
    }
    expect(RuntimeResourceSchema.safeParse({ ...definition, request: { ...definition.request, method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{"query":"SOL"}' } }).success).toBe(true);
    expect(RuntimeResourceSchema.safeParse({ ...definition, request: { ...definition.request, method: 'POST',
      headers: { 'content-type': 'application/json' } }, requestInputs: { jsonBody: { query: { type: 'string', required: true, maxLength: 300 } } } }).success).toBe(true);
  } finally { db.close(); }
});

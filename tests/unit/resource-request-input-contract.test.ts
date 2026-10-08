import { expect, it } from 'vitest';
import { authorizedRequestInstance, assertAuthorizedRequestInstance, X402ResourceSchema } from '../../src/modules/resources/http-resource';
import { requestForPurchase } from '../../src/modules/purchases/request-registered-resource-purchase';

const base = { resourceId: 'input-contract', providerId: 'generic.example', network: 'solana:test',
  mint: '11111111111111111111111111111111', decimals: 6, recipient: '11111111111111111111111111111111' };
function getResource() {
  return X402ResourceSchema.parse({ ...base,
    request: { url: 'https://generic.example/search?fixed=stable', method: 'GET', access: 'https', headers: {} },
    requestInputs: { query: {
      account: { type: 'string', required: true, minLength: 2, maxLength: 12 },
      period: { type: 'string', required: true, enum: ['day', 'month'] },
      page: { type: 'string', required: false, enum: ['1', '2'] },
    } } });
}
function postResource() {
  return X402ResourceSchema.parse({ ...base,
    request: { url: 'https://generic.example/compute', method: 'POST', access: 'https',
      headers: { 'content-type': 'application/json' }, body: '{"mode":"safe","tenant":7}' },
    requestInputs: { jsonBody: {
      prompt: { type: 'string', required: true, minLength: 1, maxLength: 40 },
      count: { type: 'integer', required: true, minimum: 1, maximum: 4 },
      temperature: { type: 'number', required: false, minimum: 0, maximum: 1 },
      enabled: { type: 'boolean', required: false },
      options: { type: 'object', required: false, maxProperties: 2 },
      tags: { type: 'array', required: false, maxItems: 2 },
      omitted: { type: 'null', required: false },
    } } });
}

it('requires each declared GET field and preserves fixed query values', () => {
  const resource = getResource();
  expect(() => authorizedRequestInstance(resource, { query: { account: '123' } })).toThrow('RESOURCE_REQUEST_INPUT_REQUIRED');
  const request = authorizedRequestInstance(resource, { query: { account: '123', period: 'day' } });
  expect(request.url).toBe('https://generic.example/search?fixed=stable&account=123&period=day');
  expect(assertAuthorizedRequestInstance(resource, request)).toEqual(request);
});

it('rejects undeclared GET fields and values outside declared bounds', () => {
  const resource = getResource();
  expect(() => authorizedRequestInstance(resource, { query: { account: '123', period: 'day', extra: 'x' } })).toThrow('RESOURCE_REQUEST_INPUT_UNSUPPORTED');
  expect(() => authorizedRequestInstance(resource, { query: { account: '1', period: 'day' } })).toThrow('RESOURCE_REQUEST_INPUT_INVALID');
  expect(() => authorizedRequestInstance(resource, { query: { account: '123', period: 'year' } })).toThrow('RESOURCE_REQUEST_INPUT_INVALID');
});

it('validates dynamic JSON fields and merges immutable fixed body fields', () => {
  const resource = postResource();
  const request = authorizedRequestInstance(resource, { jsonBody: { prompt: 'lookup', count: 2, temperature: 0.5,
    enabled: true, options: { a: 1 }, tags: ['a'], omitted: null } });
  expect(JSON.parse(request.body!)).toEqual({ mode: 'safe', tenant: 7, prompt: 'lookup', count: 2,
    temperature: 0.5, enabled: true, options: { a: 1 }, tags: ['a'], omitted: null });
  expect(assertAuthorizedRequestInstance(resource, request)).toEqual(request);
});

it('rejects missing required, wrong JSON types, bounds and undeclared fields', () => {
  const resource = postResource();
  expect(() => authorizedRequestInstance(resource, { jsonBody: { prompt: 'lookup' } })).toThrow('RESOURCE_REQUEST_INPUT_REQUIRED');
  for (const invalid of [{ prompt: 7, count: 2 }, { prompt: 'lookup', count: '2' },
    { prompt: 'lookup', count: 2.5 }, { prompt: 'lookup', count: 5 }, { prompt: 'lookup', count: 2, enabled: 1 },
    { prompt: 'lookup', count: 2, options: [] }, { prompt: 'lookup', count: 2, tags: ['a', 'b', 'c'] },
    { prompt: 'lookup', count: 2, options: { a: 1, b: 2, c: 3 } }, { prompt: 'lookup', count: 2, omitted: false }])
    expect(() => authorizedRequestInstance(resource, { jsonBody: invalid })).toThrow('RESOURCE_REQUEST_INPUT_INVALID');
  expect(() => authorizedRequestInstance(resource, { jsonBody: { prompt: 'lookup', count: 2, extra: 'x' } })).toThrow('RESOURCE_REQUEST_INPUT_UNSUPPORTED');
  expect(() => authorizedRequestInstance(resource, { jsonBody: { prompt: 'lookup', count: 2, tenant: 8 } })).toThrow('RESOURCE_REQUEST_INPUT_UNSUPPORTED');
});

it('rechecks required fields and bounds on saved GET requests before execution', () => {
  const resource = getResource();
  const request = authorizedRequestInstance(resource, { query: { account: '123', period: 'day' } });
  for (const url of ['https://generic.example/search?fixed=stable&account=123',
    'https://generic.example/search?fixed=stable&account=123&period=year',
    'https://generic.example/search?fixed=stable&account=123&period=day&period=month',
    'https://generic.example/search?fixed=changed&account=123&period=day'])
    expect(() => assertAuthorizedRequestInstance(resource, { ...request, url })).toThrow();
});

it('rechecks JSON types, fixed fields and required fields on saved POST requests', () => {
  const resource = postResource();
  const request = authorizedRequestInstance(resource, { jsonBody: { prompt: 'lookup', count: 2 } });
  for (const body of [{ mode: 'safe', tenant: 7, prompt: 'lookup' },
    { mode: 'unsafe', tenant: 7, prompt: 'lookup', count: 2 },
    { mode: 'safe', tenant: 7, prompt: 'lookup', count: '2' },
    { mode: 'safe', prompt: 'lookup', count: 2 },
    { mode: 'safe', tenant: 7, prompt: 'lookup', count: 2, extra: 'x' }])
    expect(() => assertAuthorizedRequestInstance(resource, { ...request, body: JSON.stringify(body) })).toThrow();
});

it('routes Agent purchase input through the same declarative validator', () => {
  const resource = getResource();
  expect(() => requestForPurchase(resource, { requestId: 'typed', resourceId: resource.resourceId, reason: 'lookup',
    request: { query: { account: '123' } } })).toThrow('RESOURCE_REQUEST_INPUT_REQUIRED');
  const purchased = requestForPurchase(resource, { requestId: 'typed', resourceId: resource.resourceId, reason: 'lookup',
    request: { query: { account: '123', period: 'month' } } });
  expect(purchased.request).toEqual(authorizedRequestInstance(resource, { query: { account: '123', period: 'month' } }));
});

it('allows absent optional fields without making them required', () => {
  const resource = X402ResourceSchema.parse({ ...base,
    request: { url: 'https://generic.example/compute', method: 'POST', access: 'https', headers: { 'content-type': 'application/json' } },
    requestInputs: { jsonBody: { prompt: { type: 'string', required: false, maxLength: 40 } } } });
  expect(authorizedRequestInstance(resource, {}).body).toBe('{}');
});

it('preserves legacy allow-list semantics and never permits additional fixed-field overrides', () => {
  const resource = X402ResourceSchema.parse({ ...base,
    request: { url: 'https://generic.example/search?fixed=stable', method: 'GET', access: 'https', headers: {} },
    requestInputs: { query: ['account', 'period'] } });
  expect(() => authorizedRequestInstance(resource, {})).toThrow('RESOURCE_REQUEST_INPUT_REQUIRED');
  expect(authorizedRequestInstance(resource, { query: { account: '123' } }).url).toContain('account=123');
  expect(() => authorizedRequestInstance(resource, { query: { fixed: 'changed' } })).toThrow('RESOURCE_REQUEST_INPUT_UNSUPPORTED');
  const historical = X402ResourceSchema.parse({ ...resource, requestInputs: { query: ['fixed'] } });
  expect(() => authorizedRequestInstance(historical, { query: { fixed: 'changed' } })).toThrow();
});

it('rejects invalid descriptor definitions and non-string query descriptors', () => {
  const resource = getResource();
  for (const query of [{ a: { type: 'number', required: true } },
    { a: { type: 'string', minLength: 5, maxLength: 2 } },
    { a: { type: 'string', enum: ['x'], minimum: 1 } },
    { a: { type: 'string', maxLength: 301 } }])
    expect(X402ResourceSchema.safeParse({ ...resource, requestInputs: { query } }).success).toBe(false);
});

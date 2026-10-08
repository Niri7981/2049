import { IncomingMessage, type RequestOptions } from 'node:http';
import { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { beforeEach, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: transport.lookup }));
vi.mock('node:https', () => ({ request: transport.request }));
import { prepareSafeResourceFetch, safeResourceFetch } from '../../src/modules/resources/safe-resource-fetch';

let outgoingOptions: RequestOptions | undefined;
let outgoingUrl: URL | undefined;
let responseStatus: number;
let responseHeaders: Record<string, string>;
let responseBody: Buffer;

beforeEach(() => {
  vi.clearAllMocks();
  outgoingOptions = undefined;
  outgoingUrl = undefined;
  responseStatus = 200;
  responseHeaders = { 'content-type': 'application/json' };
  responseBody = Buffer.from('{"ok":true}');
  transport.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  transport.request.mockImplementation((url: URL, options: RequestOptions, onResponse: (incoming: IncomingMessage) => void) => {
    outgoingUrl = url;
    outgoingOptions = options;
    const outgoing = new PassThrough();
    // Native HTTPS is substituted only at the socket boundary: all production
    // URL validation, DNS classification, pinning and response bounds still run.
    outgoing.on('finish', () => {
      const incoming = new IncomingMessage(new Socket());
      incoming.statusCode = responseStatus;
      incoming.headers = responseHeaders;
      onResponse(incoming);
      incoming.push(responseBody);
      incoming.push(null);
    });
    return outgoing;
  });
});

it.each([
  ['127.0.0.1', 4], ['10.0.0.1', 4], ['169.254.169.254', 4],
  ['192.88.99.2', 4], ['3fff::1', 6], ['2001:db8::1', 6], ['fc00::1', 6],
] as const)('rejects public/non-global mixed DNS answers containing %s before any request', async (address, family) => {
  transport.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address, family }]);
  await expect(safeResourceFetch('https://merchant.example/api', {})).rejects.toThrow('RESOURCE_DESTINATION_UNSAFE');
  expect(transport.request).not.toHaveBeenCalled();
});

it.each(['192.88.99.2', '3fff::1', '100.64.0.1', 'fe80::1'])('rejects solely non-global DNS answer %s', async address => {
  transport.lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);
  await expect(safeResourceFetch('https://merchant.example/api', {})).rejects.toThrow('RESOURCE_DESTINATION_UNSAFE');
  expect(transport.request).not.toHaveBeenCalled();
});

it('pins the validated address across DNS rebinding without a second resolver call', async () => {
  const submit = await prepareSafeResourceFetch('https://merchant.example/api', { method: 'POST', body: '{"query":"test"}' });
  expect(transport.request).not.toHaveBeenCalled();
  transport.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  const response = await submit();
  expect(await response.json()).toEqual({ ok: true });
  expect(outgoingUrl?.href).toBe('https://merchant.example/api');
  expect(outgoingOptions?.method).toBe('POST');
  expect(outgoingOptions?.maxHeaderSize).toBe(16_384);
  expect(outgoingOptions?.signal).toBeInstanceOf(AbortSignal);
  const lookup = outgoingOptions?.lookup;
  expect(lookup).toBeTypeOf('function');
  if (!lookup) throw new Error('socket lookup missing');
  const one = vi.fn();
  lookup('merchant.example', { all: false }, one);
  expect(one).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  const all = vi.fn();
  lookup('merchant.example', { all: true }, all);
  expect(all).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
  expect(transport.lookup).toHaveBeenCalledOnce();
  expect(transport.lookup).toHaveBeenCalledWith('merchant.example', { all: true, verbatim: true });
});

it('pins a validated ordinary IPv6 address', async () => {
  transport.lookup.mockResolvedValue([{ address: '2606:4700:4700::1111', family: 6 }, { address: '8.8.8.8', family: 4 }]);
  await safeResourceFetch('https://merchant.example/api', {});
  const lookup = outgoingOptions?.lookup;
  if (!lookup) throw new Error('socket lookup missing');
  const callback = vi.fn();
  lookup('merchant.example', {}, callback);
  expect(callback).toHaveBeenCalledWith(null, '2606:4700:4700::1111', 6);
});

it('rejects an unsafe first DNS answer even when a later answer is public', async () => {
  transport.lookup.mockResolvedValue([{ address: '3fff::1', family: 6 }, { address: '8.8.8.8', family: 4 }]);
  await expect(safeResourceFetch('https://merchant.example/api', {})).rejects.toThrow('RESOURCE_DESTINATION_UNSAFE');
  expect(transport.request).not.toHaveBeenCalled();
});

it('does not allow fixture fetch injection in a production runtime', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  const fetcher = vi.fn<typeof fetch>();
  try {
    await expect(safeResourceFetch('https://merchant.example/api', {}, fetcher)).rejects.toThrow('RESOURCE_DESTINATION_UNSAFE');
    expect(fetcher).not.toHaveBeenCalled();
    expect(transport.lookup).not.toHaveBeenCalled();
    expect(transport.request).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});

it('does not follow redirects to private or alternate destinations', async () => {
  responseStatus = 302;
  responseHeaders = { location: 'https://127.0.0.1/internal' };
  const response = await safeResourceFetch('https://merchant.example/api', { redirect: 'follow' });
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe('https://127.0.0.1/internal');
  expect(transport.lookup).toHaveBeenCalledOnce();
  expect(transport.request).toHaveBeenCalledOnce();
});

it('retains the bounded response limit', async () => {
  responseBody = Buffer.alloc(262_145);
  await expect(safeResourceFetch('https://merchant.example/api', {})).rejects.toThrow('RESOURCE_RESPONSE_TOO_LARGE');
});

it('accepts a response exactly at the transport limit', async () => {
  responseBody = Buffer.alloc(262_144);
  const response = await safeResourceFetch('https://merchant.example/api', {});
  expect((await response.arrayBuffer()).byteLength).toBe(262_144);
});

it('fails closed when DNS gives no address', async () => {
  transport.lookup.mockResolvedValue([]);
  await expect(safeResourceFetch('https://merchant.example/api', {})).rejects.toThrow('RESOURCE_DESTINATION_UNSAFE');
  expect(transport.request).not.toHaveBeenCalled();
});

it('honors cancellation while resolving before opening a socket', async () => {
  transport.lookup.mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const pending = safeResourceFetch('https://merchant.example/api', { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toThrow('RESOURCE_DESTINATION_UNAVAILABLE');
  expect(transport.request).not.toHaveBeenCalled();
});

it.each(['http://merchant.example/api', 'https://user:password@merchant.example/api', 'https://merchant.example/api#fragment'])
('rejects unsafe URL %s before resolving DNS', async url => {
  await expect(safeResourceFetch(url, {})).rejects.toThrow('RESOURCE_DESTINATION_UNSAFE');
  expect(transport.lookup).not.toHaveBeenCalled();
  expect(transport.request).not.toHaveBeenCalled();
});

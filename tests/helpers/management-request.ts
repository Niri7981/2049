import { createHash, createHmac, randomBytes } from 'node:crypto';

/** Independent wire-format fixture; never sends the shared key. */
export function signedManagementRequest(url: string, secret: string, init: RequestInit = {},
  timestamp = Date.now(), nonce = randomBytes(32).toString('hex')) {
  const body = typeof init.body === 'string' ? init.body : '';
  const target = new URL(url);
  const method = init.method ?? 'GET';
  const digest = createHash('sha256').update(body).digest('hex');
  const message = ['2049-management-v1', method, target.pathname + target.search, String(timestamp), nonce, digest].join('\n');
  const headers = new Headers(init.headers);
  headers.set('host', target.host);
  headers.set('x-2049-timestamp', String(timestamp));
  headers.set('x-2049-nonce', nonce);
  headers.set('x-2049-body-sha256', digest);
  headers.set('x-2049-proof', createHmac('sha256', secret).update(message).digest('hex'));
  return new Request(url, { ...init, headers });
}

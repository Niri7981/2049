import type { HttpResourceRequest } from './http-resource';

/** Historical definitions stay readable, but cannot expand the Mainnet HTTP surface. */
export function assertSupportedMainnetResourceRequest(request: HttpResourceRequest, allowDynamicBody = false) {
  if (request.method !== 'GET' && request.method !== 'POST') throw new Error('MAINNET_RESOURCE_METHOD_UNSUPPORTED');
  if (request.method !== 'POST') return;
  if (request.headers['content-type'] !== 'application/json' || (request.body === undefined && !allowDynamicBody))
    throw new Error('RESOURCE_BODY_POLICY_INVALID');
  if (request.body !== undefined) {
    try { JSON.parse(request.body); }
    catch { throw new Error('RESOURCE_BODY_POLICY_INVALID'); }
  }
}

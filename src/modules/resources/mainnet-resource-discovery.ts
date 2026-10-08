import { z } from 'zod';
import { HttpResourceRequestSchema, ResourceRequestInputSchema, DeclarativeResourceRequestInputsSchema, resourceInputNames, authorizedRequestInstance } from './http-resource';
import { safeResourceFetch } from './safe-resource-fetch';
import { readPaymentRequiredHeader } from '../payment/x402-client';
import { validateResourceChallenge } from '../payment/resource-challenge';
import { resolvePaymentEnvironment } from '../payment/payment-environment';
import { MAX_ATOMIC_AMOUNT } from '../authority/atomic-money';
import { registeredResourceSummary } from './registered-resources';
import { assertPostRequestApproval, postRequestReview } from './post-request-authorization';
import { ResourceRegistryError } from './runtime-resource-registry';
export { isPublicResourceAddress } from './public-resource-address';

export const DiscoveryInput = z.object({
  url: z.string().max(2048), method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.object({ accept: z.string().max(2048).optional(), 'content-type': z.literal('application/json').optional() }).strict().optional(),
  body: z.string().max(16_384).optional(),
  requestInputs: DeclarativeResourceRequestInputsSchema.optional(),
  sample: ResourceRequestInputSchema.optional(),
}).strict();

/** Compatibility entry point for non-paying header inspection. */
export async function unpaidChallengeHeaders(url: string, method: 'GET' | 'POST', body?: string, headers: Record<string, string> = {}) {
  const response = await safeResourceFetch(url, { method, headers: { accept: 'application/json', ...headers },
    ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (response.status !== 402) throw new ResourceRegistryError('RESOURCE_DISCOVERY_UNAVAILABLE');
  return response.headers;
}

/** Prepare the same concrete instance that will be transmitted, without external I/O. */
export function prepareDiscovery(raw: unknown) {
  const input = DiscoveryInput.parse(raw);
  const request = HttpResourceRequestSchema.parse({ url: input.url, method: input.method, access: 'https',
    headers: input.headers ?? (input.method === 'POST' ? { accept: 'application/json', 'content-type': 'application/json' } : { accept: 'application/json' }),
    ...(input.body === undefined ? {} : { body: input.body }) });
  if (request.method === 'POST') {
    if (request.headers['content-type'] !== 'application/json' || (request.body === undefined && !resourceInputNames(input.requestInputs?.jsonBody).length))
      throw new ResourceRegistryError('RESOURCE_DISCOVERY_UNAVAILABLE');
    if (request.body !== undefined) {
      try { JSON.parse(request.body); } catch { throw new ResourceRegistryError('RESOURCE_DISCOVERY_UNAVAILABLE'); }
    }
  }
  const environment = resolvePaymentEnvironment({ YOSH_EXECUTION_MODE: 'live_mainnet' });
  const policy = { resourceId: 'discovery', providerId: 'discovery', request,
    ...(input.requestInputs ? { requestInputs: input.requestInputs } : {}),
    network: environment.network, mint: environment.asset.mint, decimals: 6 as const,
    recipientSource: 'live_challenge' as const, maximumAmount: MAX_ATOMIC_AMOUNT.toString() };
  const instance = authorizedRequestInstance(policy, input.sample ?? {});
  return { input, request, environment, policy, instance, review: postRequestReview(instance) };
}

/** Approval is a separate trusted management argument, never an Agent input field. */
export async function discoverResource(raw: unknown, readHeaders: typeof unpaidChallengeHeaders = unpaidChallengeHeaders, approvedHash?: string) {
  const { input, request, environment, policy, instance } = prepareDiscovery(raw);
  assertPostRequestApproval(instance, approvedHash);
  try {
    const headers = readHeaders !== unpaidChallengeHeaders && instance.method === 'GET' && instance.body === undefined
      ? await readHeaders(instance.url, 'GET')
      : await readHeaders(instance.url, instance.method as 'GET' | 'POST', instance.body, instance.headers);
    const encoded = headers.get('payment-required');
    if (!encoded || encoded.length > 16_384) throw new Error('Invalid payment header');
    const { quote } = validateResourceChallenge(readPaymentRequiredHeader(encoded), { ...policy, request: instance }, environment);
    return { ...registeredResourceSummary({ ...policy, baseAmount: quote.amount, maximumAmount: quote.amount }),
      payTo: quote.payTo, feePayer: quote.extra.feePayer, maxTimeoutSeconds: quote.maxTimeoutSeconds,
      paymentSent: false, authoritativeAtPurchase: false, recovery: { kind: 'none' },
      proposal: { request, ...(input.requestInputs ? { requestInputs: input.requestInputs } : {}),
        network: environment.network, mint: environment.asset.mint, decimals: 6,
        recipientSource: 'live_challenge', baseAmount: quote.amount, maximumAmount: quote.amount },
      sample: input.sample ?? {},
      notice: 'Discovery is an unpaid snapshot. The user must register and authorize a bounded Spend Grant. Every purchase obtains a fresh quote.' };
  } catch { throw new ResourceRegistryError('RESOURCE_DISCOVERY_UNAVAILABLE'); }
}

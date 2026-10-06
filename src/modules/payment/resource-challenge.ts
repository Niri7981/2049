import type { PaymentRequirements } from '@x402/core/types';
import { X402ChallengeSchema, X402ResourceSchema, SolanaPublicKeySchema, type X402Challenge, type X402Resource } from '../resources/http-resource';
import { PositiveAtomicAmountSchema } from '../authority/atomic-money';
import { validatePaymentEnvironment, type PaymentEnvironment } from './payment-environment';
import { readPaymentRequiredHeader } from './x402-client';
import { hash } from '../authority/authority-policy';
import { HttpResourceRequestSchema, type HttpResourceRequest } from '../resources/http-resource';
import { validateDeliveryCapability, type DeliveryRecoveryCapability } from '../resources/delivery-capability';

export function resourcePaymentBinding(environment: PaymentEnvironment, buyer: string, request: HttpResourceRequest, challenge: X402Challenge, recovery?: DeliveryRecoveryCapability) {
  // Execution permission belongs to the immutable ledger scope. Presentation or
  // switching to simulation must not prevent read-only recovery of a paid Devnet request.
  return hash(['x402-http-v1', environment.cluster, environment.genesisHash, environment.network,
    { network: environment.asset.network, mint: environment.asset.mint, tokenProgram: environment.asset.tokenProgram, decimals: environment.asset.decimals },
    SolanaPublicKeySchema.parse(buyer), HttpResourceRequestSchema.parse(request), X402ChallengeSchema.parse(challenge),
    ...(recovery ? [validateDeliveryCapability(recovery, request)] : [])]);
}

/** Optional quote memo follows the SDK's UTF-8 limit; absence lets the SDK generate it. */
export function validX402Memo(value: unknown) {
  return value === undefined || (typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 256
    && new TextDecoder().decode(new TextEncoder().encode(value)) === value);
}

function validatedResource(declared: X402Resource, environment: PaymentEnvironment) {
  const { mode, cluster, genesisHash, rpcUrl, network, asset, isProduction, productionExecutionEnabled } = environment;
  const validated = validatePaymentEnvironment({ mode, cluster, genesisHash, rpcUrl, network, asset, isProduction, productionExecutionEnabled });
  const resource = X402ResourceSchema.parse(declared);
  if (resource.deliveryRecovery) validateDeliveryCapability(resource.deliveryRecovery, resource.request);
  if (resource.network !== validated.network || resource.mint !== validated.asset.mint || resource.decimals !== validated.asset.decimals
    || (validated.isProduction && resource.request.access !== 'https')) throw new Error('RESOURCE_ENVIRONMENT_MISMATCH');
  return { resource, validated };
}

export function validateResourceChallenge(raw: unknown, declared: X402Resource, environment: PaymentEnvironment): { challenge: X402Challenge; quote: PaymentRequirements } {
  const { resource, validated } = validatedResource(declared, environment);
  const challenge = X402ChallengeSchema.parse(raw);
  const challengeUrl = resource.request.access === 'test_loopback' && challenge.resource.url.startsWith('/') && !challenge.resource.url.startsWith('//')
    ? new URL(challenge.resource.url, resource.request.url).href : challenge.resource.url;
  if (challengeUrl !== resource.request.url || challenge.accepts.length !== 1) throw new Error('INVALID_X402_QUOTE');
  const quote = challenge.accepts[0];
  if (quote.scheme !== 'exact' || quote.network !== validated.network || quote.asset !== validated.asset.mint
    || quote.payTo !== resource.recipient || !PositiveAtomicAmountSchema.safeParse(quote.amount).success
    || (resource.amount !== undefined && quote.amount !== resource.amount)
    || !Number.isSafeInteger(quote.maxTimeoutSeconds) || quote.maxTimeoutSeconds <= 0 || quote.maxTimeoutSeconds > 300
    || !SolanaPublicKeySchema.safeParse(quote.extra.feePayer).success || !validX402Memo(quote.extra.memo)) throw new Error('INVALID_X402_QUOTE');
  // If discovery metadata declares an HTTP method, it cannot override this approved request.
  const bazaar = challenge.extensions?.bazaar;
  if (bazaar && typeof bazaar === 'object' && !Array.isArray(bazaar)) {
    const info = bazaar.info;
    const input = info && typeof info === 'object' && !Array.isArray(info) ? info.input : undefined;
    const method = input && typeof input === 'object' && !Array.isArray(input) ? input.method : undefined;
    if (method !== undefined && method !== resource.request.method) throw new Error('RESOURCE_METHOD_MISMATCH');
  }
  return { challenge, quote };
}

/** One fresh challenge for the exact approved request; no redirect or unsigned retry. */
export async function fetchResourceChallenge(resource: X402Resource, environment: PaymentEnvironment, fetcher: typeof fetch = fetch) {
  const { resource: declared } = validatedResource(resource, environment);
  const { url, method, headers, body } = declared.request;
  const response = await fetcher(url, { method, headers, ...(body === undefined ? {} : { body }), redirect: 'error', signal: AbortSignal.timeout(10_000) });
  try {
    if (response.status !== 402 || (response.url && response.url !== url)) throw new Error('INVALID_X402_QUOTE');
    const parsed = validateResourceChallenge(readPaymentRequiredHeader(response.headers.get('PAYMENT-REQUIRED') ?? ''), declared, environment);
    return { endpoint: url, request: declared.request, ...parsed };
  } finally { await response.body?.cancel(); }
}

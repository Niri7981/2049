import type { X402Challenge } from '../../src/modules/resources/http-resource';
import { expect, it, vi, afterEach } from 'vitest';
import { resolvePaymentEnvironment } from '../../src/modules/payment/payment-environment';
import { validateResourceChallenge, fetchResourceChallenge } from '../../src/modules/payment/resource-challenge';
import { X402ResourceSchema } from '../../src/modules/resources/http-resource';
import { encodePaymentRequiredHeader } from '@x402/core/http';

const environment = resolvePaymentEnvironment({ YOSH_EXECUTION_MODE: 'live_mainnet' });
const declared = { resourceId: 'you-web-search', providerId: 'you.com', displayName: 'You.com Web Search',
  network: environment.network, mint: environment.asset.mint, decimals: 6,
  recipientSource: 'live_challenge', baseAmount: '5000', maximumAmount: '5000',
  request: { url: 'https://api.you.com/v1/search', method: 'GET', access: 'https', headers: { accept: 'application/json' } },
  deliveryRecovery: { kind: 'none' } };
const recipient = '11111111111111111111111111111111';
const sponsor = 'ComputeBudget111111111111111111111111111111';
function challenge(): X402Challenge {
  return { x402Version: 2 as const, resource: { url: declared.request.url }, accepts: [
    { scheme: 'exact', network: 'eip155:8453', asset: '0xasset', amount: '5000', payTo: '0xrecipient', maxTimeoutSeconds: 600, extra: {} },
    { scheme: 'exact', network: environment.network, asset: environment.asset.mint, amount: '5000', payTo: recipient,
      maxTimeoutSeconds: 600, extra: { feePayer: sponsor } } ] };
}
afterEach(() => vi.restoreAllMocks());
it('registers endpoint policy without recipient or fee payer; accepts a live matching Solana alternative', () => {
  const resource = X402ResourceSchema.parse(declared);
  expect(resource).not.toHaveProperty('recipient');
  expect(validateResourceChallenge(challenge(), resource, environment).quote.payTo).toBe(recipient);
});
it.each(['price', 'network', 'mint', 'recipient', 'fee-payer', 'duplicate', 'url'] as const)('fails closed on invalid challenge: %s', condition => {
  const resource = X402ResourceSchema.parse(declared); const required = challenge();
  const selected = required.accepts[1];
  if (condition === 'price') selected.amount = '5001';
  if (condition === 'network') selected.network = 'solana:wrong';
  if (condition === 'mint') selected.asset = sponsor;
  if (condition === 'recipient') selected.payTo = 'invalid';
  if (condition === 'fee-payer') selected.extra = { feePayer: 'invalid' };
  if (condition === 'duplicate') required.accepts.push(selected);
  if (condition === 'url') required.resource.url += '/other';
  expect(() => validateResourceChallenge(required, resource, environment)).toThrow();
});
it('reads a challenge with execution disabled using only one unsigned request', async () => {
  const resource = X402ResourceSchema.parse(declared);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 402,
    headers: { 'payment-required': encodePaymentRequiredHeader(challenge()) } }));
  const result = await fetchResourceChallenge(resource, environment, fetcher);
  expect(result.quote.amount).toBe('5000');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error', headers: { accept: 'application/json' } });
});

it('rejects an unbounded challenge recipient registration and inconsistent price limits', () => {
  expect(X402ResourceSchema.safeParse({ ...declared, maximumAmount: undefined }).success).toBe(false);
  expect(X402ResourceSchema.safeParse({ ...declared, baseAmount: '5001' }).success).toBe(false);
  expect(X402ResourceSchema.safeParse({ ...declared, recipient }).success).toBe(false);
});

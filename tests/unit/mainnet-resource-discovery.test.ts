import { encodePaymentRequiredHeader } from '@x402/core/http';
import { expect, it, vi } from 'vitest';
import { discoverResource, prepareDiscovery, isPublicResourceAddress } from '../../src/modules/resources/mainnet-resource-discovery';
import { MAINNET_NETWORK, MAINNET_USDC_MINT } from '../../src/modules/payment/payment-environment';
it('non-paying discovery projects a validated challenge without persisting transaction instructions', async () => {
  const read = vi.fn().mockResolvedValue(new Headers({ 'payment-required': encodePaymentRequiredHeader({ x402Version: 2,
    resource: { url: 'https://api.you.com/v1/search' }, accepts: [{ scheme: 'exact', network: MAINNET_NETWORK, asset: MAINNET_USDC_MINT,
      amount: '5000', payTo: '11111111111111111111111111111111', maxTimeoutSeconds: 600, extra: { feePayer: 'ComputeBudget111111111111111111111111111111' } }] }) }));
  const result = await discoverResource({ url: 'https://api.you.com/v1/search' }, read);
  expect(read).toHaveBeenCalledWith('https://api.you.com/v1/search', 'GET');
  expect(result).toMatchObject({ baseAmount: '5000', maximumAmount: '5000', paymentSent: false, recipient: null, authoritativeAtPurchase: false });
  await expect(discoverResource({ url: 'https://localhost/data' }, read)).rejects.toThrow();
  const postInput = { url: 'https://api.you.com/v1/search', method: 'POST',
    requestInputs: { jsonBody: { prompt: { type: 'string', required: true, maxLength: 300 } } }, sample: { jsonBody: { prompt: 'synthetic' } } };
  const post = await discoverResource(postInput, read, prepareDiscovery(postInput).review.requestHash);
  expect(post).toMatchObject({ method: 'POST', paymentSent: false,
    proposal: { requestInputs: { jsonBody: { prompt: { type: 'string', required: true, maxLength: 300 } } } }, sample: { jsonBody: { prompt: 'synthetic' } } });
  expect(read).toHaveBeenLastCalledWith('https://api.you.com/v1/search', 'POST', '{"prompt":"synthetic"}',
    { accept: 'application/json', 'content-type': 'application/json' });
});
it.each(['127.0.0.1','10.1.2.3','169.254.169.254','100.64.1.2','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])('blocks non-public discovery addresses %s', address => expect(isPublicResourceAddress(address)).toBe(false));
it('accepts public addresses and fails closed on absent or oversized challenges', async () => {
  expect(isPublicResourceAddress('8.8.8.8')).toBe(true); expect(isPublicResourceAddress('2606:4700:4700::1111')).toBe(true);
  for (const header of ['', 'x'.repeat(17000)]) await expect(discoverResource({ url: 'https://example.com/search' }, async () => new Headers({ 'payment-required': header }))).rejects.toThrow('RESOURCE_DISCOVERY_UNAVAILABLE');
});

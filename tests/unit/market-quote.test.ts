import { expect, it, vi } from 'vitest';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { readMarketQuote } from '../../src/modules/purchases/market-quote';
import { loadPaymentConfig } from '../../src/modules/payment/payment-config';
import { MARKET_RESOURCE } from '../../src/modules/payment/solana-payment';

const config = loadPaymentConfig({ DEMO_BUYER_PUBLIC_KEY: 'BSEDrH4umjwCKUL5TqYm69ffsSjwWcV2BXQkczVp1F52',
  DEMO_MERCHANT_PUBLIC_KEY: '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs' });
const quote = { scheme: 'exact', network: config.network, asset: config.mint, amount: '10000', payTo: config.merchant, maxTimeoutSeconds: 300, extra: {} };
const response = (changes = {}) => new Response(null, { status: 402, headers: {
  'PAYMENT-REQUIRED': encodePaymentRequiredHeader({ x402Version: 2, resource: { url: MARKET_RESOURCE }, accepts: [{ ...quote, ...changes }] }),
} });

it('reads the official HTTP quote without payment headers or a signing operation', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
  expect(await readMarketQuote('http://127.0.0.1:3049', config, fetcher)).toMatchObject({ amount: '10000', decimals: 6,
    asset: config.mint, network: config.network, paymentEnabled: false, confirmation: 'NOT_IMPLEMENTED' });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  expect(fetcher.mock.calls[0][1]?.headers).toBeUndefined();
});
it.each([{ amount: '20000' }, { payTo: config.buyer }, { network: 'eip155:8453' },
  { asset: config.buyer }, { maxTimeoutSeconds: 301 }, { maxTimeoutSeconds: 0 }])('rejects changed quote conditions %j', async changes => {
  await expect(readMarketQuote('http://127.0.0.1:3049', config, vi.fn<typeof fetch>().mockResolvedValue(response(changes)))).rejects.toThrow();
});

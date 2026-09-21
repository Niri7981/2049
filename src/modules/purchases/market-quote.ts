import { loadPaymentConfig, PAYMENT_AMOUNT, DEVNET_NETWORK, type PaymentConfig } from '../payment/payment-config';
import { readPaymentRequiredHeader } from '../payment/x402-client';
import { MARKET_RESOURCE } from '../payment/solana-payment';
import { paymentEndpoint } from './approved-payment';

/** Display-only quote; approval and budget reservation still belong to the purchase service. */
export async function readMarketQuote(origin: string, config: PaymentConfig = loadPaymentConfig(), fetcher: typeof fetch = fetch) {
  if (config.network !== DEVNET_NETWORK) throw new Error('INVALID_NETWORK');
  const response = await fetcher(paymentEndpoint(origin), { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  try {
    if (response.status !== 402) throw new Error('INVALID_QUOTE');
    const required = readPaymentRequiredHeader(response.headers.get('PAYMENT-REQUIRED') ?? '');
    const quote = required.accepts[0];
    if (required.resource?.url !== MARKET_RESOURCE || required.accepts.length !== 1 || quote.scheme !== 'exact' ||
      quote.network !== config.network || quote.asset !== config.mint || quote.payTo !== config.merchant ||
      quote.amount !== PAYMENT_AMOUNT || quote.maxTimeoutSeconds <= 0 || quote.maxTimeoutSeconds > 300) throw new Error('INVALID_QUOTE');
    return { api: MARKET_RESOURCE, network: quote.network, asset: quote.asset, decimals: 6,
      amount: quote.amount, display: '0.01 test USDC', payTo: quote.payTo, testEnvironment: true,
      isDemoSnapshot: true, paymentEnabled: false, confirmation: 'NOT_IMPLEMENTED' };
  } finally { await response.body?.cancel(); }
}

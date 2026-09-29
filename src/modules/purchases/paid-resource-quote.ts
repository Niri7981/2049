import { address } from '@solana/kit';
import type { PaymentRequirements } from '@x402/core/types';
import { readPaymentRequiredHeader } from '../payment/x402-client';
import { DEVNET_NETWORK, DEVNET_USDC_MINT, loadPaymentConfig, type PaymentConfig } from '../payment/payment-config';
import { PAID_RESOURCES, paidResource, type PaidResourceId } from '../resources/paid-resources';
import { paymentEndpointForResource } from './approved-payment';

export function displayAmount(amount: string) {
  const units = BigInt(amount);
  const whole = units / 1_000_000n;
  const fraction = String(units % 1_000_000n).padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${whole}.${fraction} test USDC`;
}

/** Always reads a fresh, server-issued HTTP 402; the descriptor contains no price. */
export async function fetchPaidResourceQuote(id: PaidResourceId, origin: string, config: PaymentConfig, fetcher: typeof fetch = fetch): Promise<{ endpoint: string; quote: PaymentRequirements }> {
  if (config.cluster !== 'devnet' || config.network !== DEVNET_NETWORK || config.mint !== DEVNET_USDC_MINT) throw new Error('UNSUPPORTED_PURCHASE_NETWORK');
  const resource = paidResource(id);
  const endpoint = paymentEndpointForResource(origin, id);
  const response = await fetcher(endpoint, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  try {
    if (response.status !== 402) throw new Error('INVALID_X402_QUOTE');
    const required = readPaymentRequiredHeader(response.headers.get('PAYMENT-REQUIRED') ?? '');
    if (required.resource?.url !== resource.path || required.accepts.length !== 1) throw new Error('INVALID_X402_QUOTE');
    const quote = required.accepts[0];
    const amount = Number(quote.amount);
    if (quote.scheme !== 'exact' || quote.network !== config.network || quote.asset !== config.mint || quote.payTo !== config.merchant ||
      !/^[1-9]\d*$/.test(quote.amount) || !Number.isSafeInteger(amount) ||
      typeof quote.extra?.memo !== 'string' || !/^day4:[A-Za-z0-9_-]{22}$/.test(quote.extra.memo) ||
      typeof quote.extra?.feePayer !== 'string' || quote.maxTimeoutSeconds <= 0 || quote.maxTimeoutSeconds > 300) throw new Error('INVALID_X402_QUOTE');
    address(quote.extra.feePayer);
    return { endpoint, quote };
  } finally { await response.body?.cancel(); }
}

export async function readPaidResourceQuotes(origin: string, config: PaymentConfig = loadPaymentConfig(), fetcher: typeof fetch = fetch) {
  const resources = await Promise.all((Object.keys(PAID_RESOURCES) as PaidResourceId[]).map(async id => {
    const descriptor = paidResource(id);
    const { quote } = await fetchPaidResourceQuote(id, origin, config, fetcher);
    return { resourceId: id, name: descriptor.name, resourceUrl: descriptor.path, amount: quote.amount,
      decimals: 6, display: displayAmount(quote.amount), asset: quote.asset, network: quote.network, payTo: quote.payTo };
  }));
  return { resources, testEnvironment: true };
}

import { address } from "@solana/kit";
import { assertPaymentExecutionEnabled, PaymentEnvironmentError, paymentEndpoint, resolvePaymentEnvironment,
  type PaymentEnvironment, type PurchaseExecutionMode } from './payment-environment';
export { DEVNET_GENESIS, DEVNET_NETWORK, DEVNET_USDC_MINT, MAINNET_GENESIS, MAINNET_NETWORK,
  MAINNET_USDC_MINT, TOKEN_PROGRAM } from './payment-environment';
export const PAYMENT_AMOUNT = "10000";

export type PaymentConfig = PaymentEnvironment & Readonly<{
  /** Compatibility projection of asset.mint; not an independently configured asset. */
  mint: string;
  buyer: string;
  merchant: string;
  facilitatorUrl: string;
}>;

function publicKey(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  try { return address(value); }
  catch { throw new Error(`${name} must be a valid Solana public key`); }
}

/** Resolve identity before touching wallet configuration. Mainnet has no Demo fallback. */
export function loadPaymentConfig(env: Record<string, string | undefined> = process.env,
  defaultMode: PurchaseExecutionMode = 'live_devnet'): PaymentConfig {
  const environment = resolvePaymentEnvironment(env, defaultMode);
  if (environment.mode === 'live_mainnet') assertPaymentExecutionEnabled(environment);
  const buyer = publicKey(env.DEMO_BUYER_PUBLIC_KEY, "DEMO_BUYER_PUBLIC_KEY");
  const merchant = publicKey(env.DEMO_MERCHANT_PUBLIC_KEY, "DEMO_MERCHANT_PUBLIC_KEY");
  if (buyer === merchant) throw new Error("Buyer and merchant must be different wallets");
  const localnet = environment.cluster === 'localnet';
  if (localnet && !env.X402_FACILITATOR_URL) throw new Error("X402_FACILITATOR_URL is required for localnet");
  const facilitatorUrl = paymentEndpoint(env.X402_FACILITATOR_URL || "https://x402.org/facilitator", "X402_FACILITATOR_URL", localnet);
  return Object.freeze({ ...environment, get mint() { return environment.asset.mint; }, buyer, merchant, facilitatorUrl });
}

export function assertPaymentConfigExecutionEnabled(config: PaymentConfig) {
  assertPaymentExecutionEnabled(config);
  if (config.mint !== config.asset.mint) throw new PaymentEnvironmentError('INVALID_PAYMENT_ENVIRONMENT', 'asset projection');
}

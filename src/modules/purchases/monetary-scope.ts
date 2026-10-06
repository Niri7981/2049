import { z } from 'zod';
import { hash } from '../authority/authority-policy';
import { DEVNET_NETWORK, DEVNET_USDC_MINT, MAINNET_NETWORK, MAINNET_USDC_MINT, type PurchaseExecutionMode } from '../payment/payment-environment';

/** Stable backend wallet identity. This identifies the fixed item, never its secret. */
export const PRODUCT_MAINNET_WALLET_ID = 'keychain:com.yosh.wallet.mainnet.v1:consumer-wallet-mainnet-v1';
export const PRODUCT_TEST_WALLET_ID = 'keychain:com.2049.wallet.v1:consumer-wallet-v1';
export const LEGACY_TEST_WALLET_ID = 'legacy:test-wallet-unverified';
export type MonetaryEnvironment = PurchaseExecutionMode | 'legacy_test';
export const MonetaryScopeSchema = z.object({
  environment: z.enum(['simulated', 'live_devnet', 'live_mainnet', 'legacy_test']),
  walletIdentity: z.string().min(1).max(200), network: z.string().min(1).max(200),
  assetId: z.string().min(1).max(200), assetDecimals: z.number().int().min(0).max(255),
}).strict().superRefine((scope, ctx) => {
  const production = scope.network === MAINNET_NETWORK || scope.assetId === MAINNET_USDC_MINT;
  if ((scope.environment === 'live_mainnet') !== production
    || (production && (scope.network !== MAINNET_NETWORK || scope.assetId !== MAINNET_USDC_MINT || scope.assetDecimals !== 6
      || [PRODUCT_TEST_WALLET_ID, LEGACY_TEST_WALLET_ID].includes(scope.walletIdentity)))) {
    ctx.addIssue({ code: 'custom', message: 'MONETARY_SCOPE_MISMATCH' });
  }
});
export type MonetaryScope = Readonly<z.infer<typeof MonetaryScopeSchema>>;
export function monetaryScope(environment: MonetaryEnvironment, walletIdentity: string,
  network = environment === 'live_mainnet' ? MAINNET_NETWORK : DEVNET_NETWORK,
  assetId = environment === 'live_mainnet' ? MAINNET_USDC_MINT : DEVNET_USDC_MINT, assetDecimals = 6): MonetaryScope {
  return Object.freeze(MonetaryScopeSchema.parse({ environment, walletIdentity, network, assetId, assetDecimals }));
}
export function monetaryScopeId(scope: MonetaryScope) {
  const value = MonetaryScopeSchema.parse(scope);
  return hash([value.environment, value.walletIdentity, value.network, value.assetId, value.assetDecimals]);
}

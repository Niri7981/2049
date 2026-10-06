import { address } from '@solana/kit';
import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2, USDC_DEVNET_ADDRESS, USDC_MAINNET_ADDRESS } from '@x402/svm';
import { z } from 'zod';
import { resolveYoshConfiguration, type YoshEnvironment } from '../app/yosh-configuration';

export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const DEVNET_NETWORK = SOLANA_DEVNET_CAIP2;
export const MAINNET_NETWORK = SOLANA_MAINNET_CAIP2;
export const DEVNET_USDC_MINT = USDC_DEVNET_ADDRESS;
export const MAINNET_USDC_MINT = USDC_MAINNET_ADDRESS;
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// The existing purchase mode is shared with the ledger; no second mode enum.
export const PurchaseExecutionModeSchema = z.enum(['simulated', 'live_devnet', 'live_mainnet']);
export type PurchaseExecutionMode = z.infer<typeof PurchaseExecutionModeSchema>;
const publicKey = z.string().refine(value => { try { address(value); return true; } catch { return false; } });
const network = z.templateLiteral(['solana:', z.string()]);
const EnvironmentSchema = z.object({
  mode: PurchaseExecutionModeSchema,
  cluster: z.enum(['devnet', 'localnet', 'mainnet-beta']),
  genesisHash: publicKey.nullable(),
  rpcUrl: z.string(),
  network,
  asset: z.object({ network, mint: publicKey, tokenProgram: publicKey, decimals: z.literal(6),
    symbol: z.literal('USDC'), displayLabel: z.string() }).strict(),
  isProduction: z.boolean(),
  productionExecutionEnabled: z.boolean().default(false),
}).strict();
export type PaymentEnvironment = Readonly<Omit<z.infer<typeof EnvironmentSchema>, 'asset'> & {
  asset: Readonly<z.infer<typeof EnvironmentSchema>['asset']>;
}>;

export class PaymentEnvironmentError extends Error {
  constructor(readonly code: 'INVALID_PAYMENT_ENVIRONMENT' | 'PAYMENT_CONFIGURATION_CONFLICT' | 'MAINNET_EXECUTION_DISABLED' | 'SIMULATED_EXECUTION_DISABLED', readonly setting: string) {
    // Never echo RPC URLs or raw configuration values, which may contain credentials.
    super(`${code}: ${setting}`);
  }
}

export function paymentEndpoint(value: string, name: string, localOnly: boolean): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new PaymentEnvironmentError('INVALID_PAYMENT_ENVIRONMENT', `${name} must be a valid URL`); }
  if (localOnly) {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
      throw new PaymentEnvironmentError('INVALID_PAYMENT_ENVIRONMENT', `${name} must use an exact loopback hostname`);
    }
  } else if (url.protocol !== 'https:') {
    throw new PaymentEnvironmentError('INVALID_PAYMENT_ENVIRONMENT', `${name} must use HTTPS`);
  }
  return url.toString().replace(/\/$/, '');
}

/** Configuration identity is static; a custom HTTPS RPC still needs genesis verification at preflight. */
export function validatePaymentEnvironment(input: unknown): PaymentEnvironment {
  const parsed = EnvironmentSchema.safeParse(input);
  if (!parsed.success) throw new PaymentEnvironmentError('INVALID_PAYMENT_ENVIRONMENT', 'environment shape');
  const value = parsed.data;
  const mainnet = value.cluster === 'mainnet-beta';
  const localnet = value.cluster === 'localnet';
  const invalid = (setting: string): never => { throw new PaymentEnvironmentError('INVALID_PAYMENT_ENVIRONMENT', setting); };
  if ((value.mode === 'live_mainnet') !== mainnet || (mainnet && value.mode === 'simulated')) invalid('mode/cluster');
  if (value.isProduction !== mainnet) invalid('production/test identity');
  if (value.productionExecutionEnabled && !mainnet) invalid('production execution mode');
  if (value.asset.network !== value.network) invalid('asset network');
  if (value.asset.tokenProgram !== TOKEN_PROGRAM) invalid('token program');
  const displayLabel = mainnet ? 'USDC' : value.mode === 'simulated' ? 'Simulated test USDC' : localnet ? 'local test USDC' : 'test USDC';
  if (value.asset.displayLabel !== displayLabel) invalid('asset display label');
  const rpcUrl = paymentEndpoint(value.rpcUrl, 'RPC', localnet);
  const rpcHost = new URL(rpcUrl).hostname;
  if ((mainnet && rpcHost === 'api.devnet.solana.com')
    || (!mainnet && ['api.mainnet-beta.solana.com', 'api.mainnet.solana.com'].includes(rpcHost))) invalid('RPC cluster');
  if (!localnet) {
    if (value.genesisHash !== (mainnet ? MAINNET_GENESIS : DEVNET_GENESIS)) invalid('genesis');
    if (value.network !== (mainnet ? MAINNET_NETWORK : DEVNET_NETWORK)) invalid('network');
    if (value.asset.mint !== (mainnet ? MAINNET_USDC_MINT : DEVNET_USDC_MINT)) invalid('asset mint');
  } else {
    if ([DEVNET_NETWORK, MAINNET_NETWORK].includes(value.network)) invalid('local network');
    if (value.network !== 'solana:localnet' && !/^solana:[1-9A-HJ-NP-Za-km-z]{32}$/.test(value.network)) invalid('local network');
    if (value.genesisHash !== null && ([DEVNET_GENESIS, MAINNET_GENESIS].includes(value.genesisHash)
      || (value.network !== 'solana:localnet' && value.network !== `solana:${value.genesisHash.slice(0, 32)}`))) invalid('local genesis');
    if (value.asset.mint === MAINNET_USDC_MINT) invalid('local asset mint');
  }
  return Object.freeze({ ...value, rpcUrl, asset: Object.freeze(value.asset) });
}

function compatible(current: string | undefined, legacy: string | undefined, setting: string) {
  if (current !== undefined && legacy !== undefined && current !== legacy) {
    throw new PaymentEnvironmentError('PAYMENT_CONFIGURATION_CONFLICT', setting);
  }
  return current ?? legacy;
}

/** App defaults to simulation. Legacy payment-only CLI callers explicitly supply live_devnet as their default. */
export function resolvePaymentEnvironment(env: YoshEnvironment = process.env, defaultMode: PurchaseExecutionMode = 'simulated'): PaymentEnvironment {
  const configuration = resolveYoshConfiguration(env);
  const hasLegacySwitch = env.YOSH_ENABLE_DEVNET_PURCHASES !== undefined || env.APP2049_ENABLE_DEVNET_PURCHASES !== undefined;
  const legacyMode = configuration.enableDevnetPurchases ? 'live_devnet' : 'simulated';
  const mode = configuration.executionMode ?? (hasLegacySwitch ? legacyMode : defaultMode);
  if (configuration.executionMode !== undefined && hasLegacySwitch && mode !== legacyMode) {
    throw new PaymentEnvironmentError('PAYMENT_CONFIGURATION_CONFLICT', 'execution mode / ENABLE_DEVNET_PURCHASES');
  }
  const cluster = env.SOLANA_CLUSTER ?? (mode === 'live_mainnet' ? 'mainnet-beta' : 'devnet');
  const localnet = cluster === 'localnet';
  const mainnet = cluster === 'mainnet-beta';
  const legacyRpc = localnet ? env.SOLANA_LOCALNET_RPC_URL : mainnet ? env.SOLANA_MAINNET_RPC_URL : env.SOLANA_DEVNET_RPC_URL;
  const rpcUrl = compatible(env.SOLANA_RPC_URL, legacyRpc, 'RPC')
    ?? (localnet ? 'http://127.0.0.1:8899' : mainnet ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');
  const genesisHash = env.SOLANA_GENESIS_HASH ?? (localnet ? null : mainnet ? MAINNET_GENESIS : DEVNET_GENESIS);
  const resolvedNetwork = compatible(env.SOLANA_NETWORK, localnet ? env.SOLANA_LOCALNET_NETWORK : undefined, 'network')
    ?? (localnet ? 'solana:localnet' : mainnet ? MAINNET_NETWORK : DEVNET_NETWORK);
  const mint = compatible(env.USDC_MINT, localnet ? env.LOCAL_USDC_MINT : undefined, 'mint')
    ?? (localnet ? undefined : mainnet ? MAINNET_USDC_MINT : DEVNET_USDC_MINT);
  return validatePaymentEnvironment({ mode, cluster, genesisHash, rpcUrl, network: resolvedNetwork,
    asset: { network: resolvedNetwork, mint, tokenProgram: TOKEN_PROGRAM, decimals: 6, symbol: 'USDC',
      displayLabel: mainnet ? 'USDC' : mode === 'simulated' ? 'Simulated test USDC' : localnet ? 'local test USDC' : 'test USDC' },
    isProduction: mainnet, productionExecutionEnabled: configuration.enableMainnetExecution });
}

export function assertPaymentExecutionEnabled(environment: PaymentEnvironment) {
  const { mode, cluster, genesisHash, rpcUrl, network, asset, isProduction, productionExecutionEnabled } = environment;
  const validated = validatePaymentEnvironment({ mode, cluster, genesisHash, rpcUrl, network, asset, isProduction, productionExecutionEnabled });
  if (validated.mode === 'live_mainnet' && !validated.productionExecutionEnabled) {
    throw new PaymentEnvironmentError('MAINNET_EXECUTION_DISABLED', 'explicit production enablement required');
  }
  if (validated.mode === 'simulated') throw new PaymentEnvironmentError('SIMULATED_EXECUTION_DISABLED', 'simulated mode cannot sign or submit');
}

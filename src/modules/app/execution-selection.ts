import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { resolveYoshConfiguration, type YoshEnvironment } from './yosh-configuration';
import { PurchaseExecutionModeSchema, resolvePaymentEnvironment, type PurchaseExecutionMode } from '../payment/payment-environment';

const Selection = z.object({ version: z.literal(1), mode: PurchaseExecutionModeSchema }).strict();

/** Persist only selection. Wallets, authority and production enablement are never settings of this screen. */
export function readExecutionSelection(directory: string): PurchaseExecutionMode | undefined {
  try { return Selection.parse(JSON.parse(readFileSync(join(directory, 'execution-selection.json'), 'utf8'))).mode; }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw new Error('EXECUTION_SELECTION_INVALID');
  }
}
export function writeExecutionSelection(directory: string, mode: PurchaseExecutionMode) {
  const path = join(directory, 'execution-selection.json');
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(Selection.parse({ version: 1, mode })), { mode: 0o600 });
  renameSync(temporary, path);
}

/** Select a pinned profile; never carry test identity or cross-network overrides into Mainnet. */
export function executionProfile(source: YoshEnvironment, mode: PurchaseExecutionMode): Record<string, string | undefined> {
  const configuration = resolveYoshConfiguration(source);
  const original = resolvePaymentEnvironment(source);
  const profile = { ...source };
  for (const key of ['YOSH_EXECUTION_MODE', 'APP2049_EXECUTION_MODE', 'YOSH_ENABLE_DEVNET_PURCHASES',
    'APP2049_ENABLE_DEVNET_PURCHASES', 'YOSH_ENABLE_MAINNET_EXECUTION', 'APP2049_ENABLE_MAINNET_EXECUTION']) delete profile[key];
  profile.YOSH_EXECUTION_MODE = mode;
  // Selecting Mainnet does not grant production enablement: retain only the existing operator flag.
  profile.YOSH_ENABLE_MAINNET_EXECUTION = mode === 'live_mainnet' && configuration.enableMainnetExecution ? '1' : '0';
  const cluster = mode === 'live_mainnet' ? 'mainnet-beta' : 'devnet';
  if (cluster !== original.cluster) {
    for (const key of ['SOLANA_CLUSTER', 'SOLANA_RPC_URL', 'SOLANA_GENESIS_HASH', 'SOLANA_NETWORK', 'USDC_MINT']) delete profile[key];
  }
  if (mode === 'live_mainnet') for (const key of Object.keys(profile)) if (key.startsWith('DEMO_')) delete profile[key];
  resolvePaymentEnvironment(profile);
  return profile;
}

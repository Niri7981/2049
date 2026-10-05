export type YoshEnvironment = Readonly<Record<string, string | undefined>>;

const settingNames = [
  'PORT', 'REPOSITORY_ROOT', 'NODE_PATH', 'DATA_DIR', 'MANAGEMENT_TOKEN',
  'CODEX_PATH', 'CARD_MEMBER_ID', 'MCP_PROVIDER', 'ENABLE_DEVNET_PURCHASES',
  'USE_PRODUCT_WALLET', 'ENABLE_LEGACY_DEMO_TASKS',
  'EXECUTION_MODE',
] as const;
type SettingName = typeof settingNames[number];

export class YoshConfigurationError extends Error {
  readonly code: 'CONFIGURATION_CONFLICT' | 'INVALID_CONFIGURATION';
  readonly setting: SettingName;
  constructor(code: 'CONFIGURATION_CONFLICT' | 'INVALID_CONFIGURATION', setting: SettingName) {
    // Configuration values can contain credentials or private paths. Report only the key.
    super(code === 'CONFIGURATION_CONFLICT'
      ? `Conflicting Yosh configuration for YOSH_${setting}.`
      : `Invalid Yosh configuration for YOSH_${setting}.`);
    this.code = code;
    this.setting = setting;
  }
}

function enabled(value: string | undefined, setting: SettingName) {
  if (value !== undefined && value !== '' && value !== '0' && value !== '1') {
    throw new YoshConfigurationError('INVALID_CONFIGURATION', setting);
  }
  return value === '1';
}

/** Old launch records remain readable; ambiguous identities or storage never select a winner. */
export function resolveYoshConfiguration(env: YoshEnvironment = process.env) {
  const values: Partial<Record<SettingName, string>> = {};
  for (const setting of settingNames) {
    const current = env[`YOSH_${setting}`];
    const legacy = env[`APP2049_${setting}`];
    if (current !== undefined && legacy !== undefined && current !== legacy) {
      throw new YoshConfigurationError('CONFIGURATION_CONFLICT', setting);
    }
    const value = current ?? legacy;
    if (value !== undefined) values[setting] = value;
  }
  if (values.PORT !== undefined && (!/^\d+$/.test(values.PORT)
    || String(Number(values.PORT)) !== values.PORT || !Number.isSafeInteger(Number(values.PORT))
    || Number(values.PORT) < 1024 || Number(values.PORT) > 65535)) {
    throw new YoshConfigurationError('INVALID_CONFIGURATION', 'PORT');
  }
  for (const setting of ['DATA_DIR', 'REPOSITORY_ROOT', 'NODE_PATH', 'CODEX_PATH'] as const) {
    const value = values[setting];
    if (value !== undefined && (!isAbsolute(value) || value.includes('\0'))) {
      throw new YoshConfigurationError('INVALID_CONFIGURATION', setting);
    }
  }
  return {
    port: values.PORT,
    repositoryRoot: values.REPOSITORY_ROOT,
    nodePath: values.NODE_PATH,
    dataDirectory: values.DATA_DIR,
    managementToken: values.MANAGEMENT_TOKEN,
    codexPath: values.CODEX_PATH,
    cardMemberId: values.CARD_MEMBER_ID,
    mcpProvider: values.MCP_PROVIDER,
    enableDevnetPurchases: enabled(values.ENABLE_DEVNET_PURCHASES, 'ENABLE_DEVNET_PURCHASES'),
    executionMode: values.EXECUTION_MODE,
    useProductWallet: enabled(values.USE_PRODUCT_WALLET, 'USE_PRODUCT_WALLET'),
    enableLegacyDemoTasks: enabled(values.ENABLE_LEGACY_DEMO_TASKS, 'ENABLE_LEGACY_DEMO_TASKS'),
  };
}
import { isAbsolute } from 'node:path';

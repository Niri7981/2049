import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readProductConfiguration, writeProductionExecutionSetting } from '../../src/modules/app/product-configuration';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
function directory() { const path = mkdtempSync(join(tmpdir(), 'yosh-product-config-')); directories.push(path); return path; }

it('creates a private product setting and retains registered resources and facilitator on upgrade', () => {
  const path = directory();
  writeProductionExecutionSetting(path, false);
  expect(readProductConfiguration(path)).toEqual({ YOSH_ENABLE_MAINNET_EXECUTION: '0' });
  const file = join(path, 'product-configuration.json');
  writeFileSync(file, JSON.stringify({ YOSH_ENABLE_MAINNET_EXECUTION: '0', YOSH_MAINNET_RESOURCES: '[]',
    X402_FACILITATOR_URL: 'https://facilitator.example' }), { mode: 0o600 });
  writeProductionExecutionSetting(path, true);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ YOSH_ENABLE_MAINNET_EXECUTION: '1',
    YOSH_MAINNET_RESOURCES: '[]', X402_FACILITATOR_URL: 'https://facilitator.example' });
});

it('refuses a linked or public product file without replacing it', () => {
  const path = directory(); const other = join(path, 'other.json');
  writeFileSync(other, '{}', { mode: 0o600 });
  symlinkSync(other, join(path, 'product-configuration.json'));
  expect(() => writeProductionExecutionSetting(path, true)).toThrow('PRODUCT_CONFIGURATION_INVALID');
  expect(readFileSync(other, 'utf8')).toBe('{}');
});

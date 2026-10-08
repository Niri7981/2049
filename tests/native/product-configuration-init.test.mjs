import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

const initializer = resolve('scripts/ensure-product-configuration.mjs');

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'yosh-product-config-'));
  try { run(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

function initialize(directory, options = {}) {
  return execFileSync(process.execPath, [initializer, directory], {
    cwd: options.cwd ?? directory,
    env: { ...process.env, ...options.env },
    stdio: 'pipe',
  });
}

test('fresh installation ignores developer dotenv and starts with production execution disabled', () => fixture(directory => {
  writeFileSync(join(directory, '.env.local'), [
    'YOSH_ENABLE_MAINNET_EXECUTION=1',
    'X402_FACILITATOR_URL=https://developer.example',
    'YOSH_MAINNET_RESOURCES=[{"resourceId":"developer"}]',
  ].join('\n'));
  initialize(directory, { env: {
    YOSH_ENABLE_MAINNET_EXECUTION: '1',
    X402_FACILITATOR_URL: 'https://ambient.example',
  } });
  const file = join(directory, 'product-configuration.json');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { YOSH_ENABLE_MAINNET_EXECUTION: '0' });
  assert.equal(statSync(file).mode & 0o777, 0o600);
}));

test('upgrade preserves existing grant-related settings and facilitator override byte for byte', () => fixture(directory => {
  const file = join(directory, 'product-configuration.json');
  const existing = '{"YOSH_ENABLE_MAINNET_EXECUTION":"1","YOSH_MAINNET_RESOURCES":"[]","X402_FACILITATOR_URL":"https://facilitator.example/x402"}\n';
  writeFileSync(file, existing, { mode: 0o600 });
  initialize(directory);
  assert.equal(readFileSync(file, 'utf8'), existing);
}));

test('installer refuses symlinked or public configuration instead of replacing it', () => fixture(directory => {
  const target = join(directory, 'target.json');
  const file = join(directory, 'product-configuration.json');
  writeFileSync(target, '{}', { mode: 0o600 });
  symlinkSync(target, file);
  assert.throws(() => initialize(directory));
  rmSync(file);
  writeFileSync(file, '{}', { mode: 0o644 });
  assert.throws(() => initialize(directory));
  assert.equal(readFileSync(file, 'utf8'), '{}');
  chmodSync(file, 0o600);
}));

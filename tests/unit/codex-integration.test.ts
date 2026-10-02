import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { CodexIntegration } from '../../src/modules/mcp/codex-integration';

const memberId = '11111111-1111-4111-8111-111111111111';
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), '2049-codex-')); directories.push(directory);
  const entries = new Map<string, unknown>([['unrelated', { name: 'unrelated', enabled: true, transport: { type: 'stdio', command: '/other' } }]]);
  const run = vi.fn(async (args: string[]) => {
    if (args[1] === 'list') return JSON.stringify([...entries.values()]);
    const name = args[2];
    if (args[1] === 'remove') { entries.delete(name); return ''; }
    const separator = args.indexOf('--');
    const env: Record<string, string> = {};
    for (let i = 3; i < separator; i += 2) {
      const pair = args[i + 1]; const index = pair.indexOf('=');
      env[pair.slice(0, index)] = pair.slice(index + 1);
    }
    entries.set(name, { name, enabled: true, transport: { type: 'stdio', command: args[separator + 1], args: args.slice(separator + 2), env } });
    return '';
  });
  const adapter = new CodexIntegration(directory, memberId, { root: resolve('.'), node: process.execPath, run });
  return { directory, adapter, entries, run };
}

it('installs only a dedicated member-specific Codex configuration, without credentials or management permissions', async () => {
  const { adapter, directory, entries } = fixture();
  await adapter.connect();
  const config = entries.get(adapter.serverName);
  expect(config).toMatchObject({ enabled: true, transport: { type: 'stdio', command: process.execPath,
    env: { APP2049_CARD_MEMBER_ID: memberId, APP2049_DATA_DIR: directory, APP2049_MCP_PROVIDER: 'codex' } } });
  expect(JSON.stringify(config)).not.toMatch(/token|MANAGEMENT|PRIVATE_KEY/);
  expect(entries.get('unrelated')).toMatchObject({ transport: { command: '/other' } });
  expect(adapter.configured).toBe(true);
  expect(statSync(adapter.recordPath).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(adapter.recordPath, 'utf8'))).toMatchObject({ provider: 'codex', memberId });
});

it('is idempotent and recovers saved configuration across backend restart', async () => {
  const { adapter, directory, run } = fixture();
  await adapter.connect(); await adapter.connect();
  expect(run.mock.calls.filter(([args]) => args[1] === 'add')).toHaveLength(1);
  const restarted = new CodexIntegration(directory, memberId, { root: resolve('.'), node: process.execPath, run });
  expect(restarted.configured).toBe(true);
  await restarted.connect();
  expect(run.mock.calls.filter(([args]) => args[1] === 'add')).toHaveLength(1);
  await restarted.disconnect();
  expect(restarted.configured).toBe(false);
});

it('refuses a colliding server and preserves user edits on disconnect', async () => {
  const { adapter, entries, run } = fixture();
  entries.set(adapter.serverName, { name: adapter.serverName, enabled: true, transport: { type: 'stdio', command: '/user-owned' } });
  await expect(adapter.connect()).rejects.toMatchObject({ code: 'CODEX_CONFIG_CONFLICT' });
  expect(run.mock.calls.some(([args]) => args[1] === 'add')).toBe(false);
  entries.delete(adapter.serverName);
  await adapter.connect();
  const original = entries.get(adapter.serverName);
  entries.set(adapter.serverName, { ...Object(original), enabled: false });
  await expect(adapter.disconnect()).rejects.toMatchObject({ code: 'CODEX_CONFIG_CONFLICT' });
  expect(entries.has(adapter.serverName)).toBe(true);
  expect(entries.has('unrelated')).toBe(true);
});

it('does not publish raw Codex failures or claim configuration succeeded', async () => {
  const { adapter, run } = fixture();
  run.mockRejectedValue(new Error('secret-config-and-token'));
  await expect(adapter.connect()).rejects.toMatchObject({ code: 'CODEX_CONFIG_FAILED' });
  expect(adapter.configured).toBe(false);
});

it('isolates a damaged receipt from backend startup and refuses edits without ownership evidence', async () => {
  const { adapter, directory, run } = fixture();
  await adapter.connect();
  writeFileSync(adapter.recordPath, '{invalid');
  const restarted = new CodexIntegration(directory, memberId, { root: resolve('.'), node: process.execPath, run });
  expect(restarted.configured).toBe(false);
  await expect(restarted.connect()).rejects.toMatchObject({ code: 'CODEX_CONFIG_FAILED' });
  await expect(restarted.disconnect()).rejects.toMatchObject({ code: 'CODEX_CONFIG_FAILED' });
});

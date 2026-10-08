import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { CodexIntegration } from '../../src/modules/mcp/codex-integration';

const memberId = '11111111-1111-4111-8111-111111111111';
const directories: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'yosh-codex-')); directories.push(directory);
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
    env: { YOSH_CARD_MEMBER_ID: memberId, YOSH_DATA_DIR: directory, YOSH_MCP_PROVIDER: 'codex' } } });
  expect(JSON.stringify(config)).not.toMatch(/token|MANAGEMENT|PRIVATE_KEY/);
  expect(entries.get('unrelated')).toMatchObject({ transport: { command: '/other' } });
  expect(adapter.configured).toBe(true);
  expect(statSync(adapter.recordPath).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(adapter.recordPath, 'utf8'))).toMatchObject({ provider: 'codex', memberId });
});

it('migrates only its owned canonical entry from repository scripts to the packaged bridge', async () => {
  const { adapter, directory, entries, run } = fixture();
  await adapter.connect();
  const runtime = join(directory, 'packaged-runtime');
  mkdirSync(runtime);
  writeFileSync(join(runtime, 'mcp.cjs'), '// fixture');
  vi.stubEnv('YOSH_PACKAGED_RUNTIME_DIR', runtime);
  const reopened = new CodexIntegration(directory, memberId, { root: resolve('.'), node: process.execPath, run });
  expect(reopened.needsMigration).toBe(true);
  await reopened.migrateLegacy();
  expect(entries.get(reopened.serverName)).toMatchObject({ transport: { args: [join(runtime, 'mcp.cjs')] } });
  expect(existsSync(reopened.migrationPath)).toBe(false);
  expect(reopened.needsMigration).toBe(false);
  expect(run.mock.calls.filter(([args]) => args[1] === 'remove')).toHaveLength(1);
});

function legacyFixture() {
  const f = fixture();
  const config = { name: f.adapter.legacyServerName, enabled: true, transport: {
    type: 'stdio', command: process.execPath,
    args: ['--import', resolve('node_modules/tsx/dist/loader.mjs'), resolve('scripts/mcp.ts')],
    env: { APP2049_CARD_MEMBER_ID: memberId, APP2049_DATA_DIR: f.directory, APP2049_MCP_PROVIDER: 'codex' },
  } };
  f.entries.set(config.name, config);
  mkdirSync(dirname(f.adapter.recordPath), { recursive: true });
  writeFileSync(f.adapter.recordPath, JSON.stringify({ provider: 'codex', memberId, config }), { mode: 0o600 });
  const restart = () => new CodexIntegration(f.directory, memberId, { root: resolve('.'), node: process.execPath, run: f.run });
  return { ...f, adapter: restart(), config, restart };
}

it('renames an owned legacy entry without changing the member or exposing duplicate entries', async () => {
  const { adapter, entries, run, restart } = legacyFixture();
  entries.set('2049-research', { name: '2049-research', enabled: true, transport: { type: 'stdio', command: '/user' } });
  expect(adapter.needsMigration).toBe(true);
  await adapter.migrateLegacy();
  expect(entries.has(adapter.legacyServerName)).toBe(false);
  expect(entries.get(adapter.serverName)).toMatchObject({ transport: { env: { YOSH_CARD_MEMBER_ID: memberId } } });
  expect(entries.has('2049-research')).toBe(true);
  const mutations = run.mock.calls.filter(([args]) => ['add', 'remove'].includes(args[1])).map(([args]) => args[1]);
  expect(mutations).toEqual(['remove', 'add']);
  expect(existsSync(adapter.migrationPath)).toBe(false);
  expect(restart().configured).toBe(true);
  await restart().migrateLegacy();
  expect(run.mock.calls.filter(([args]) => args[1] === 'add')).toHaveLength(1);
});

it('retains ownership evidence and resumes after a crash between removal and installation', async () => {
  const { adapter, entries, run, restart } = legacyFixture();
  const invoke = run.getMockImplementation()!;
  run.mockImplementation(async args => {
    if (args[1] === 'add') throw new Error('interrupted');
    return invoke(args);
  });
  await expect(adapter.migrateLegacy()).rejects.toMatchObject({ code: 'CODEX_CONFIG_FAILED' });
  expect(entries.has(adapter.legacyServerName)).toBe(false);
  expect(existsSync(adapter.migrationPath)).toBe(true);
  expect(JSON.parse(readFileSync(adapter.recordPath, 'utf8')).memberId).toBe(memberId);
  run.mockImplementation(invoke);
  await restart().migrateLegacy();
  expect(entries.has(adapter.serverName)).toBe(true);
  expect(existsSync(adapter.migrationPath)).toBe(false);
});

it('resumes a crash after canonical installation without installing twice', async () => {
  const { adapter, entries, run, restart } = legacyFixture();
  const invoke = run.getMockImplementation()!;
  run.mockImplementation(async args => {
    const result = await invoke(args);
    if (args[1] === 'add') throw new Error('crash before read-back');
    return result;
  });
  await expect(adapter.migrateLegacy()).rejects.toMatchObject({ code: 'CODEX_CONFIG_FAILED' });
  expect(entries.has(adapter.serverName)).toBe(true);
  run.mockImplementation(invoke);
  await restart().migrateLegacy();
  expect(run.mock.calls.filter(([args]) => args[1] === 'add')).toHaveLength(1);
});

it('preserves modified legacy entries and rejects a canonical collision before removal', async () => {
  const { adapter, config, entries, run } = legacyFixture();
  entries.set(config.name, { ...config, enabled: false });
  await expect(adapter.migrateLegacy()).rejects.toMatchObject({ code: 'CODEX_CONFIG_CONFLICT' });
  entries.set(config.name, config);
  entries.set(adapter.serverName, { name: adapter.serverName, enabled: true, transport: { type: 'stdio', command: '/other' } });
  await expect(adapter.migrateLegacy()).rejects.toMatchObject({ code: 'CODEX_CONFIG_CONFLICT' });
  expect(run.mock.calls.some(([args]) => ['remove', 'add'].includes(args[1]))).toBe(false);
});

it('does not infer ownership of an old UUID entry without a receipt', async () => {
  const { adapter, config, entries, run, restart } = legacyFixture();
  rmSync(adapter.recordPath);
  await expect(restart().connect()).rejects.toMatchObject({ code: 'CODEX_CONFIG_CONFLICT' });
  expect(entries.get(config.name)).toEqual(config);
  expect(run.mock.calls.some(([args]) => args[1] === 'remove')).toBe(false);
});

it('fails closed on a corrupt migration journal without changing either host entry', async () => {
  const { adapter, run } = legacyFixture();
  writeFileSync(adapter.migrationPath, '{broken');
  await expect(adapter.migrateLegacy()).rejects.toMatchObject({ code: 'CODEX_CONFIG_FAILED' });
  expect(run.mock.calls.some(([args]) => ['remove', 'add'].includes(args[1]))).toBe(false);
});

it('rejects a receipt and host entry bound to another member or data store', async () => {
  const { adapter, config, entries, run, restart } = legacyFixture();
  const incorrect = { ...config, transport: { ...config.transport,
    env: { ...config.transport.env, APP2049_DATA_DIR: '/another/store' } } };
  entries.set(config.name, incorrect);
  writeFileSync(adapter.recordPath, JSON.stringify({ provider: 'codex', memberId, config: incorrect }));
  await expect(restart().migrateLegacy()).rejects.toMatchObject({ code: 'CODEX_CONFIG_CONFLICT' });
  expect(run.mock.calls.some(([args]) => ['add', 'remove'].includes(args[1]))).toBe(false);
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

import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { acquireDataDirectoryOwnership, DataDirectoryInUseError } from '../../src/modules/app/data-directory-owner';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

it('holds one data-directory owner across ports and symlink aliases, then recovers after a crash', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'yosh-owner-'));
  directories.push(directory);
  const alias = `${directory}-alias`;
  symlinkSync(directory, alias);
  directories.push(alias);
  const script = `const { appRuntime } = await import('./src/modules/app/app-runtime.ts');
    try { appRuntime(); console.log('OWNED'); setInterval(() => {}, 1000); }
    catch (error) { console.error(error instanceof Error ? error.message : 'UNKNOWN'); process.exitCode = 2; }`;
  const start = (dataDirectory: string, port: string) => spawn(process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    { cwd: process.cwd(), env: { ...process.env, APP2049_DATA_DIR: dataDirectory, APP2049_PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] });

  const first = start(directory, '3049');
  try {
    const [output] = await once(first.stdout!, 'data');
    expect(String(output)).toContain('OWNED');
    const second = start(alias, '3050');
    let errors = '';
    second.stderr!.on('data', chunk => { errors += String(chunk); });
    const [status] = await once(second, 'exit');
    expect(status).toBe(2);
    expect(errors).toContain('DATA_DIRECTORY_IN_USE');
    expect(() => acquireDataDirectoryOwnership(directory)).toThrow(DataDirectoryInUseError);
    first.kill('SIGKILL');
    await once(first, 'exit');
    const owner = acquireDataDirectoryOwnership(alias);
    expect(readdirSync(directory)).toContain('app-ledger.sqlite');
    owner.release();
    const again = acquireDataDirectoryOwnership(directory);
    again.release();
  } finally {
    if (first.exitCode === null && first.signalCode === null) {
      first.kill('SIGKILL');
      await once(first, 'exit');
    }
  }
}, 15_000);

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const nodeExecutable = join(root, `build.noindex/node-runtime/node-v24.21.0-darwin-${process.arch}/bin/node`);
const temporary = mkdtempSync(join(tmpdir(), 'yosh-management-security-'));
const secret = randomBytes(32).toString('base64url');
const hash = body => createHash('sha256').update(body).digest('hex');
const mac = message => createHmac('sha256', secret).update(message).digest();
const executable = join(temporary, 'management-security');
const trackedBackendPIDs = new Set();
const bundle = join(temporary, 'Yosh.app');
const packaged = join(bundle, 'Contents/Resources/Runtime');
mkdirSync(join(packaged, 'backend'), { recursive: true });
mkdirSync(join(bundle, 'Contents/MacOS'), { recursive: true });
cpSync(join(root, '.next/standalone'), join(packaged, 'backend'), { recursive: true });
copyFileSync(nodeExecutable, join(bundle, 'Contents/MacOS/YoshBackendNode'));
chmodSync(join(bundle, 'Contents/MacOS/YoshBackendNode'), 0o755);
writeFileSync(join(packaged, 'mcp.cjs'), '// unused fixture bridge');
const environment = { ...process.env, YOSH_TEST_BUNDLE_URL: bundle, APP2049_MANAGEMENT_TOKEN: secret, APP2049_DATA_DIR: temporary,
  APP2049_REPOSITORY_ROOT: root, APP2049_ENABLE_DEVNET_PURCHASES: '0' };

function child(command, args, env = environment) {
  const process = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  process.stdout.on('data', data => { output += data; });
  process.stderr.on('data', data => { output += data; });
  const done = new Promise((resolveRun, reject) => {
    process.on('error', reject);
    process.on('close', (code, signal) => {
      if (code === 0) resolveRun(output);
      else reject(new Error(`${command} failed (${code ?? signal}): ${output}`));
    });
  });
  // Orphan simulation intentionally interrupts a native test process; consume its expected failure.
  void done.catch(() => {});
  return { process, done, output: () => output };
}

async function fixture(mode, port = 0) {
  let captured = 0;
  let lifecycle = 0;
  let cancelled = false;
  let written = 0;
  const server = createServer(async (request, response) => {
    captured++;
    if (request.url === '/api/app/lifecycle') lifecycle++;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    assert.ok(!JSON.stringify(request.headers).includes(secret));
    assert.ok(!request.url.includes(secret) && !body.includes(secret));
    assert.equal(request.headers.authorization, undefined);
    const nonce = request.headers['x-2049-nonce'];
    const canonical = ['2049-management-v1', request.method, request.url,
      request.headers['x-2049-timestamp'], nonce, hash(body)].join('\n');
    assert.equal(request.headers['x-2049-body-sha256'], hash(body));
    assert.ok(timingSafeEqual(Buffer.from(request.headers['x-2049-proof'], 'hex'), mac(canonical)));
    const bytes = Buffer.from(JSON.stringify({ ready: true, service: '2049', pid: process.pid, dataDirectory: realpathSync(temporary) }));
    const reply = ['2049-management-response-v1', mode === 'nonce' ? '0'.repeat(64) : nonce, '200', hash(bytes)].join('\n');
    response.on('close', () => { cancelled = !response.writableFinished; });
    if (mode === 'stall') return;
    if (mode === 'drip') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write(' ');
      const timer = setInterval(() => { written++; response.write(' '); }, 40);
      response.on('close', () => clearInterval(timer));
      return;
    }
    if (mode === 'oversized') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write(Buffer.alloc(4097, 32));
      return;
    }
    if (mode === 'content-length') {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': '5000' });
      response.flushHeaders();
      response.write(' ');
      return;
    }
    response.writeHead(mode === 'status' ? 201 : 200, { 'content-type': 'application/json',
      ...(['fake', 'fake-owner', 'credential-cache', 'credential-denied', 'credential-invalid'].includes(mode)
        ? {} : { 'x-2049-response-proof': mac(reply).toString('hex') }) });
    response.end(mode === 'tamper' ? Buffer.from('{"ready":false}') : bytes);
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveListen); });
  try {
    const result = await child(executable, [mode], { ...environment, APP2049_PORT: String(server.address().port) }).done;
    process.stdout.write(`${mode}: ${result}`);
    assert.ok(captured > 0);
    if (mode === 'fake-owner') {
      assert.equal(lifecycle, 0, 'unverified owner must never receive shutdown');
      assert.ok(server.listening, 'unrelated listener must survive');
    }
    if (['stall', 'drip', 'oversized', 'content-length'].includes(mode)) {
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
      assert.equal(cancelled, true, 'URLSession must cancel the connection');
      if (mode === 'drip') assert.ok(written < 30, 'incoming bytes must not extend the deadline');
    }
  } finally { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); }
}

async function freePort() {
  const server = createServer();
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function actualApplication(app) {
  const quit = join(temporary, 'native-quit');
  await child('swiftc', ['-swift-version', '6', '-parse-as-library', 'tests/native/NativeApplicationQuit.swift', '-o', quit]).done;
  const port = await freePort();
  const env = { ...environment, APP2049_PORT: String(port) };
  // Production App must ignore this ordinary env override and use its Keychain item.
  let launchNumber = 0;
  const launch = () => child(join(app, 'Contents/MacOS/Yosh'), [], { ...env,
    APP2049_MANAGEMENT_TOKEN: `ignored-environment-identity-${++launchNumber}-${randomBytes(32).toString('hex')}` });
  const listener = async () => Number((await child('lsof', ['-t', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).done.catch(() => '')).trim());
  const waitForBackend = async (owner, previous = 0) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const pid = await listener();
      if (pid > 0 && pid !== previous) {
        trackedBackendPIDs.add(pid);
        const parent = Number((await child('ps', ['-o', 'ppid=', '-p', String(pid)]).done).trim());
        assert.equal(parent, owner.process.pid, 'test backend must belong to the App we launched');
        return pid;
      }
      if (owner.process.exitCode !== null || owner.process.signalCode !== null) throw new Error('Native App exited before readiness');
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    throw new Error('Native App startup did not complete (Keychain/UI access is not automated)');
  };
  const stop = async owner => {
    await child(quit, [String(owner.process.pid)]).done;
    await owner.done;
    assert.equal(await listener(), 0, 'normal App quit must release its backend port');
  };
  let owner = launch();
  try {
    await waitForBackend(owner);
    const duplicate = launch();
    await duplicate.done;
    assert.equal(owner.process.exitCode, null);
    await stop(owner);
    owner = launch();
    const oldPID = await waitForBackend(owner);
    owner.process.kill('SIGKILL'); // Only the test-owned native App; backend must survive.
    await owner.done.catch(() => {});
    process.kill(oldPID, 0);
    owner = launch();
    const newPID = await waitForBackend(owner, oldPID);
    assert.throws(() => process.kill(oldPID, 0), { code: 'ESRCH' });
    await stop(owner);
    console.log(`Actual native App: normal quit, single instance, Keychain reuse and stale replacement passed (${oldPID} -> ${newPID})`);
  } finally {
    if (owner.process.exitCode === null && owner.process.signalCode === null) {
      await child(quit, [String(owner.process.pid)]).done;
      await owner.done;
    }
  }
}

try {
  const sources = ['BackendChildProcess', 'BackendLaunchConfiguration', 'ManagementTransport', 'NativeServiceRuntime']
    .map(name => `apps/macos/Yosh/YoshApp/Services/${name}.swift`);
  await child('swiftc', ['-swift-version', '6', '-parse-as-library', ...sources,
    ...['AppOverview', 'AuthoritySurface', 'ExecutionEnvironment', 'RegisteredAPI', 'PurchasePresentation'].map(name => `apps/macos/Yosh/YoshApp/Models/${name}.swift`),
    'tests/native/ManagementTransportSecurity.swift', '-o', executable]).done;
  for (const mode of ['credential-cache', 'credential-denied', 'credential-invalid',
    'normal', 'fake', 'tamper', 'status', 'nonce', 'stall', 'drip', 'oversized', 'content-length']) await fixture(mode);
  // The untrusted listener owns an isolated free port, never the installed App's port.
  await fixture('fake-owner');

  const port = await freePort();
  const env = { ...environment, APP2049_PORT: String(port) };
  process.stdout.write(await child(executable, ['lifecycle-normal'], env).done);
  const first = child(executable, ['lifecycle-hold'], env);
  const deadline = Date.now() + 15_000;
  while (!/Backend PID (\d+)/.test(first.output()) && Date.now() < deadline) {
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
  const oldPID = Number(first.output().match(/Backend PID (\d+)/)?.[1]);
  trackedBackendPIDs.add(oldPID);
  assert.ok(oldPID > 0, 'native runtime must start a real backend');
  first.process.kill('SIGKILL'); // Test interruption only; never a backend shutdown fallback.
  await first.done.catch(() => {});
  process.kill(oldPID, 0);
  const restarted = await child(executable, ['lifecycle-normal'], env).done;
  const newPID = Number(restarted.match(/Backend PID (\d+)/)?.[1]);
  trackedBackendPIDs.add(newPID);
  assert.ok(newPID > 0 && newPID !== oldPID, 'relaunch must replace the surviving backend');
  assert.throws(() => process.kill(oldPID, 0), { code: 'ESRCH' });
  process.stdout.write(`Real backend replacement: ${oldPID} -> ${newPID}\n${restarted}`);

  const fixtureBundle = join(temporary, 'Supervisor.app');
  const fixtureRuntime = join(fixtureBundle, 'Contents/Resources/Runtime');
  mkdirSync(join(fixtureRuntime, 'backend/.next'), { recursive: true });
  mkdirSync(join(fixtureBundle, 'Contents/MacOS'), { recursive: true });
  copyFileSync(nodeExecutable, join(fixtureBundle, 'Contents/MacOS/YoshBackendNode'));
  chmodSync(join(fixtureBundle, 'Contents/MacOS/YoshBackendNode'), 0o755);
  copyFileSync(join(root, 'tests/native/fixtures/backend.mjs'), join(fixtureRuntime, 'backend/server.js'));
  writeFileSync(join(fixtureRuntime, 'backend/.next/BUILD_ID'), 'fixture');
  writeFileSync(join(fixtureRuntime, 'backend/package.json'), '{"type":"module"}');
  writeFileSync(join(fixtureRuntime, 'mcp.cjs'), '// unused fixture bridge');
  for (const mode of ['supervisor-delay', 'supervisor-core-delay', 'supervisor-restart', 'supervisor-config', 'supervisor-loop']) {
    writeFileSync(join(temporary, 'startup-fixture.json'), JSON.stringify({ mode }), { mode: 0o600 });
    const output = await child(executable, [mode], { ...env, YOSH_TEST_BUNDLE_URL: fixtureBundle }).done;
    process.stdout.write(output);
  }
  const logs = readFileSync(join(temporary, 'logs/backend-lifecycle.jsonl'), 'utf8');
  assert.ok(!logs.includes(secret) && !logs.includes('fixture-secret-that-must-never-be-persisted'));
  assert.ok(logs.includes('MISSING_RUNTIME_MODULE') && logs.includes('restartScheduled') && logs.includes('RESTART_LIMIT'));
  const lockTest = join(temporary, 'instance-lock');
  await child('swiftc', ['-swift-version', '6', '-parse-as-library', 'apps/macos/Yosh/YoshApp/App/AppInstanceLock.swift',
    'apps/macos/Yosh/tests/AppInstanceLockTest.swift', '-o', lockTest]).done;
  process.stdout.write(await child(lockTest, []).done);
  const testApp = process.env.YOSH_NATIVE_TEST_APP;
  if (testApp) await actualApplication(testApp);
  console.log('Management security and lifecycle tests passed (no payments)');
} finally {
  const live = [...trackedBackendPIDs].some(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
  if (live) console.error(`Preserved test data for a surviving backend: ${temporary}`);
  else rmSync(temporary, { recursive: true, force: true });
}

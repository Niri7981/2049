import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = mkdtempSync(join(tmpdir(), 'yosh-members-fixture-'));
const token = randomBytes(32).toString('base64url');
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
const members = ids.map((id, index) => ({
  member: { id, label: index === 0 ? 'Codex' : `Fixture ${index}`, status: index === 3 ? 'REVOKED' : 'ACTIVE',
    isDefault: index === 0, createdAt: index + 1, updatedAt: index + 1 },
  connection: { enabled: false, lastSeen: null, access: 'read_only' }, grant: null,
}));
const calls = [];
const nonces = new Set();
let failRead = false;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const nonce = request.headers['x-2049-nonce'];
  const timestamp = request.headers['x-2049-timestamp'];
  const signature = request.headers['x-2049-proof'] ?? '';
  const proof = ['2049-management-v1', request.method, request.url, timestamp, nonce, hash(body)].join('\n');
  assert.ok(/^[a-f0-9]{64}$/.test(signature) && !nonces.has(nonce));
  assert.ok(Math.abs(Date.now() - Number(timestamp)) < 30_000);
  assert.ok(timingSafeEqual(Buffer.from(signature, 'hex'), createHmac('sha256', token).update(proof).digest()));
  nonces.add(nonce);
  const send = (status, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    const proof = ['2049-management-response-v1', nonce, String(status), hash(bytes)].join('\n');
    response.writeHead(status, { 'content-type': 'application/json',
      'x-2049-response-proof': createHmac('sha256', token).update(proof).digest('hex') });
    response.end(bytes);
  };
  if (request.method === 'GET' && request.url === '/api/app/health') {
    return send(200, { ready: true, service: '2049', pid: process.pid, dataDirectory: realpathSync(directory) });
  }
  if (request.method === 'GET' && request.url === '/api/app/members') {
    if (failRead) { failRead = false; return send(503, { code: 'FIXTURE_READ_UNAVAILABLE' }); }
    return send(200, { members });
  }
  const match = request.url.match(/^\/api\/app\/members\/([a-f0-9-]+)\/connection$/);
  assert.ok(match && request.method === 'PUT', 'Only the existing member connection endpoint may be written');
  assert.equal(request.headers.origin, `http://127.0.0.1:${server.address().port}`);
  assert.deepEqual(JSON.parse(body.toString('utf8')), { enabled: true });
  const id = match[1];
  const member = members.find(entry => entry.member.id === id);
  assert.equal(member?.member.status, 'ACTIVE');
  calls.push(id);
  if (id === ids[0]) await new Promise(resolve => setTimeout(resolve, 150));
  if (id === ids[2] && calls.filter(value => value === id).length === 1) return send(400, { code: 'INVALID_REQUEST' });
  member.connection = { enabled: true, lastSeen: null, access: 'purchase_intent' };
  if (id === ids[1]) failRead = true;
  return send(200, { connection: member.connection });
});

function run(command, args, environment = process.env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', rejectRun);
    child.on('close', code => code === 0 ? resolveRun(output) : rejectRun(new Error(`${command} failed (${code}):\n${output}`)));
  });
}

try {
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const sources = [
    'Services/BackendChildProcess.swift', 'Services/BackendLaunchConfiguration.swift', 'Services/ManagementTransport.swift',
    'Services/NativeServiceRuntime.swift', 'Services/OverviewClient.swift', 'Models/AppOverview.swift',
    'Models/AuthoritySurface.swift', 'Models/ExecutionEnvironment.swift', 'Models/RegisteredAPI.swift', 'Models/CardSettingsPresentation.swift', 'Models/PurchasePresentation.swift',
    'Models/CardMemberSession.swift', 'Models/CardMemberSelection.swift', 'Models/MembersRosterPresentation.swift',
  ].map(path => `apps/macos/Yosh/YoshApp/${path}`);
  const executable = join(directory, 'members-connection-smoke');
  await run('swiftc', ['-parse-as-library', ...sources, 'tests/native/MembersConnectionSmoke.swift', '-o', executable]);
  process.stdout.write(await run(executable, [], { ...process.env,
    APP2049_PORT: String(server.address().port), APP2049_MANAGEMENT_TOKEN: token,
    APP2049_DATA_DIR: directory, APP2049_REPOSITORY_ROOT: root,
  }));
  assert.deepEqual(calls, [ids[0], ids[2], ids[2], ids[1]]);
} finally {
  server.close();
  rmSync(directory, { recursive: true, force: true });
}

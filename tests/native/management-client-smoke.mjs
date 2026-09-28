import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = mkdtempSync(join(tmpdir(), '2049-native-client-'));
const token = randomBytes(32).toString('base64url');
let connection = { enabled: false, lastSeen: null, access: 'read_only' };
let grant = null;
let dailyLimit = null;
let paused = false;
let grantVersion = 0;
const purchases = [
  { purchaseId: 'simulated-activity', status: 'PAID', deliveryStatus: 'COMPLETE', amount: '10000', createdAt: Date.now(),
    offerId: 'basic', reason: 'Need a price snapshot', transaction: 'simulated-simulated-activity', executionMode: 'simulated',
    network: 'solana:devnet', currency: 'USDC', assetId: 'test-mint', assetDecimals: 6, grantId: null },
  { purchaseId: 'unknown-activity', status: 'PAYMENT_UNKNOWN', deliveryStatus: 'NOT_PAID', amount: '1', createdAt: Date.now() - 1_000,
    offerId: 'basic', reason: null, transaction: null, executionMode: 'live_devnet',
    network: 'solana:devnet', currency: 'USDC', assetId: 'test-mint', assetDecimals: 6, grantId: null },
];

const server = createServer(async (request, response) => {
  const send = (status, value) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  if (request.headers.authorization !== `Bearer ${token}`) return send(401, { code: 'UNAUTHORIZED' });
  if (request.method === 'GET' && request.url === '/api/app/health') return send(200, { ready: true });
  if (request.method === 'GET' && request.url === '/api/app/overview') {
    return send(200, {
      service: { status: 'running', recoveryStatus: 'complete', network: 'Solana Devnet',
        testEnvironment: true, purchaseMode: 'simulated' },
      wallet: { address: 'PublicWalletAddress', reused: true },
      budget: { dailyLimit, dailyLimitDisplay: dailyLimit ?? 'Not set', paid: '0', reserved: '0', remaining: dailyLimit, remainingDisplay: dailyLimit ?? 'Not set', paused },
      grant, connection, purchases,
    });
  }
  if (request.method !== 'PUT' || request.headers.origin !== `http://127.0.0.1:${server.address().port}`
    || request.headers['content-type'] !== 'application/json') return send(403, { code: 'LOCAL_REQUEST_FORBIDDEN' });
  let body;
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return send(400, { code: 'INVALID_REQUEST' }); }

  if (request.url === '/api/app/connection' && typeof body.enabled === 'boolean') {
    connection = { enabled: body.enabled, lastSeen: null, access: body.enabled ? 'purchase_intent' : 'read_only' };
    if (!body.enabled && grant?.status === 'ACTIVE') grant = { ...grant, status: 'REVOKED' };
    return send(200, { connection });
  }
  if (request.url === '/api/app/grant' && body.action === 'create') {
    if (!connection.enabled || body.totalLimit === '0') return send(400, { code: 'INVALID_REQUEST' });
    assert.equal(typeof body.totalLimit, 'string');
    assert.equal(typeof body.singleLimit, 'string');
    assert.equal(typeof body.expiresAt, 'number');
    grant = { id: `grant-${++grantVersion}`, status: 'ACTIVE', totalLimit: body.totalLimit, singleLimit: body.singleLimit,
      remaining: body.totalLimit, assetDecimals: 6, expiresAt: body.expiresAt };
    return send(200, { grant, connection });
  }
  if (request.url === '/api/app/grant' && body.action === 'revoke') {
    if (grant) grant = { ...grant, status: 'REVOKED' };
    return send(200, { grant, connection });
  }
  if (request.url === '/api/app/settings' && typeof body.paused === 'boolean') {
    paused = body.paused;
    return send(200, { paused });
  }
  if (request.url === '/api/app/settings' && typeof body.dailyLimit === 'string') {
    dailyLimit = body.dailyLimit;
    return send(200, { dailyLimit });
  }
  return send(400, { code: 'INVALID_REQUEST' });
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
  await new Promise(ready => server.listen(0, '127.0.0.1', ready));
  const sources = [
    'apps/macos/2049/2049App/Services/BackendChildProcess.swift',
    'apps/macos/2049/2049App/Services/BackendLaunchConfiguration.swift',
    'apps/macos/2049/2049App/Services/ManagementTransport.swift',
    'apps/macos/2049/2049App/Services/NativeServiceRuntime.swift',
    'apps/macos/2049/2049App/Services/OverviewClient.swift',
    'apps/macos/2049/2049App/Models/AppOverview.swift',
    'apps/macos/2049/2049App/Models/PurchasePresentation.swift',
    'tests/native/ManagementClientSmoke.swift',
  ];
  const executable = join(temporary, 'management-client-smoke');
  await run('swiftc', ['-parse-as-library', ...sources, '-o', executable]);
  const output = await run(executable, [], { ...process.env, APP2049_PORT: String(server.address().port), APP2049_MANAGEMENT_TOKEN: token });
  process.stdout.write(output);
} finally {
  server.close();
  rmSync(temporary, { recursive: true, force: true });
}

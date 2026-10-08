// Test-owned service fixture: no wallet, ledger, RPC, or payment modules.
import { createServer } from 'node:http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
const mode = JSON.parse(readFileSync(join(process.env.YOSH_DATA_DIR, 'startup-fixture.json'), 'utf8')).mode;
const secret = process.env.YOSH_MANAGEMENT_TOKEN;
const began = Date.now();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const proof = message => createHmac('sha256', secret).update(message).digest();
console.error('MODULE_NOT_FOUND fixture-secret-that-must-never-be-persisted');
if (mode === 'supervisor-loop') process.exit(1);
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const nonce = request.headers['x-2049-nonce'];
  const timestamp = request.headers['x-2049-timestamp'];
  const supplied = Buffer.from(request.headers['x-2049-proof'] ?? '', 'hex');
  const expected = proof(['2049-management-v1', request.method, request.url, timestamp, nonce, hash(body)].join('\n'));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)
    || Math.abs(Date.now() - Number(timestamp)) > 30_000) { response.writeHead(401); response.end(); return; }
  let status = 200;
  let value;
  if (request.url === '/api/app/health') {
    const coreReady = mode !== 'supervisor-config' && (mode !== 'supervisor-core-delay' || Date.now() - began >= 12_000);
    status = coreReady ? 200 : 503;
    value = { ready: coreReady, coreReady, service: 'Yosh', pid: process.pid,
      dataDirectory: realpathSync(process.env.YOSH_DATA_DIR), wallet: 'walletChecking', recovery: 'recoveryRunning',
      ...(!coreReady ? { code: mode === 'supervisor-config' ? 'CORE_CONFIGURATION_INVALID' : 'CORE_STARTING' } : {}) };
  } else if (request.url === '/api/app/lifecycle' && JSON.parse(body).action === 'shutdown') {
    value = { ready: true };
    setTimeout(() => process.exit(0), 250);
  } else { status = 404; value = { code: 'NOT_FOUND' }; }
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'content-type': 'application/json',
    'x-2049-response-proof': proof(['2049-management-response-v1', nonce, String(status), hash(bytes)].join('\n')).toString('hex') });
  response.end(bytes);
});
setTimeout(() => server.listen(Number(process.env.PORT), '127.0.0.1'), mode === 'supervisor-delay' ? 12_000 : 0);

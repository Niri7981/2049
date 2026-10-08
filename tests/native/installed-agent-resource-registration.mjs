// Explicit opt-in acceptance: creates one unpaid Resource and checks a denied purchase.
// No Grant, settings mutation, signing or payment is authorized by this script.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { codexHost } from '../helpers/codex-app-server.ts';
assert.equal(process.env.YOSH_ACCEPT_AGENT_RESOURCE_REGISTRATION, '1', 'Requires explicit opt-in to creating the acceptance Resource');
const cli = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const entries = JSON.parse(execFileSync(cli, ['mcp', 'list', '--json'], { encoding: 'utf8' }));
const entry = entries.find(value => value.name.startsWith('yosh-codex-')
  && value.transport.command === join(homedir(), 'Applications/Yosh.app/Contents/MacOS/YoshBackendNode'));
assert.ok(entry, 'Existing packaged Yosh MCP connection required; this script never configures a connection');
const directory = entry.transport.env.YOSH_DATA_DIR;
const descriptorPath = join(directory, 'mcp-connection.json');
const descriptor = readFileSync(descriptorPath, 'utf8');
const identity = JSON.parse(descriptor);
const home = mkdtempSync(join(tmpdir(), 'yosh-installed-register-'));
const table = `mcp_servers.${JSON.stringify(entry.name)}`;
writeFileSync(join(home, 'config.toml'), `[${table}]\ncommand = ${JSON.stringify(entry.transport.command)}\nargs = ${JSON.stringify(entry.transport.args)}\n[${table}.env]\n`
  + Object.entries(entry.transport.env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n'), { mode: 0o600 });
const host = codexHost(cli, home, tmpdir());
const resourceId = 'agent402-crypto-price';
const purchaseId = 'agent402-registration-no-grant-20261008';
const db = new DatabaseSync(join(directory, 'app-ledger.sqlite'), { readOnly: true });
let threadId;
const sample = { query: { coins: 'BTC,ETH,SOL', currency: 'usd' } };
const requestInputs = { query: { coins: { type: 'string', required: true, maxLength: 300 }, currency: { type: 'string', required: false, maxLength: 300 } } };
async function call(tool, args) {
  return host.request('mcpServer/tool/call', { threadId, server: entry.name, tool, arguments: args });
}
function parsed(result) {
  const text = result.content?.find(item => item.type === 'text')?.text;
  assert.ok(text, 'MCP result has no text');
  assert.notEqual(result.isError, true, text);
  return JSON.parse(text);
}
function noGrant() {
  const row = db.prepare('SELECT COUNT(*) AS count FROM spend_grants WHERE resource_id=?').get(resourceId);
  assert.equal(Number(row.count), 0, 'The acceptance Resource must have no historical or active Grant');
}
try {
  await host.request('initialize', { clientInfo: { name: 'yosh_registration_acceptance', version: '1' }, capabilities: { experimentalApi: true } });
  host.notify('initialized');
  const thread = await host.request('thread/start', { cwd: tmpdir(), ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' });
  threadId = thread.thread.id;
  const tools = await host.request('mcpServerStatus/list', { threadId });
  assert.ok(JSON.stringify(tools).includes('register_x402_resource'), 'Installed MCP must advertise creation capability');
  const discovery = parsed(await call('discover_x402_resource', {
    url: 'https://agent402.tools/api/crypto-price', method: 'GET', headers: { accept: 'application/json' }, requestInputs, sample,
    deliveryPolicy: { format: 'json', mimeTypes: ['application/json'], maxBytes: 262144 },
    documentation: { urls: ['https://agent402.tools/tools/crypto-price', 'https://agent402.tools/openapi.json'], uncertainties: [
      'Merchant documents at most 25 coins. Yosh validates string fields; it does not enforce comma-separated coin count.',
      'Original-payment delivery recovery has not been verified; no recovery capability is registered.',
      'Documentation describes accepted fields; an unpaid 402 does not verify paid response delivery.'
    ] },
  }));
  assert.equal(discovery.paymentSent, false);
  assert.equal(discovery.network, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
  assert.equal(discovery.assetId, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const registration = { discoveryId: discovery.discoveryId, resourceId, providerId: 'agent402.tools', displayName: 'Agent402 Crypto Price' };
  const registered = parsed(await call('register_x402_resource', registration));
  assert.equal(registered.registrationStatus, 'REGISTERED'); assert.equal(registered.source, 'agent');
  assert.equal(registered.spendingAuthorityCreated, false); assert.equal(registered.paymentSent, false);
  assert.deepEqual(registered.definition.requestInputs, requestInputs); assert.deepEqual(registered.submission.sample, sample);
  assert.equal(registered.submission.cardMemberId, identity.cardMemberId);
  const replay = parsed(await call('register_x402_resource', registration));
  assert.equal(replay.resourceId, resourceId); noGrant();
  const registryRow = db.prepare('SELECT definition,state FROM resource_registry WHERE resource_id=?').get(resourceId);
  assert.equal(registryRow.state, 'ACTIVE'); assert.equal(JSON.parse(registryRow.definition).request.url, discovery.url);
  const readModel = parsed(await call('get_market_quote', {}));
  assert.ok(readModel.registeredResources.some(resource => resource.resourceId === resourceId && resource.source === 'agent'), 'Authority projection must include Agent resource');
  console.log(JSON.stringify({ check: 'installed-discovery-registration', resourceId, endpoint: discovery.url, method: discovery.method,
    amount: discovery.baseAmount, display: discovery.basePriceDisplay, recipient: discovery.payTo, network: discovery.network,
    source: registered.source, sampleRetained: true, immutableReplay: true, sharedSelectorVisible: true, grantAbsent: true, paymentSent: false }));
  // Positive safety condition checked before the real request: no resource Grant exists.
  noGrant();
  const denied = await call('request_purchase', { requestId: purchaseId, resourceId, request: sample,
    reason: 'Verify resource registration grants no spending authority' });
  let denial;
  if (denied.isError) {
    denial = denied.content?.find(item => item.type === 'text')?.text;
    assert.ok(denial?.includes('PURCHASE_REQUEST_FAILED'));
  } else {
    const value = parsed(denied); assert.equal(value.paymentStatus, 'NOT_STARTED');
    assert.equal(value.status, 'DENIED'); assert.equal(value.grant, null); denial = value.decision.reason;
  }
  noGrant();
  assert.equal(readFileSync(descriptorPath, 'utf8'), descriptor, 'Registration must not rotate or modify connection');
  console.log(JSON.stringify({ check: 'installed-unauthorized-purchase', resourceId, denial, grantAbsent: true,
    descriptorUnchanged: true, paymentNotStarted: true }));
} finally { db.close(); await host.close(); rmSync(home, { recursive: true, force: true }); }

// Opt-in installed-product acceptance: real Codex host, read-only status only.
// Requires Yosh already running/connected. No model turn or purchase is sent.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { codexHost } from '../helpers/codex-app-server.ts';

const cli = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const entries = JSON.parse(execFileSync(cli, ['mcp', 'list', '--json'], { encoding: 'utf8' }));
const entry = entries.find(value => value.name.startsWith('yosh-codex-')
  && value.transport.command === join(homedir(), 'Applications/Yosh.app/Contents/MacOS/YoshBackendNode'));
assert.ok(entry, 'An existing owned packaged Codex connection is required');
const descriptorPath = join(entry.transport.env.YOSH_DATA_DIR, 'mcp-connection.json');
const originalDescriptor = readFileSync(descriptorPath, 'utf8');
const home = mkdtempSync(join(tmpdir(), 'yosh-installed-host-'));
const name = entry.name;
const table = `mcp_servers.${JSON.stringify(name)}`;
writeFileSync(join(home, 'config.toml'), `[${table}]\ncommand = ${JSON.stringify(entry.transport.command)}\nargs = ${JSON.stringify(entry.transport.args)}\n[${table}.env]\n`
  + Object.entries(entry.transport.env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n'), { mode: 0o600 });
const host = codexHost(cli, home, tmpdir());
let wallet;
let threadId;
async function status(label) {
  const result = await host.request('mcpServer/tool/call', { threadId, server: name, tool: 'get_spending_status', arguments: {} });
  const texts = result.content?.filter(value => value.type === 'text') ?? [];
  const value = JSON.parse(texts[0]?.text ?? '{}');
  assert.ok(value.wallet?.address, 'Installed read must return the real public wallet identity');
  wallet ??= value.wallet.address;
  assert.equal(value.wallet.address, wallet, 'Wallet identity changed across restart');
  assert.equal(readFileSync(descriptorPath, 'utf8'), originalDescriptor, 'Normal restart rotated the connection capability');
  console.log(JSON.stringify({ check: label, walletUnchanged: true, descriptorUnchanged: true,
    mainnet: value.execution?.mode === 'live_mainnet', grantStatus: value.grant?.status ?? 'none',
    walletSuffix: wallet.slice(-6), configurationReady: value.execution?.configurationReady,
    spendingAuthorized: value.spendingAuthorized, readiness: value.readiness,
    purchaseRequested: false }));
  const quoteResult = await host.request('mcpServer/tool/call', { threadId, server: name, tool: 'get_market_quote', arguments: {} });
  const quote = JSON.parse(quoteResult.content?.find(item => item.type === 'text')?.text ?? '{}');
  console.log(JSON.stringify({ check: `${label}-quote`, resources: quote.resources?.map(item => ({ resourceId: item.resourceId,
    quoteStatus: item.quoteStatus, preflight: item.preflight, requestInput: item.requestInput })) ?? [], purchaseRequested: false }));
}
async function lifecycleDiscovery() {
  for (const [label, arguments_] of [
    ['agent402', { url: 'https://agent402.tools/api/crypto-price?coins=BTC%2CETH%2CSOL&currency=usd', method: 'GET' }],
    ['you', { url: 'https://api.you.com/v1/search', method: 'GET', requestInputs: { query: { query: { type: 'string', required: true, maxLength: 300 } } }, sample: { query: { query: 'solana' } } }],
  ]) {
    const result = await host.request('mcpServer/tool/call', { threadId, server: name, tool: 'discover_x402_resource', arguments: arguments_ });
    if (label === 'you' && result.isError) {
      console.log(JSON.stringify({ check: 'you-discovery', available: false,
        reason: result.content?.find(item => item.type === 'text')?.text ?? 'no response', purchaseRequested: false }));
      continue;
    }
    assert.notEqual(result.isError, true, `${label} discovery must be non-paying and supported: ${result.content?.find(item => item.type === 'text')?.text ?? 'no response'}`);
    const value = JSON.parse(result.content?.find(item => item.type === 'text')?.text ?? '{}');
    assert.equal(value.paymentSent, false);
    assert.ok(value.proposal?.request);
    console.log(JSON.stringify({ check: `${label}-discovery`, amount: value.baseAmount, paymentSent: value.paymentSent }));
  }
  const quoteResult = await host.request('mcpServer/tool/call', { threadId, server: name, tool: 'quote_x402_resource',
    arguments: { resourceId: 'you-web-search', sample: { query: { query: 'solana' } } } });
  if (quoteResult.isError) {
    console.log(JSON.stringify({ check: 'you-registered-quote', available: false,
      reason: quoteResult.content?.find(item => item.type === 'text')?.text ?? 'no response', purchaseRequested: false }));
    return;
  }
  const quote = JSON.parse(quoteResult.content?.find(item => item.type === 'text')?.text ?? '{}');
  assert.equal(quote.paymentSent, false);
  console.log(JSON.stringify({ check: 'you-registered-quote', amount: quote.amount, preflight: quote.preflight, paymentSent: false }));
}
try {
  await host.request('initialize', { clientInfo: { name: 'yosh_installed_acceptance', version: '1' }, capabilities: { experimentalApi: true } });
  host.notify('initialized');
  const thread = await host.request('thread/start', { cwd: tmpdir(), ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' });
  threadId = thread.thread.id;
  await host.request('mcpServerStatus/list', { threadId });
  await status('first-installed-read');
  await lifecycleDiscovery();
  console.log('READY_FOR_RESTART_CHECKS');
  for await (const command of createInterface({ input: process.stdin })) {
    if (command === 'finish') break;
    if (command === 'status') await status('after-restart');
  }
} finally { await host.close(); rmSync(home, { recursive: true, force: true }); }

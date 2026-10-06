import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSigner } from '@solana/kit';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, expect, it, vi } from 'vitest';
import { AppRuntime } from '../../src/modules/app/app-runtime';
import { createAgentServer } from '../../src/modules/mcp/server';
import { readConnection } from '../../src/modules/mcp/connection';
import { resolvePaymentEnvironment } from '../../src/modules/payment/payment-environment';
import { loadBuyerSigner } from '../../src/modules/payment/wallet';
import { prepareSolanaPayment } from '../../src/modules/payment/solana-payment';
import { reconcileStoredOriginalPayment } from '../../src/modules/payment/reconcile-transaction';
import { FIXTURE_TRANSACTION_SIGNATURE, signedPaymentFixture } from '../helpers/signed-payment-fixture';
import { signedManagementRequest } from '../helpers/management-request';
import { POST } from '../../src/app/api/agent/purchases/route';
import { POST as sessionPOST } from '../../src/app/api/agent/session/route';
import { GET as agentGET } from '../../src/app/api/agent/route';
import { PUT as grantPUT } from '../../src/app/api/app/grant/route';
import { PUT as settingsPUT } from '../../src/app/api/app/settings/route';
import type { X402Resource } from '../../src/modules/resources/http-resource';

vi.mock('../../src/modules/payment/wallet', () => ({ loadBuyerSigner: vi.fn() }));
vi.mock('../../src/modules/payment/solana-payment', async original => ({ ...await original<typeof import('../../src/modules/payment/solana-payment')>(), prepareSolanaPayment: vi.fn() }));
vi.mock('../../src/modules/payment/reconcile-transaction', () => ({ reconcileStoredOriginalPayment: vi.fn().mockResolvedValue({ status: 'UNKNOWN' }) }));
const context = vi.hoisted(() => ({ app: undefined as AppRuntime | undefined }));
vi.mock('../../src/modules/app/app-runtime', async original => ({ ...await original<typeof import('../../src/modules/app/app-runtime')>(), appRuntime: () => context.app! }));
const origin = 'http://127.0.0.1:3049';
const secret = 'fixture-management-secret-32-bytes';
const dirs: string[] = [];
afterEach(async () => { await context.app?.prepareQuit(); context.app?.close(); context.app = undefined; vi.resetAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
async function fixture(enabled = true) {
  const signer = await generateKeyPairSigner(); const recipient = await generateKeyPairSigner(); const sponsor = await generateKeyPairSigner();
  const env = resolvePaymentEnvironment({ YOSH_EXECUTION_MODE: 'live_mainnet' });
  const resource: X402Resource = { resourceId: 'production-data', providerId: 'registered-provider', network: env.network, mint: env.asset.mint,
    decimals: 6, recipient: recipient.address, amount: '10000', request: { url: 'https://provider.example/data', method: 'GET', access: 'https', headers: {} }, deliveryRecovery: { kind: 'idempotent_replay' } };
  vi.stubEnv('YOSH_EXECUTION_MODE', 'live_mainnet'); vi.stubEnv('YOSH_ENABLE_MAINNET_EXECUTION', enabled ? '1' : '');
  vi.stubEnv('YOSH_MAINNET_WALLET_PUBLIC_KEY', signer.address); vi.stubEnv('YOSH_MAINNET_RESOURCES', JSON.stringify([resource]));
  vi.stubEnv('X402_FACILITATOR_URL', 'https://facilitator.example'); vi.stubEnv('YOSH_MANAGEMENT_TOKEN', secret);
  const challenge = { x402Version: 2 as const, resource: { url: resource.request.url }, accepts: [{ scheme: 'exact', network: env.network, asset: env.asset.mint,
    amount: '10000', payTo: recipient.address, maxTimeoutSeconds: 300, extra: { feePayer: sponsor.address } }] };
  const quoteFetch = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge) } }));
  const dir = mkdtempSync(join(tmpdir(), 'yosh-mainnet-entry-')); dirs.push(dir);
  const app = new AppRuntime(dir, { initializeWallet: async () => ({ address: signer.address, reused: true }), fetcher: quoteFetch }); context.app = app;
  await app.initializeWallet(); app.setAgentConnection(true, origin);
  const manage = async (path: string, body: object) => (path === 'grant' ? grantPUT : settingsPUT)(signedManagementRequest(`${origin}/api/app/${path}`, secret, { method: 'PUT', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) }));
  const grant = async () => expect((await manage('grant', { action: 'create', resourceId: resource.resourceId, totalLimit: '100000', singleLimit: '10000', expiresAt: Date.now() + 3600000 })).status).toBe(200);
  const daily = async () => { expect((await manage('settings', { dailyLimit: '100000' })).status).toBe(200); expect((await manage('settings', { paused: false })).status).toBe(200); };
  vi.mocked(loadBuyerSigner).mockResolvedValue(signer);
  vi.mocked(prepareSolanaPayment).mockImplementation(async (config, _signer, quote, guard, authorized) => { guard?.(); return { ...await signedPaymentFixture(signer, config, quote), resource: authorized?.challenge?.resource }; });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fixture submission unknown')));
  const call = async (id = 'purchase', token = readConnection(dir).token, extra = {}) => POST(new Request(`${origin}/api/agent/purchases`, { method: 'POST', headers: { host: '127.0.0.1:3049', authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ requestId: id, resourceId: resource.resourceId, reason: 'fixture', ...extra }) }));
  return { app, dir, grant, daily, call, quoteFetch, resource };
}
it('real App management and MCP tool reach the shared Mainnet signing boundary; replay preserves original payment', async () => {
  const f = await fixture(); await f.daily(); await f.grant();
  const server = createAgentServer(async () => f.app.overview(), async input => { const response = await f.call(input.requestId); if (!response.ok) throw new Error(); return response.json(); });
  const client = new Client({ name: 'fixture-host', version: '1' }); const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try { await server.connect(serverTransport); await client.connect(clientTransport);
    const input = { requestId: 'mcp-mainnet', resourceId: f.resource.resourceId, reason: 'fixture' };
    const first = await client.callTool({ name: 'request_purchase', arguments: input }); expect(first.isError).not.toBe(true);
    expect(JSON.stringify(first)).toContain('PAYMENT_UNKNOWN'); expect(JSON.stringify(first)).not.toMatch(/buyerSignature|PAYMENT-SIGNATURE|transactionBase64/);
    await client.callTool({ name: 'request_purchase', arguments: input });
    expect(prepareSolanaPayment).toHaveBeenCalledOnce(); expect(f.quoteFetch).toHaveBeenCalledOnce(); expect(f.app.ledger.list()).toHaveLength(1);
    expect((await f.app.overview()).service).toMatchObject({ network: 'Solana Mainnet', testEnvironment: false });
  } finally { await client.close(); await server.close(); }
});
it.each(['unauthorized', 'daily', 'grant', 'paused', 'disabled', 'extra', 'debug'] as const)('product Mainnet gate rejects %s without signing', async condition => {
  const f = await fixture(condition !== 'disabled');
  if (condition !== 'daily') await f.daily(); else f.app.setPaused(false);
  if (condition !== 'grant') await f.grant();
  if (condition === 'paused') f.app.setPaused(true);
  if (condition === 'debug') {
    const start = vi.spyOn(f.app, 'start'); const wallet = vi.spyOn(f.app, 'initializeWallet');
    await expect(f.app.createTestPurchase('debug', origin)).rejects.toThrow('TEST_PURCHASE_UNAVAILABLE');
    expect(start).not.toHaveBeenCalled(); expect(wallet).not.toHaveBeenCalled();
  }
  else {
    const response = await f.call('denied', condition === 'unauthorized' ? 'invalid-token' : undefined, condition === 'extra' ? { amount: '1', network: 'solana:devnet', approved: true } : {});
    if (condition === 'unauthorized') expect(response.status).toBe(401);
    else if (condition === 'disabled' || condition === 'extra') expect(response.status).toBe(400);
    else expect(await response.json()).toMatchObject({ status: 'DENIED', decision: { reason: condition === 'daily' ? 'DAILY_LIMIT_NOT_SET' : condition === 'grant' ? 'SPEND_GRANT_REQUIRED' : 'PAYMENTS_PAUSED' } });
  }
  expect(loadBuyerSigner).not.toHaveBeenCalled(); expect(prepareSolanaPayment).not.toHaveBeenCalled();
});

it('the shipped stdio MCP bridge uses a registered member capability and the production HTTP handler for Mainnet', async () => {
  const f = await fixture(); await f.daily();
  const http = createServer(async (incoming, outgoing) => {
    try {
      const address = http.address(); if (!address || typeof address === 'string') throw new Error();
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(key, value);
      const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const request = new Request(`http://127.0.0.1:${address.port}${incoming.url}`, { method: incoming.method, headers, ...(incoming.method === 'GET' ? {} : { body: Buffer.concat(chunks) }) });
      const response = incoming.method === 'GET' ? await agentGET(request) : incoming.url === '/api/agent/session' ? await sessionPOST(request) : await POST(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text());
    } catch { outgoing.writeHead(500); outgoing.end(); }
  });
  const client = new Client({ name: 'stdio-fixture-host', version: '1' });
  try {
    http.listen(0, '127.0.0.1'); await once(http, 'listening');
    const address = http.address(); if (!address || typeof address === 'string') throw new Error();
    f.app.setAgentConnection(true, `http://127.0.0.1:${address.port}`); await f.grant();
    f.app.agentConnection.setIntegration(true, 'codex-fixture');
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ['--import', resolve('node_modules/tsx/dist/loader.mjs'), resolve('scripts/mcp.ts')],
      cwd: tmpdir(), env: { YOSH_DATA_DIR: f.dir, YOSH_CARD_MEMBER_ID: f.app.ledger.defaultCardMember().id, YOSH_MCP_PROVIDER: 'codex' }, stderr: 'pipe' });
    await client.connect(transport);
    await vi.waitFor(() => expect(f.app.agentConnection.status().integration?.connected).toBe(true));
    const quotes = await client.callTool({ name: 'get_market_quote', arguments: {} });
    expect(quotes.isError).not.toBe(true); expect(JSON.stringify(quotes)).toContain(f.resource.resourceId);
    f.quoteFetch.mockClear();
    const args = { requestId: 'stdio-mainnet', resourceId: f.resource.resourceId, reason: 'fixture' };
    const injected = await client.callTool({ name: 'request_purchase', arguments: { ...args, amount: '1', network: 'solana:devnet' } });
    expect(injected.isError).toBe(true); expect(prepareSolanaPayment).not.toHaveBeenCalled();
    const first = await client.callTool({ name: 'request_purchase', arguments: args });
    expect(first.isError).not.toBe(true); expect(JSON.stringify(first)).toContain('PAYMENT_UNKNOWN');
    await client.callTool({ name: 'request_purchase', arguments: args });
    expect(prepareSolanaPayment).toHaveBeenCalledOnce(); expect(f.app.ledger.list()).toHaveLength(1);
    f.app.revokeSpendGrant();
    const stale = await client.callTool({ name: 'request_purchase', arguments: { ...args, requestId: 'stale' } });
    expect(stale.isError).toBe(true); expect(prepareSolanaPayment).toHaveBeenCalledOnce();
  } finally { await client.close(); http.closeAllConnections(); await new Promise<void>(resolveClose => http.close(() => resolveClose())); }
});

it('Mainnet original-payment recovery survives backend restart with production disabled and authority revoked', async () => {
  const f = await fixture(); await f.daily(); await f.grant();
  expect(await (await f.call('restart-original')).json()).toMatchObject({ paymentStatus: 'PAYMENT_UNKNOWN' });
  const before = f.app.ledger.get('restart-original', f.app.ledger.defaultCardMember().id)!;
  const evidence = f.app.ledger.savedOriginalPayment(before.approvalId)!;
  f.app.setPaused(true); await f.app.prepareQuit(); f.app.close(); context.app = undefined;
  vi.stubEnv('YOSH_ENABLE_MAINNET_EXECUTION', '');
  vi.stubEnv('YOSH_MAINNET_RESOURCES', JSON.stringify([{ ...f.resource, resourceId: 'replacement-resource', request: { ...f.resource.request, url: 'https://provider.example/replacement' } }]));
  vi.mocked(reconcileStoredOriginalPayment).mockResolvedValue({ status: 'CONFIRMED', transaction: FIXTURE_TRANSACTION_SIGNATURE, confirmationStatus: 'confirmed' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: 'original delivery' })));
  const restarted = new AppRuntime(f.dir, { initializeWallet: async () => ({ address: evidence.evidence.identity.payer, reused: true }), fetcher: f.quoteFetch }); context.app = restarted;
  await restarted.start(origin); await restarted.initializeWallet(); restarted.setAgentConnection(true, origin);
  const response = await f.call('restart-original'); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ paymentStatus: 'PAID', resource: { data: 'original delivery' }, reused: true });
  expect(restarted.ledger.controls('live_mainnet').paused).toBe(true);
  expect(prepareSolanaPayment).toHaveBeenCalledOnce(); expect(loadBuyerSigner).toHaveBeenCalledOnce(); expect(f.quoteFetch).toHaveBeenCalledOnce();
});
it('test authority and unregistered resources cannot enter the product Mainnet signer', async () => {
  const f = await fixture(); await f.daily();
  const principal = f.app.agentConnection.principal('request_purchase')!;
  const testEnv = resolvePaymentEnvironment({}, 'live_devnet');
  f.app.ledger.setDailyLimit('100000', 'live_devnet'); f.app.ledger.setPaused(false, 'live_devnet');
  f.app.ledger.createSpendGrant({ totalLimit: '100000', singleLimit: '10000', expiresAt: Date.now() + 3600000 }, principal,
    { resourceId: f.resource.resourceId, providerId: f.resource.providerId, operation: 'paid.resource.purchase', network: testEnv.network,
      assetId: testEnv.asset.mint, assetDecimals: 6, payTo: f.resource.recipient, paymentScheme: 'exact' }, Date.now(), 'live_devnet');
  expect(await (await f.call('test-authority')).json()).toMatchObject({ status: 'DENIED', decision: { reason: 'SPEND_GRANT_REQUIRED' } });
  expect((await f.call('unregistered', undefined, { resourceId: 'unregistered' })).status).toBe(400);
  expect(loadBuyerSigner).not.toHaveBeenCalled(); expect(prepareSolanaPayment).not.toHaveBeenCalled();
});

it('concurrent product requests share one original payment and reject changed intent under the same ID', async () => {
  const f = await fixture(); await f.daily(); await f.grant();
  const responses = await Promise.all([f.call('concurrent'), f.call('concurrent')]);
  expect(responses.every(response => response.status === 200)).toBe(true);
  expect(f.app.ledger.list()).toHaveLength(1); expect(prepareSolanaPayment).toHaveBeenCalledOnce();
  expect(f.app.ledger.managedSummary(Date.now(), 'live_mainnet').reserved).toBe('10000');
  expect((await f.call('concurrent', undefined, { reason: 'changed purpose' })).status).toBe(409);
  expect(prepareSolanaPayment).toHaveBeenCalledOnce();
});
it('a revoked registered member capability rejects before quoting or signing', async () => {
  const f = await fixture(); await f.daily();
  const member = f.app.createCardMember('Fixture research member');
  f.app.setAgentConnection(true, origin, member.member.id);
  f.app.createSpendGrant({ resourceId: f.resource.resourceId, totalLimit: '100000', singleLimit: '10000', expiresAt: Date.now() + 3600000 }, member.member.id);
  const token = readConnection(f.dir, member.member.id).token;
  f.app.revokeCardMember(member.member.id);
  expect((await f.call('revoked-member', token)).status).toBe(401);
  expect(f.quoteFetch).not.toHaveBeenCalled(); expect(prepareSolanaPayment).not.toHaveBeenCalled();
});

it('Mainnet balance reads verify network identity and never supply spending authority', async () => {
  const f = await fixture(false); const overview = await f.app.overview(); const env = resolvePaymentEnvironment();
  const rpc = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ result: env.genesisHash })).mockResolvedValueOnce(Response.json({ result: { value: {
    owner: env.asset.tokenProgram, data: { parsed: { info: { owner: overview.wallet.address, mint: env.asset.mint, tokenAmount: { amount: '1999999', decimals: 6 } } } }
  } } }));
  expect(await f.app.balance(overview.wallet.address, rpc)).toMatchObject({ display: '2.00 USDC', available: true });
  rpc.mockResolvedValueOnce(Response.json({ result: 'wrong-network' }));
  expect(await f.app.balance(overview.wallet.address, rpc)).toMatchObject({ available: false });
  expect(f.app.ledger.controls('live_mainnet')).toMatchObject({ dailyBudget: null, paused: true });
  expect(prepareSolanaPayment).not.toHaveBeenCalled();
});

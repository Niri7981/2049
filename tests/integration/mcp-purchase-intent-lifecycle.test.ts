import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { FacilitatorClient } from '@x402/core/server';
import { Keypair } from '@solana/web3.js';
import { expect, it, vi } from 'vitest';
import { POST } from '../../src/app/api/agent/purchases/route';
import { AppRuntime } from '../../src/modules/app/app-runtime';
import { readConnection } from '../../src/modules/mcp/connection';
import { createPaidMarketApi } from '../../src/modules/paid-market-api/paid-market-api';
import { SettlementStore } from '../../src/modules/paid-market-api/settlement-store';
import { DEVNET_NETWORK, DEVNET_USDC_MINT, type PaymentConfig } from '../../src/modules/payment/payment-config';
import { executeApprovedPayment, recoverApprovedPayment } from '../../src/modules/purchases/approved-payment';
import { loadBuyerSigner } from '../../src/modules/payment/wallet';

vi.mock('@/modules/app/app-runtime', () => ({
  appRuntime: () => (globalThis as typeof globalThis & { __app2049?: { runtime?: AppRuntime } }).__app2049?.runtime,
}));
vi.mock('@/modules/demo/local-request', async () => await import('../../src/modules/demo/local-request'));
vi.mock('@/modules/purchases/request-market-purchase', async () => await import('../../src/modules/purchases/request-market-purchase'));
vi.mock('../../src/modules/purchases/approved-payment', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/modules/purchases/approved-payment')>(),
  executeApprovedPayment: vi.fn(), recoverApprovedPayment: vi.fn(),
}));
vi.mock('../../src/modules/payment/wallet', () => ({ loadBuyerSigner: vi.fn() }));

const buyer = Keypair.generate().publicKey.toBase58();
const merchant = Keypair.generate().publicKey.toBase58();
const feePayer = Keypair.generate().publicKey.toBase58();
const fixedNow = Date.parse('2026-09-24T03:00:00Z');
const config: PaymentConfig = { cluster: 'devnet', rpcUrl: 'https://api.devnet.solana.com', network: DEVNET_NETWORK,
  mint: DEVNET_USDC_MINT, buyer, merchant, facilitatorUrl: 'https://facilitator.invalid' };

function purchaseRequest(origin: string, token: string, requestId: string) {
  return fetch(`${origin}/api/agent/purchases`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, offerId: 'basic', reason: 'Check policy without payment' }) });
}

it('separates authenticated MCP purchase intents from SpendGrant authority across creation, revoke and expiry', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bound-intent-lifecycle-'));
  const store = new SettlementStore(':memory:');
  const facilitator = {
    getSupported: vi.fn(async () => ({ kinds: [{ x402Version: 2 as const, scheme: 'exact', network: config.network, extra: { feePayer } }], extensions: [], signers: {} })),
    verify: vi.fn(), settle: vi.fn(),
  } satisfies FacilitatorClient;
  const paidApi = createPaidMarketApi(config, facilitator, store);
  const quote = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input));
    return paidApi({ asset: url.searchParams.get('asset'), offer: url.searchParams.get('offer') });
  });
  let now = fixedNow;
  const app = new AppRuntime(directory, { initializeWallet: async () => ({ address: buyer, reused: true }), now: () => now,
    timeZone: () => 'Asia/Shanghai', fetcher: quote });
  const claim = vi.spyOn(app.ledger, 'claim');
  const savePayload = vi.spyOn(app.ledger, 'savePayload');
  const state = globalThis as typeof globalThis & { __app2049?: { runtime?: AppRuntime } };
  const previous = state.__app2049;
  state.__app2049 = { runtime: app };
  const http = createServer(async (incoming, outgoing) => {
    try {
      const address = http.address();
      if (!address || typeof address === 'string') throw new Error('Missing test port');
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(key, value);
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const request = new Request(`http://127.0.0.1:${address.port}${incoming.url ?? '/'}`, {
        method: incoming.method, headers, body: Buffer.concat(chunks),
      });
      const response = await POST(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch { outgoing.writeHead(500); outgoing.end(); }
  });
  const clients: Array<{ client: Client; transport: StdioClientTransport }> = [];
  vi.stubEnv('APP2049_ENABLE_DEVNET_PURCHASES', '1');
  vi.stubEnv('APP2049_ENABLE_LEGACY_DEMO_TASKS', '');
  vi.stubEnv('SOLANA_CLUSTER', 'devnet');
  vi.stubEnv('DEMO_MERCHANT_PUBLIC_KEY', merchant);
  try {
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    const origin = `http://127.0.0.1:${address.port}`;
    await app.initializeWallet();
    app.setDailyLimit('5000000');
    app.setAgentConnection(true, origin);
    const first = readConnection(directory);
    expect(first.capabilities).toEqual(['read', 'request_purchase']);

    async function connect() {
      const client = new Client({ name: 'intent-lifecycle-test', version: '1' });
      const transport = new StdioClientTransport({ command: process.execPath,
        args: ['--import', resolve('node_modules/tsx/dist/loader.mjs'), resolve('scripts/mcp.ts')],
        cwd: tmpdir(), env: { APP2049_DATA_DIR: directory }, stderr: 'pipe' });
      await client.connect(transport);
      clients.push({ client, transport });
      return client;
    }
    async function call(client: Client, requestId: string, offerId: 'basic' | 'premium' = 'basic') {
      const response = await client.callTool({ name: 'request_purchase', arguments: { requestId, offerId, reason: 'Check policy without payment' } });
      expect(response.isError).not.toBe(true);
      if (!Array.isArray(response.content)) throw new Error('Missing MCP content');
      const content: unknown = response.content[0];
      if (!content || typeof content !== 'object' || !('type' in content) || content.type !== 'text'
        || !('text' in content) || typeof content.text !== 'string') throw new Error('Missing MCP text response');
      return JSON.parse(content.text) as unknown;
    }

    const initialClient = await connect();
    const withoutGrant = await call(initialClient, 'intent-no-grant');
    expect(withoutGrant).toMatchObject({
      status: 'DENIED', decision: { decision: 'DENIED', reason: 'SPEND_GRANT_REQUIRED' },
      paymentStatus: 'NOT_STARTED', deliveryStatus: 'NOT_DELIVERED', grant: null,
    });
    expect(withoutGrant).not.toHaveProperty('resource');
    expect(app.ledger.get('intent-no-grant')?.ownerCardMemberId).toBe(first.cardMemberId);
    expect(app.ledger.events('intent-no-grant').map(event => event.type)).toEqual(['authority.DENIED']);
    const quotesBeforeReplay = quote.mock.calls.length;
    expect(await call(initialClient, 'intent-no-grant')).toMatchObject({ reused: true,
      decision: { decision: 'DENIED', reason: 'SPEND_GRANT_REQUIRED' } });
    expect(quote).toHaveBeenCalledTimes(quotesBeforeReplay);

    app.createSpendGrant({ totalLimit: '5000000', singleLimit: '500000', expiresAt: now + 180_000 });
    const active = readConnection(directory);
    expect(active.capabilities).toEqual(['read', 'request_purchase']);
    expect(active.token).not.toBe(first.token);
    expect((await purchaseRequest(origin, first.token, 'intent-stale-before-revoke')).status).toBe(401);
    expect(app.ledger.get('intent-stale-before-revoke')).toBeUndefined();
    const activeClient = await connect();
    const overLimit = await call(activeClient, 'intent-active-over-limit', 'premium');
    expect(overLimit).toMatchObject({
      status: 'DENIED', decision: { decision: 'DENIED', reason: 'SPEND_GRANT_SINGLE_LIMIT_EXCEEDED' },
    });
    expect(overLimit).not.toHaveProperty('resource');
    expect(await call(activeClient, 'intent-active-approved')).toMatchObject({
      status: 'APPROVED', decision: { decision: 'APPROVED', reason: 'AUTHORITY_BUDGET_AND_GRANT_PASSED' },
    });
    expect(executeApprovedPayment).toHaveBeenCalledOnce();
    vi.mocked(executeApprovedPayment).mockClear();

    const beforeBudget = app.ledger.managedSummary(now, 'live_devnet');
    const beforeCommitted = app.spendGrantSummary()?.committed;
    app.revokeSpendGrant();
    const revoked = readConnection(directory);
    expect(revoked.capabilities).toEqual(['read', 'request_purchase']);
    expect(revoked.token).not.toBe(active.token);
    expect((await purchaseRequest(origin, active.token, 'intent-stale-after-revoke')).status).toBe(401);
    expect(app.ledger.get('intent-stale-after-revoke')).toBeUndefined();
    const revokedClient = await connect();
    const revokedResult = await call(revokedClient, 'intent-revoked');
    expect(revokedResult).toMatchObject({
      status: 'DENIED', executionMode: 'live_devnet', decision: { decision: 'DENIED', reason: 'SPEND_GRANT_REVOKED' },
      paymentStatus: 'NOT_STARTED', deliveryStatus: 'NOT_DELIVERED', reused: false,
    });
    expect(revokedResult).not.toHaveProperty('resource');
    const denied = app.ledger.get('intent-revoked');
    expect(denied).toMatchObject({ status: 'DENIED', paymentPayloadPresent: false });
    expect(denied).not.toHaveProperty('transaction');
    expect(denied).not.toHaveProperty('data');
    expect(app.ledger.events('intent-revoked').map(event => event.type)).toEqual(['authority.DENIED']);
    expect(app.ledger.managedSummary(now, 'live_devnet')).toEqual(beforeBudget);
    expect(app.spendGrantSummary()?.committed).toBe(beforeCommitted);
    expect(store.getByQuote(String(denied?.quote.extra?.memo))).toBeUndefined();

    app.createSpendGrant({ totalLimit: '5000000', singleLimit: '500000', expiresAt: now + 90_000 });
    now += 90_001;
    const expiredClient = await connect();
    const expiredResult = await call(expiredClient, 'intent-expired');
    expect(expiredResult).toMatchObject({
      status: 'DENIED', decision: { decision: 'DENIED', reason: 'SPEND_GRANT_EXPIRED' },
      paymentStatus: 'NOT_STARTED', deliveryStatus: 'NOT_DELIVERED',
    });
    expect(expiredResult).not.toHaveProperty('resource');

    expect((await purchaseRequest(origin, 'invalid-token', 'intent-invalid-token')).status).toBe(401);
    expect(app.ledger.get('intent-invalid-token')).toBeUndefined();
    const crossOrigin = await fetch(`${origin}/api/agent/purchases`, { method: 'POST',
      headers: { authorization: `Bearer ${readConnection(directory).token}`, origin: 'https://untrusted.invalid', 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'intent-cross-origin', offerId: 'basic', reason: 'Check origin validation' }) });
    expect(crossOrigin.status).toBe(401);
    expect(app.ledger.get('intent-cross-origin')).toBeUndefined();
    const beforeDisable = readConnection(directory);
    app.setAgentConnection(false, origin);
    expect((await purchaseRequest(origin, beforeDisable.token, 'intent-disabled')).status).toBe(401);
    expect(app.ledger.get('intent-disabled')).toBeUndefined();
    app.setAgentConnection(true, origin);
    const memberToken = readConnection(directory).token;
    app.ledger.revokeCardMember(first.cardMemberId, now + 1);
    expect((await purchaseRequest(origin, memberToken, 'intent-revoked-member')).status).toBe(401);
    expect(app.ledger.get('intent-revoked-member')).toBeUndefined();

    expect(executeApprovedPayment).not.toHaveBeenCalled();
    expect(recoverApprovedPayment).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(savePayload).not.toHaveBeenCalled();
    expect(loadBuyerSigner).not.toHaveBeenCalled();
    expect(facilitator.verify).not.toHaveBeenCalled();
    expect(facilitator.settle).not.toHaveBeenCalled();
  } finally {
    for (const { client, transport } of clients) { await client.close(); await transport.close(); }
    await new Promise<void>(done => http.close(() => done()));
    app.ledger.close(); store.close();
    if (previous === undefined) delete state.__app2049; else state.__app2049 = previous;
    vi.unstubAllEnvs(); vi.clearAllMocks();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

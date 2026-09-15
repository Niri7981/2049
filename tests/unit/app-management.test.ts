import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaymentRequirements } from '@x402/core/types';
import { AppRuntime } from '../../src/modules/app/app-runtime';
import { requireManagementRequest } from '../../src/modules/app/management-auth';
import { PurchaseLedger } from '../../src/modules/purchases/purchase-ledger';
import { DEVNET_NETWORK, DEVNET_USDC_MINT } from '../../src/modules/payment/payment-config';
import { createStaticResourceRegistry } from '../../src/modules/resources/static-resource-registry';
import { hash, PurchaseSchema } from '../../src/modules/purchases/spending-policy';
import { paymentBinding, paymentEndpoint, recoverApprovedPayment } from '../../src/modules/purchases/approved-payment';
import { loadPaymentConfig } from '../../src/modules/payment/payment-config';

vi.mock('../../src/modules/purchases/approved-payment', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/modules/purchases/approved-payment')>();
  return { ...original, recoverApprovedPayment: vi.fn() };
});

const address = 'BSEDrH4umjwCKUL5TqYm69ffsSjwWcV2BXQkczVp1F52';
const dirs: string[] = [];
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); delete process.env.APP2049_MANAGEMENT_TOKEN; delete process.env.APP2049_ENABLE_DEVNET_PURCHASES; for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function runtime(timeZone = 'America/Los_Angeles', now?: () => number) {
  const dir = mkdtempSync(join(tmpdir(), 'app2049-')); dirs.push(dir);
  return new AppRuntime(dir, { initializeWallet: async () => ({ address, reused: true }), timeZone: () => timeZone, now });
}

describe('authenticated local management boundary', () => {
  it('rejects missing, wrong, and cross-site credentials', () => {
    process.env.APP2049_MANAGEMENT_TOKEN = 'a'.repeat(32);
    const request = (authorization?: string, site?: string) => new Request('http://127.0.0.1:3049/api/app/overview', { headers: { host: '127.0.0.1:3049', ...(authorization ? { authorization } : {}), ...(site ? { 'sec-fetch-site': site } : {}) } });
    expect(() => requireManagementRequest(request())).toThrow('UNAUTHORIZED');
    expect(() => requireManagementRequest(request(`Bearer ${'b'.repeat(32)}`))).toThrow('UNAUTHORIZED');
    expect(() => requireManagementRequest(request(`Bearer ${'a'.repeat(32)}`, 'cross-site'))).toThrow('跨站');
    expect(() => requireManagementRequest(request(`Bearer ${'a'.repeat(32)}`))).not.toThrow();
  });
});

describe('managed budget and Devnet test records', () => {
  it('quit waits for a request loading its wallet and prevents it from making a purchase', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'app2049-drain-')); dirs.push(dir);
    let release!: () => void;
    let entered!: () => void;
    const loading = new Promise<void>(resolve => { entered = resolve; });
    const app = new AppRuntime(dir, { initializeWallet: async () => {
      entered(); await new Promise<void>(resolve => { release = resolve; });
      return { address, reused: true };
    } });
    try {
      app.setDailyLimit('100000');
      const payment = app.createTestPurchase('quit-race', 'http://127.0.0.1:3049');
      const rejected = expect(payment).rejects.toThrow('正在退出');
      await loading;
      let ready = false;
      const quit = app.prepareQuit().then(() => { ready = true; });
      await Promise.resolve(); expect(ready).toBe(false);
      await expect(app.createTestPurchase('after-quit', 'http://127.0.0.1:3049')).rejects.toThrow('正在退出');
      release(); await rejected; await quit;
      expect(ready).toBe(true); expect(app.ledger.list()).toHaveLength(0);
    } finally { app.ledger.close(); }
  });

  it('startup recovers original pending purchases once even when paused and live purchases are disabled', async () => {
    vi.stubEnv('DEMO_MERCHANT_PUBLIC_KEY', '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs');
    vi.stubEnv('SOLANA_CLUSTER', 'devnet');
    const app = runtime();
    const origin = 'http://127.0.0.1:3049';
    const config = loadPaymentConfig({ DEMO_BUYER_PUBLIC_KEY: address, DEMO_MERCHANT_PUBLIC_KEY: '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs' });
    const resource = createStaticResourceRegistry({ endpoint: 'https://example.com', asset_id: config.mint, network: config.network, allowed_pay_to: config.merchant })[0];
    const quote = { scheme: 'exact', network: config.network, asset: config.mint, amount: '10000', payTo: config.merchant, maxTimeoutSeconds: 300, extra: {} };
    const now = Date.now();
    app.setDailyLimit('100000');
    const record = app.ledger.reserve(PurchaseSchema.parse({ id: randomUUID(), taskId: 'startup-original', taskHash: hash('task'), resourceId: resource.resource_id, providerId: resource.provider_id, input: { asset: 'SOL' }, amount: 10000, currency: 'USDC', decimals: 6, mint: config.mint, network: config.network, payTo: config.merchant, scheme: 'exact', quoteFingerprint: hash(quote), createdAt: now, expiresAt: now + 300000, binding: paymentBinding(config, paymentEndpoint(origin)) }), quote, resource);
    app.ledger.claim(record.approvalId);
    app.ledger.savePayload(record.approvalId, { x402Version: 2, accepted: quote, payload: { transaction: 'test-wire' } });
    app.setPaused(true);
    let release!: () => void;
    let entered!: () => void;
    const recovering = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(recoverApprovedPayment).mockImplementationOnce(async () => {
      entered(); await new Promise<void>(resolve => { release = resolve; });
      return undefined;
    });
    try {
      const startup = app.start(origin); const repeated = app.start(origin);
      await recovering;
      let ready = false; const quit = app.prepareQuit().then(() => { ready = true; });
      await Promise.resolve(); expect(ready).toBe(false);
      release(); await Promise.all([startup, repeated, quit]);
      expect(recoverApprovedPayment).toHaveBeenCalledTimes(1);
      expect(vi.mocked(recoverApprovedPayment).mock.calls[0]?.[1]).toBe('startup-original');
      expect(app.ledger.get('startup-original')?.status).toBe('PAYING');
      expect(app.ledger.controls().paused).toBe(true);
    } finally { app.ledger.close(); }
  });
  it('reports zero for an unfunded wallet and fails closed on malformed RPC data', async () => {
    const app = runtime();
    try {
      const empty = await app.balance(address, async () => Response.json({ jsonrpc: '2.0', id: 1, result: { value: null } }));
      const malformed = await app.balance(address, async () => Response.json({ jsonrpc: '2.0', id: 1, result: { value: { owner: 'wrong' } } }));
      expect(empty).toEqual({ amount: '0', display: '0.00 test USDC', available: true });
      expect(malformed.available).toBe(false);
    } finally { app.ledger.close(); }
  });

  it('starts without an implicit limit and blocks zero-limit and paused purchases', async () => {
    const app = runtime();
    try {
      expect(app.ledger.managedSummary().dailyLimit).toBeNull();
      let result = await app.createTestPurchase(`app-${randomUUID()}`, 'http://127.0.0.1:3049');
      expect(result.policy.reason).toBe('DAILY_LIMIT_NOT_SET');
      app.setDailyLimit('0');
      result = await app.createTestPurchase(`app-${randomUUID()}`, 'http://127.0.0.1:3049');
      expect(result.policy.reason).toBe('DAILY_LIMIT_ZERO');
      app.setDailyLimit('100000'); app.setPaused(true);
      result = await app.createTestPurchase(`app-${randomUUID()}`, 'http://127.0.0.1:3049');
      expect(result.policy.reason).toBe('PAYMENTS_PAUSED');
    } finally { app.ledger.close(); }
  });

  it('records a simulated purchase once and persists settings and history after restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'app2049-restart-')); dirs.push(dir);
    const create = () => new AppRuntime(dir, { initializeWallet: async () => ({ address, reused: true }), timeZone: () => 'America/Los_Angeles' });
    const app = create(); const id = `app-${randomUUID()}`;
    try {
      app.setDailyLimit('20000');
      const first = await app.createTestPurchase(id, 'http://127.0.0.1:3049');
      const replay = await app.createTestPurchase(id, 'http://127.0.0.1:3049');
      expect(first.status).toBe('PAID'); expect(replay.status).toBe('PAID');
      expect(app.ledger.list()).toHaveLength(1);
      app.setDailyLimit('5000');
      const blocked = await app.createTestPurchase(`app-${randomUUID()}`, 'http://127.0.0.1:3049');
      expect(blocked.policy.reason).toBe('DAILY_BUDGET_EXCEEDED');
      app.setPaused(true);
    } finally { app.ledger.close(); }
    const restarted = create();
    try { expect(restarted.ledger.managedSummary()).toMatchObject({ dailyLimit: '5000', paid: '10000', remaining: '0', paused: true }); expect(restarted.ledger.list()).toHaveLength(2); }
    finally { restarted.ledger.close(); }
  });

  it('advances at local midnight without allowing a time-zone change or clock rollback to open another window', () => {
    let zone = 'America/Los_Angeles';
    const start = Date.parse('2026-09-14T06:00:00Z');
    const dir = mkdtempSync(join(tmpdir(), 'app2049-clock-')); dirs.push(dir);
    const app = new AppRuntime(dir, { initializeWallet: async () => ({ address, reused: true }), timeZone: () => zone, now: () => start });
    try {
      expect(app.ledger.managedSummary(start).day).toBe('2026-09-13');
      zone = 'Asia/Shanghai';
      expect(app.ledger.managedSummary(Date.parse('2026-09-14T06:30:00Z')).day).toBe('2026-09-13');
      expect(app.ledger.managedSummary(Date.parse('2026-09-14T07:00:00Z')).day).toBe('2026-09-14');
      expect(app.ledger.managedSummary(Date.parse('2026-09-14T06:45:00Z')).day).toBe('2026-09-14');
    }
    finally { app.ledger.close(); }
  });

  it('serializes two clients against one shared managed limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'app2049-concurrent-')); dirs.push(dir);
    const make = () => new AppRuntime(dir, { initializeWallet: async () => ({ address, reused: true }), timeZone: () => 'Asia/Shanghai' });
    const first = make(); const second = make();
    try {
      first.setDailyLimit('10000');
      const results = await Promise.all([first.createTestPurchase(`app-${randomUUID()}`, 'http://127.0.0.1:3049'), second.createTestPurchase(`app-${randomUUID()}`, 'http://127.0.0.1:3049')]);
      expect(results.map(result => result.status).sort()).toEqual(['PAID', 'REJECTED']);
      expect(first.ledger.managedSummary()).toMatchObject({ paid: '10000', remaining: '0' });
    } finally { first.ledger.close(); second.ledger.close(); }
  });

  it('rechecks pause and a lowered limit before signing and before submission', () => {
    const now = Date.parse('2026-09-14T08:00:00Z');
    const ledger = new PurchaseLedger(':memory:', { managed: true, timeZone: () => 'Asia/Shanghai', now: () => now });
    const merchant = '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs';
    const resource = createStaticResourceRegistry({ endpoint: 'https://purchase.local.invalid/api/paid/market-snapshot', asset_id: DEVNET_USDC_MINT, network: DEVNET_NETWORK, allowed_pay_to: merchant })[0];
    const quote: PaymentRequirements = { scheme: 'exact', network: DEVNET_NETWORK, asset: DEVNET_USDC_MINT, amount: '10000', payTo: merchant, maxTimeoutSeconds: 300, extra: {} };
    const purchase = PurchaseSchema.parse({ id: randomUUID(), taskId: 'pause-race', taskHash: hash('task'), resourceId: resource.resource_id, providerId: resource.provider_id,
      input: { asset: 'SOL' }, amount: 10000, currency: 'USDC', decimals: 6, mint: DEVNET_USDC_MINT, network: DEVNET_NETWORK, payTo: merchant,
      scheme: 'exact', quoteFingerprint: hash(quote), createdAt: now, expiresAt: now + 300_000, binding: 'test' });
    try {
      ledger.setDailyLimit('20000'); const reserved = ledger.reserve(purchase, quote, resource, now);
      ledger.setPaused(true); expect(() => ledger.claim(reserved.approvalId, now)).toThrow('paused');
      ledger.setPaused(false); ledger.setDailyLimit('5000'); expect(() => ledger.claim(reserved.approvalId, now)).toThrow('no longer covers');
      ledger.setDailyLimit('20000'); ledger.claim(reserved.approvalId, now); ledger.setPaused(true);
      expect(() => ledger.savePayload(reserved.approvalId, { signed: 'fixture' })).toThrow('paused before submission');
      expect(ledger.savedPayload(reserved.approvalId)).toBeUndefined();
    } finally { ledger.close(); }
  });
});

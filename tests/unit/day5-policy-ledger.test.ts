import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import { DEVNET_NETWORK, DEVNET_USDC_MINT } from '../../src/modules/payment/day4-config';
import { createStaticResourceRegistry } from '../../src/modules/resources/static-resource-registry';
import { hash, evaluatePurchase, spendingDay, type Purchase } from '../../src/modules/purchases/spending-policy';
import { PurchaseLedger } from '../../src/modules/purchases/purchase-ledger';
import type { PaymentRequirements } from '@x402/core/types';
const now = Date.parse('2026-09-09T12:00:00Z');
const resource = createStaticResourceRegistry({ endpoint: 'https://example.com', asset_id: DEVNET_USDC_MINT, network: DEVNET_NETWORK, allowed_pay_to: '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs' })[0];
function fixture(amount = 10000) {
  const quote: PaymentRequirements = { scheme: 'exact', network: DEVNET_NETWORK, asset: DEVNET_USDC_MINT, amount: String(amount), payTo: resource.allowed_pay_to, maxTimeoutSeconds: 300, extra: {} };
  const purchase: Purchase = { id: randomUUID(), taskId: randomUUID(), taskHash: hash('task'), resourceId: resource.resource_id, providerId: resource.provider_id, input: { asset: 'SOL' }, amount, currency: 'USDC', decimals: 6, mint: DEVNET_USDC_MINT, network: DEVNET_NETWORK, payTo: resource.allowed_pay_to, scheme: 'exact', quoteFingerprint: hash(quote), createdAt: now, expiresAt: now + 300000, binding: 'fixed-config' };
  return { quote, purchase, resource: { ...resource, expected_price_minor: amount } };
}
describe('deterministic spending policy', () => {
  it.each([[10000, 0, 'APPROVED'], [100000, 900000, 'APPROVED'], [110000, 0, 'NEEDS_CONFIRMATION'], [100000, 910000, 'REJECTED']])('amount %s with committed %s gives %s', (amount, committed, expected) => {
    const f = fixture(Number(amount));
    expect(evaluatePurchase(f.purchase, f.resource, f.quote, { committed: Number(committed), hasUnknown: false }, now).decision).toBe(expected);
  });
  it.each(['mint', 'network', 'payTo', 'scheme', 'providerId', 'resourceId', 'quoteFingerprint'] as const)('rejects changed %s', field => {
    const f = fixture();
    expect(evaluatePurchase({ ...f.purchase, [field]: 'wrong' }, f.resource, f.quote, { committed: 0, hasUnknown: false }, now).decision).toBe('REJECTED');
  });
  it('rejects expired quotes, disabled resources, dynamic prices, unknown payments and malformed amounts', () => {
    const f = fixture();
    for (const amount of [0, -1, 0.1, Number.MAX_SAFE_INTEGER + 1]) expect(evaluatePurchase({ ...f.purchase, amount }, f.resource, f.quote, { committed: 0, hasUnknown: false }, now).decision).toBe('REJECTED');
    expect(evaluatePurchase(f.purchase, f.resource, f.quote, { committed: 0, hasUnknown: false }, now + 300000).decision).toBe('REJECTED');
    expect(evaluatePurchase(f.purchase, { ...f.resource, enabled: false }, f.quote, { committed: 0, hasUnknown: false }, now).decision).toBe('REJECTED');
    expect(evaluatePurchase(f.purchase, { ...f.resource, expected_price_minor: 20000 }, f.quote, { committed: 0, hasUnknown: false }, now).decision).toBe('REJECTED');
    expect(evaluatePurchase(f.purchase, f.resource, f.quote, { committed: 0, hasUnknown: true }, now).decision).toBe('REJECTED');
  });
  it('uses Shanghai midnight and canonical quote fingerprints', () => {
    expect(spendingDay(Date.parse('2026-09-09T15:59:59Z'))).toBe('2026-09-09');
    expect(spendingDay(Date.parse('2026-09-09T16:00:00Z'))).toBe('2026-09-10');
    expect(hash({ b: 2, a: { d: 4, c: 3 } })).toBe(hash({ a: { c: 3, d: 4 }, b: 2 }));
  });
});
describe('durable approval and budget ledger', () => {
  it('reuses a task purchase, rejects changed input and permits only one claim', () => {
    const ledger = new PurchaseLedger(':memory:');
    try {
      const f = fixture();
      const first = ledger.reserve(f.purchase, f.quote, f.resource, now);
      expect(ledger.summary(now)).toEqual({ paidUSDC: 0, reservedUSDC: 0.01, remainingUSDC: 0.99, unresolved: 0 });
      expect(ledger.reserve({ ...f.purchase, id: randomUUID() }, f.quote, f.resource, now).approvalId).toBe(first.approvalId);
      expect(() => ledger.reserve({ ...f.purchase, taskHash: 'changed' }, f.quote, f.resource, now)).toThrow();
      ledger.claim(first.approvalId, now);
      expect(() => ledger.claim(first.approvalId, now)).toThrow();
      ledger.unknown(first.approvalId);
      expect(ledger.summary(now).unresolved).toBe(1);
      const next = fixture();
      expect(ledger.reserve(next.purchase, next.quote, next.resource, now).decision.reason).toBe('LEDGER_UNRESOLVED');
    } finally { ledger.close(); }
  });
  it('reserves pending budgets across two connections and survives restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'day5-ledger-'));
    const path = join(dir, 'ledger.sqlite');
    const a = new PurchaseLedger(path), b = new PurchaseLedger(path);
    try {
      for (let i = 0; i < 10; i++) {
        const f = fixture(100000);
        expect((i % 2 ? a : b).reserve(f.purchase, f.quote, f.resource, now).status).toBe('APPROVED');
      }
      const f = fixture();
      expect(b.reserve(f.purchase, f.quote, f.resource, now).decision.reason).toBe('DAILY_BUDGET_EXCEEDED');
      const c = new PurchaseLedger(path);
      try { expect(c.get(f.purchase.taskId)?.status).toBe('REJECTED'); } finally { c.close(); }
    } finally { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('a crash after claim remains locked after reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'day5-crash-')); const path = join(dir, 'ledger.sqlite');
    const a = new PurchaseLedger(path); const f = fixture();
    const r = a.reserve(f.purchase, f.quote, f.resource, now); a.claim(r.approvalId, now); a.close();
    const b = new PurchaseLedger(path);
    try { expect(() => b.claim(r.approvalId, now)).toThrow(); expect(b.get(f.purchase.taskId)?.status).toBe('PAYING'); }
    finally { b.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

it('expired unclaimed approvals release budget but claimed payments stay frozen', () => {
  const ledger = new PurchaseLedger(':memory:');
  try {
    const first = fixture(100000); const claimed = fixture(100000);
    ledger.reserve(first.purchase, first.quote, first.resource, now);
    const record = ledger.reserve(claimed.purchase, claimed.quote, claimed.resource, now);
    ledger.claim(record.approvalId, now);
    ledger.releaseExpired(now + 300001);
    expect(ledger.get(first.purchase.taskId)?.status).toBe('EXPIRED');
    expect(ledger.get(claimed.purchase.taskId)?.status).toBe('PAYING');
    expect(ledger.summary(now + 300001)).toEqual({ paidUSDC: 0, reservedUSDC: 0.1, remainingUSDC: 0.9, unresolved: 1 });
    expect(() => ledger.claim(record.approvalId, now + 300001)).toThrow();
    const next = fixture(); next.purchase.createdAt += 300001; next.purchase.expiresAt += 300001;
    expect(ledger.reserve(next.purchase, next.quote, next.resource, now + 300001).decision.reason).toBe('LEDGER_UNRESOLVED');
  } finally { ledger.close(); }
});
it('a new purchase can use released expired budget', () => {
  const ledger = new PurchaseLedger(':memory:');
  try {
    for (let i = 0; i < 10; i++) { const f = fixture(100000); ledger.reserve(f.purchase, f.quote, f.resource, now); }
    const next = fixture(100000); next.purchase.createdAt += 300001; next.purchase.expiresAt += 300001;
    expect(ledger.reserve(next.purchase, next.quote, next.resource, now + 300001).status).toBe('APPROVED');
  } finally { ledger.close(); }
});

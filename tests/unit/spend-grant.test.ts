import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { PaymentRequirements } from '@x402/core/types';
import { LEGACY_MARKET_SNAPSHOT_OPERATION as MARKET_SNAPSHOT_OPERATION, type SpendAuthorityBinding } from '../../src/modules/authority/spend-grant';
import { SpendIntentSchema } from '../../src/modules/authority/spend-intent';
import { DEVNET_NETWORK, DEVNET_USDC_MINT } from '../../src/modules/payment/payment-config';
import { PurchaseLedger } from '../../src/modules/purchases/purchase-ledger';
import { DEMO_MARKET_DATA_PROVIDER_ID, PREMIUM_SOL_MARKET_SNAPSHOT_ID } from '../../src/modules/resources/static-resource-registry';
import { demoSnapshot } from '../../src/modules/paid-market-api/paid-market-api';

const paths: string[] = [];
afterEach(() => paths.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
const now = Date.parse('2026-09-21T12:00:00Z');
const cardMemberId = '11111111-1111-4111-8111-111111111111';
const principal = { cardMemberId, connectionId: '2c187121-f6f1-49a3-aea4-821c4bc0a662', connectionGeneration: 2 };
const scope = { resourceId: PREMIUM_SOL_MARKET_SNAPSHOT_ID, providerId: DEMO_MARKET_DATA_PROVIDER_ID, operation: MARKET_SNAPSHOT_OPERATION,
  network: DEVNET_NETWORK, assetId: DEVNET_USDC_MINT, assetDecimals: 6, payTo: '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs', paymentScheme: 'exact' };
const quote: PaymentRequirements = { scheme: 'exact', network: DEVNET_NETWORK, asset: DEVNET_USDC_MINT, amount: '200000',
  payTo: '4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs', maxTimeoutSeconds: 300, extra: {} };

function ledger(path = ':memory:') {
  const value = new PurchaseLedger(path, { managed: true, requireSpendGrant: true, now: () => now, timeZone: () => 'Asia/Shanghai', defaultCardMemberId: cardMemberId });
  value.setDailyLimit('50000000');
  return value;
}
function authority(value: PurchaseLedger, totalLimit = '5000000', singleLimit = '500000'): SpendAuthorityBinding {
  value.createSpendGrant({ totalLimit, singleLimit, expiresAt: now + 60 * 60 * 1000 }, principal, scope, now);
  return value.spendAuthority(principal, MARKET_SNAPSHOT_OPERATION, now);
}
function intent(id: string, amount: number, binding?: SpendAuthorityBinding, overrides: Record<string, unknown> = {}) {
  return SpendIntentSchema.parse({ id: randomUUID(), idempotencyKey: id, requestHash: `hash-${id}`, resourceId: scope.resourceId, providerId: scope.providerId,
    network: scope.network, assetId: scope.assetId, assetDecimals: scope.assetDecimals, amount, currency: 'USDC',
    payTo: scope.payTo, paymentScheme: scope.paymentScheme, quoteFingerprint: `quote-${id}`, createdAt: now, expiresAt: now + 300_000,
    executionBinding: 'test-binding', ...(binding ? { authority: binding } : {}), ...overrides });
}

it('requires a grant and approves 0.20 USDC above the old implicit single limit', () => {
  const value = ledger();
  try {
    expect(value.reserve(intent('without-grant', 200_000), quote, now).decision.reason).toBe('SPEND_GRANT_REQUIRED');
    const binding = authority(value);
    const approved = value.reserve(intent('within-grant', 200_000, binding), quote, now);
    expect(approved.decision).toMatchObject({ decision: 'APPROVED', reason: 'AUTHORITY_BUDGET_AND_GRANT_PASSED' });
    expect(value.spendGrantSummary(now)).toMatchObject({ committed: '200000', remaining: '4800000', status: 'ACTIVE' });
  } finally { value.close(); }
});

it('isolates simulated PAID amounts from live daily and SpendGrant accounting', () => {
  const value = ledger();
  try {
    const binding = authority(value, '500000', '500000');
    const reserved = value.reserve(intent('simulated-accounting', 200_000, binding), quote, now, 'simulated');
    expect(reserved.decision.decision).toBe('APPROVED');
    value.claim(reserved.approvalId, now);
    value.finish(reserved.approvalId, { transaction: 'simulated-accounting', data: demoSnapshot }, now);

    expect(value.managedSummary(now, 'simulated')).toMatchObject({ paid: '200000', remaining: '49800000' });
    expect(value.managedSummary(now, 'live_devnet')).toMatchObject({ paid: '0', remaining: '50000000' });
    expect(value.spendGrantSummary(now, 'simulated')).toMatchObject({ committed: '200000', remaining: '300000' });
    expect(value.spendGrantSummary(now, 'live_devnet')).toMatchObject({ committed: '0', remaining: '500000' });
  } finally { value.close(); }
});

it('releases expired simulated approvals while reading the shared managed budget', () => {
  const value = ledger();
  try {
    value.setDailyLimit('1000000');
    const binding = authority(value, '400000', '200000');
    const requestId = 'simulated-expiring-budget';
    expect(value.reserve(intent(requestId, 200_000, binding), quote, now, 'simulated').status).toBe('APPROVED');

    expect(value.managedSummary(now + 299_999, 'simulated')).toMatchObject({ paid: '0', reserved: '200000', remaining: '800000' });
    expect(value.get(requestId)?.status).toBe('APPROVED');

    expect(value.managedSummary(now + 300_000, 'simulated')).toMatchObject({ paid: '0', reserved: '0', remaining: '1000000' });
    expect(value.get(requestId)?.status).toBe('EXPIRED');
  } finally { value.close(); }
});

it('denies an oversized amount and every scope or principal mismatch', () => {
  const value = ledger();
  try {
    const binding = authority(value);
    expect(value.reserve(intent('oversized', 20_000_000, binding), { ...quote, amount: '20000000' }, now).decision.reason).toBe('SPEND_GRANT_SINGLE_LIMIT_EXCEEDED');
    expect(value.reserve(intent('wrong-provider', 10_000, binding, { providerId: 'other-provider' }), quote, now).decision.reason).toBe('SPEND_GRANT_SCOPE_MISMATCH');
    expect(value.reserve(intent('wrong-payee', 10_000, binding, { payTo: 'different-recipient' }), quote, now).decision.reason).toBe('SPEND_GRANT_SCOPE_MISMATCH');
    expect(value.reserve(intent('rotated-credential', 10_000, { ...binding, connectionGeneration: 99 }), quote, now).decision.reason).toBe('AUTHORITY_BUDGET_AND_GRANT_PASSED');
    expect(value.reserve(intent('revoked-member', 10_000, { ...binding, cardMemberId: randomUUID() }), quote, now).decision.reason).toBe('CARD_MEMBER_REVOKED');
  } finally { value.close(); }
});

it('serializes the lifetime total across two ledger clients', () => {
  const directory = mkdtempSync(join(tmpdir(), '2049-grant-')); paths.push(directory);
  const path = join(directory, 'ledger.sqlite');
  const first = ledger(path); const second = ledger(path);
  try {
    const binding = authority(first, '300000', '300000');
    const results = [first.reserve(intent('first', 200_000, binding), quote, now), second.reserve(intent('second', 200_000, binding), quote, now)];
    expect(results.map(result => result.decision.reason).sort()).toEqual(['AUTHORITY_BUDGET_AND_GRANT_PASSED', 'SPEND_GRANT_TOTAL_LIMIT_EXCEEDED']);
    expect(second.spendGrantSummary(now)?.committed).toBe('200000');
  } finally { first.close(); second.close(); }
});

it('reuses an idempotent request across connections for the same CardMember', () => {
  const value = ledger();
  try {
    const first = authority(value);
    value.reserve(intent('owned-request', 200_000, first), quote, now);
    const replacementPrincipal = { cardMemberId, connectionId: randomUUID(), connectionGeneration: 1 };
    value.createSpendGrant({ totalLimit: '5000000', singleLimit: '500000', expiresAt: now + 60 * 60 * 1000 }, replacementPrincipal, scope, now + 1);
    const replacement = value.spendAuthority(replacementPrincipal, MARKET_SNAPSHOT_OPERATION, now + 1);
    const replay = value.reserve(intent('owned-request', 200_000, replacement), quote, now + 1);
    expect(replay.ownerCardMemberId).toBe(cardMemberId);
  } finally { value.close(); }
});

it('scopes grants and requestIds per member while enforcing one shared daily budget', () => {
  const directory = mkdtempSync(join(tmpdir(), '2049-member-budget-')); paths.push(directory);
  const path = join(directory, 'ledger.sqlite');
  const value = ledger(path);
  try {
    value.setDailyLimit('300000');
    const first = authority(value);
    const secondMember = value.createCardMember('Research', now);
    const secondPrincipal = { cardMemberId: secondMember.id, connectionId: randomUUID(), connectionGeneration: 1 };
    value.createSpendGrant({ totalLimit: '500000', singleLimit: '500000', expiresAt: now + 60 * 60 * 1000 }, secondPrincipal, scope, now);
    const second = value.spendAuthority(secondPrincipal, MARKET_SNAPSHOT_OPERATION, now);
    const firstPurchase = value.reserve(intent('shared-id', 200_000, first), quote, now, 'simulated', cardMemberId);
    const secondPurchase = value.reserve(intent('shared-id', 200_000, second), quote, now, 'simulated', secondMember.id);
    expect(firstPurchase.decision.decision).toBe('APPROVED');
    expect(secondPurchase.decision.reason).toBe('DAILY_BUDGET_EXCEEDED');
    expect(firstPurchase.intent.id).not.toBe(secondPurchase.intent.id);
    expect(value.list(50, cardMemberId)).toHaveLength(1);
    expect(value.list(50, secondMember.id)).toHaveLength(1);
    expect(value.spendGrantSummary(now, 'simulated', cardMemberId)).toMatchObject({ status: 'ACTIVE', committed: '200000' });
    expect(value.spendGrantSummary(now, 'simulated', secondMember.id)).toMatchObject({ status: 'ACTIVE', committed: '0' });
    const concurrentReader = new PurchaseLedger(path, { managed: true, requireSpendGrant: true, now: () => now, timeZone: () => 'Asia/Shanghai' });
    try {
      expect(concurrentReader.spendGrantSummary(now, 'simulated', cardMemberId)?.status).toBe('ACTIVE');
      expect(concurrentReader.spendGrantSummary(now, 'simulated', secondMember.id)?.status).toBe('ACTIVE');
    } finally { concurrentReader.close(); }
    value.revokeActiveSpendGrant(now + 1, 'grant.REVOKED', secondMember.id);
    expect(value.spendGrantSummary(now + 1, 'simulated', cardMemberId)?.status).toBe('ACTIVE');
    expect(value.spendGrantSummary(now + 1, 'simulated', secondMember.id)?.status).toBe('REVOKED');
  } finally { value.close(); }
  const reopened = ledger(path);
  try {
    expect(reopened.get('shared-id', cardMemberId)?.ownerCardMemberId).toBe(cardMemberId);
    expect(reopened.get('shared-id', reopened.cardMembers().find(member => member.label === 'Research')!.id)?.status).toBe('DENIED');
  } finally { reopened.close(); }
});

it('keeps payment state and events attached to the right owner for duplicate member requestIds', () => {
  const value = ledger();
  try {
    const first = authority(value);
    const secondMember = value.createCardMember('Buyer', now);
    const secondPrincipal = { cardMemberId: secondMember.id, connectionId: randomUUID(), connectionGeneration: 1 };
    value.createSpendGrant({ totalLimit: '500000', singleLimit: '500000', expiresAt: now + 60 * 60 * 1000 }, secondPrincipal, scope, now);
    const second = value.spendAuthority(secondPrincipal, MARKET_SNAPSHOT_OPERATION, now);
    const firstPurchase = value.reserve(intent('same-id', 200_000, first), quote, now, 'simulated', cardMemberId);
    const secondPurchase = value.reserve(intent('same-id', 200_000, second), quote, now, 'simulated', secondMember.id);
    value.claim(firstPurchase.approvalId, now);
    value.finish(firstPurchase.approvalId, { transaction: 'simulated-first', data: demoSnapshot }, now);
    value.claim(secondPurchase.approvalId, now);
    value.finish(secondPurchase.approvalId, { transaction: 'simulated-second', data: demoSnapshot }, now);
    expect(value.get('same-id', cardMemberId)?.transaction).toBe('simulated-first');
    expect(value.get('same-id', secondMember.id)?.transaction).toBe('simulated-second');
    expect(value.events('same-id', cardMemberId).map(event => event.type)).toContain('delivery.COMPLETE');
    expect(value.events('same-id', secondMember.id).map(event => event.type)).toContain('delivery.COMPLETE');
    expect(value.managedSummary(now, 'simulated')).toMatchObject({ paid: '400000' });
  } finally { value.close(); }
});

it('rechecks revocation and expiry before a reserved payment can sign', () => {
  const value = ledger();
  try {
    let binding = authority(value);
    let reserved = value.reserve(intent('revoked', 10_000, binding), quote, now);
    value.revokeActiveSpendGrant(now + 1);
    expect(() => value.claim(reserved.approvalId, now + 2)).toThrow('inactive or expired');

    binding = authority(value);
    reserved = value.reserve(intent('expired', 10_000, binding), quote, now);
    expect(() => value.claim(reserved.approvalId, now + 60 * 60 * 1000 + 1)).toThrow('inactive or expired');
  } finally { value.close(); }
});

it('persists grant history but an App restart can revoke the old connection-bound grant', () => {
  const directory = mkdtempSync(join(tmpdir(), '2049-grant-restart-')); paths.push(directory);
  const path = join(directory, 'ledger.sqlite');
  const first = ledger(path);
  try { authority(first); } finally { first.close(); }
  const reopened = ledger(path);
  try {
    expect(reopened.spendGrantSummary(now)?.status).toBe('ACTIVE');
    reopened.revokeActiveSpendGrant(now + 1, 'grant.REVOKED_BACKEND_RESTART');
    expect(reopened.spendGrantSummary(now + 1)?.status).toBe('REVOKED');
  } finally { reopened.close(); }
});

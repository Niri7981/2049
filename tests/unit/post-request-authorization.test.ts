import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PurchaseLedger } from '../../src/modules/purchases/purchase-ledger';
import { PAID_RESOURCE_PURCHASE_OPERATION } from '../../src/modules/authority/spend-grant';
import { X402ResourceSchema } from '../../src/modules/resources/http-resource';
import { assertGrantPostScope, postRequestPolicyHash } from '../../src/modules/resources/post-request-authorization';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { expect, it, vi } from 'vitest';
import { discoverResource, prepareDiscovery } from '../../src/modules/resources/mainnet-resource-discovery';
import { MAINNET_NETWORK, MAINNET_USDC_MINT } from '../../src/modules/payment/payment-environment';

const input = { url: 'https://unknown.example/analyze', method: 'POST', body: '{"prompt":"sample"}' };
const read = () => vi.fn().mockResolvedValue(new Headers({ 'payment-required': encodePaymentRequiredHeader({
  x402Version: 2, resource: { url: input.url }, accepts: [{ scheme: 'exact', network: MAINNET_NETWORK,
    asset: MAINNET_USDC_MINT, amount: '1000', payTo: '11111111111111111111111111111111',
    maxTimeoutSeconds: 300, extra: { feePayer: 'ComputeBudget111111111111111111111111111111' } }],
}) }));

it('requires trusted management approval before an exploratory POST can reach transport', async () => {
  const transport = read();
  await expect(discoverResource(input, transport)).rejects.toThrow('RESOURCE_POST_APPROVAL_REQUIRED');
  await expect(discoverResource({ ...input, approved: true }, transport)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});

it('prepares locally and binds confirmation to the exact destination, method, headers and body', async () => {
  const transport = read();
  const review = prepareDiscovery(input).review;
  expect(review.request).toMatchObject({ url: input.url, method: 'POST', body: input.body });
  expect(transport).not.toHaveBeenCalled();
  for (const changed of [{ ...input, body: '{"prompt":"changed"}' }, { ...input, url: 'https://other.example/analyze' }]) {
    await expect(discoverResource(changed, transport, review.requestHash)).rejects.toThrow('RESOURCE_POST_APPROVAL_REQUIRED');
  }
  expect(transport).not.toHaveBeenCalled();
  const result = await discoverResource(input, transport, review.requestHash);
  expect(result.paymentSent).toBe(false);
  expect(transport).toHaveBeenCalledOnce();
});

it('keeps historical grants fail closed and preserves confirmed POST scopes through restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'yosh-post-grant-'));
  const path = join(directory, 'ledger.sqlite');
  const options = { managed: true, requireSpendGrant: true, mode: 'live_mainnet' as const };
  let ledger = new PurchaseLedger(path, options);
  try {
    const resource = X402ResourceSchema.parse({ resourceId: 'post', providerId: 'generic', network: MAINNET_NETWORK,
      mint: MAINNET_USDC_MINT, decimals: 6, recipientSource: 'live_challenge', maximumAmount: '1000',
      request: { url: input.url, method: 'POST', access: 'https', headers: { 'content-type': 'application/json' }, body: input.body } });
    const principal = { cardMemberId: ledger.defaultCardMember().id, connectionId: randomUUID(), connectionGeneration: 1 };
    const now = Date.now(); const grantInput = { totalLimit: '2000', singleLimit: '1000', expiresAt: now + 3600000 };
    const scope = { resourceId: 'post', providerId: 'generic', operation: PAID_RESOURCE_PURCHASE_OPERATION,
      network: MAINNET_NETWORK, assetId: MAINNET_USDC_MINT, assetDecimals: 6, payTo: '11111111111111111111111111111111', paymentScheme: 'exact' };
    const original = ledger.createSpendGrant(grantInput, principal, scope, now, 'live_mainnet');
    expect(() => assertGrantPostScope(resource, ledger.spendGrantById(original.id))).toThrow('RESOURCE_POST_APPROVAL_REQUIRED');
    const historical = ledger.spendGrantById(original.id);
    ledger.close();
    const old = new DatabaseSync(path);
    old.exec("ALTER TABLE spend_grants DROP COLUMN post_policy_hash; DELETE FROM app_schema_migrations WHERE id='014_post_grant_consent';");
    old.close();
    ledger = new PurchaseLedger(path, options);
    expect(ledger.spendGrantById(original.id)).toEqual(historical);
    expect(() => assertGrantPostScope(resource, ledger.spendGrantById(original.id))).toThrow();
    const confirmed = ledger.createSpendGrant(grantInput, principal, { ...scope, postPolicyHash: postRequestPolicyHash(resource) }, now, 'live_mainnet');
    expect(ledger.spendGrantById(original.id)).toMatchObject({ totalLimit: '2000', singleLimit: '1000', status: 'REVOKED' });
    ledger.close(); ledger = new PurchaseLedger(path, options);
    const stored = ledger.spendGrantById(confirmed.id);
    expect(() => assertGrantPostScope(resource, stored)).not.toThrow();
    expect(() => assertGrantPostScope({ ...resource, request: { ...resource.request, body: '{"prompt":"changed"}' } }, stored)).toThrow();
    expect(() => assertGrantPostScope(resource, stored, grantInput.expiresAt)).toThrow();
    ledger.revokeActiveSpendGrant(now, 'grant.REVOKED', principal.cardMemberId, 'post');
    expect(() => assertGrantPostScope(resource, ledger.spendGrantById(confirmed.id))).toThrow();
  } finally { ledger.close(); rmSync(directory, { recursive: true, force: true }); }
});

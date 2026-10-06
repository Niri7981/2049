import type { PurchaseLedger } from '../../src/modules/purchases/purchase-ledger';
import type { SpendGrantInput, SpendGrantScope, SpendPrincipal } from '../../src/modules/authority/spend-grant';

/** Existing lifecycle suites exercise both test modes. Each gets explicit, separate authority. */
export function testModeGrants(ledger: PurchaseLedger, input: SpendGrantInput, principal: SpendPrincipal, scope: SpendGrantScope, now: number) {
  ledger.createSpendGrant(input, principal, scope, now, 'simulated');
  return ledger.createSpendGrant(input, principal, scope, now, 'live_devnet');
}
export function testModeDailyLimit(ledger: PurchaseLedger, value: string | null) {
  ledger.setDailyLimit(value, 'simulated');
  return ledger.setDailyLimit(value, 'live_devnet');
}

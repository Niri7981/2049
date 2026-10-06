import type { PaymentEnvironment } from '../payment/payment-environment';
import type { PurchaseLedger } from '../purchases/purchase-ledger';
import type { PaymentConfig } from '../payment/payment-config';

export type AuthorityWalletState = 'unavailable' | 'unverified' | 'available';

/** Read-only product facts. This is not a quote-specific authorization or a replacement payment gate. */
export function authoritySurface(ledger: PurchaseLedger, environment: PaymentEnvironment, memberId: string,
  wallet: { address: string; status: AuthorityWalletState; balance: string | null }, config: PaymentConfig | undefined, now: number) {
  const budget = ledger.managedSummary(now, environment.mode);
  const grant = ledger.spendGrantSummary(now, environment.mode, memberId);
  const assetLabel = environment.isProduction ? environment.asset.symbol : `Test ${environment.asset.symbol}`;
  const number = (value: string) => {
    const amount = BigInt(value); const divisor = 10n ** BigInt(environment.asset.decimals);
    const fraction = String(amount % divisor).padStart(environment.asset.decimals, '0').replace(/0+$/, '').padEnd(2, '0');
    return `${amount / divisor}.${fraction}`;
  };
  const dailyState = budget.dailyLimit === null ? 'required' : budget.paused ? 'paused'
    : BigInt(budget.remaining ?? '0') === 0n ? 'insufficient' : 'active';
  const resource = config?.registeredResources?.find(item => item.resourceId === grant?.resourceId);
  const scopeMatches = grant !== null && grant.network === environment.network && grant.assetId === environment.asset.mint
    && grant.assetDecimals === environment.asset.decimals;
  const registered = scopeMatches && (!environment.isProduction || (resource !== undefined
      && resource.providerId === grant.providerId && resource.recipient === grant.payTo
      && grant.operation === 'paid.resource.purchase' && grant.paymentScheme === 'exact'));
  const blockers: string[] = [];
  if (environment.isProduction) {
    if (!environment.productionExecutionEnabled) blockers.push('Mainnet execution is disabled');
    if (dailyState === 'required') blockers.push('Daily Authority required');
    else if (dailyState === 'paused') blockers.push('Payments are paused');
    else if (dailyState === 'insufficient') blockers.push('Insufficient available authority');
    if (!registered || grant?.status !== 'ACTIVE') blockers.push('Spend Grant required');
    else if (BigInt(grant.remaining) === 0n) blockers.push('Spend Grant exhausted');
    if (wallet.status === 'unavailable') blockers.push('Mainnet wallet unavailable');
    else if (wallet.status === 'unverified') blockers.push('Mainnet wallet verification required');
    if (!config) blockers.push('Registered API setup required');
    if (wallet.status === 'available') {
      if (wallet.balance === null) blockers.push('USDC balance not verified');
      else if (BigInt(wallet.balance) === 0n) blockers.push('Insufficient USDC');
    }
  }
  return { mode: environment.mode, network: environment.network, assetId: environment.asset.mint, assetDecimals: environment.asset.decimals,
    assetLabel, dailyLimit: budget.dailyLimit, available: budget.remaining, reserved: budget.reserved, paid: budget.paid,
    availableDisplay: budget.remaining === null ? '—' : number(budget.remaining), reservedDisplay: number(budget.reserved), paidDisplay: number(budget.paid),
    dailyLimitDisplay: budget.dailyLimit === null ? 'Daily Authority required' : `of ${number(budget.dailyLimit)} ${assetLabel} daily`,
    dailyState, blockers, wallet: { address: wallet.address, status: wallet.status,
      network: environment.isProduction ? 'Solana Mainnet' : 'Solana Devnet' },
    grant: grant && scopeMatches ? { id: grant.id, resourceId: grant.resourceId, api: resource?.request.url ?? null,
      network: environment.isProduction ? 'Solana Mainnet' : 'Solana Devnet', assetLabel,
      totalDisplay: number(grant.totalLimit), remainingDisplay: number(grant.remaining), committedDisplay: number(grant.committed),
      singleDisplay: number(grant.singleLimit), status: grant.status, expiresAt: grant.expiresAt, usable: registered && grant.status === 'ACTIVE' && BigInt(grant.remaining) > 0n } : null };
}

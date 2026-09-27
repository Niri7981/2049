import type { PurchaseLedger, PurchaseExecutionMode } from '../purchases/purchase-ledger';
import type { AgentConnection } from '../mcp/connection';

export function assembleAuthorityOverview(ledger: PurchaseLedger, agentConnection: AgentConnection,
  wallet: { address: string; reused: boolean }, service: { status: 'running' | 'stopping'; recoveryStatus: 'idle' | 'running' | 'complete' | 'pending' },
  now: number, mode: PurchaseExecutionMode) {
  const budget = ledger.managedSummary(now, mode);
  const display = (value: string | null) => value === null ? '未设置' : `${(Number(value) / 1_000_000).toFixed(2)} test USDC`;
  return { service: { ...service, network: 'Solana Devnet', testEnvironment: true, purchaseMode: mode },
    wallet, budget: { ...budget, dailyLimitDisplay: display(budget.dailyLimit), paidDisplay: display(budget.paid),
      reservedDisplay: display(budget.reserved), remainingDisplay: display(budget.remaining) },
    grant: ledger.spendGrantSummary(now, mode), purchases: ledger.list(), connection: agentConnection.status() };
}

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CapabilityPlanner } from './capability-plan';
import { runDay2Discovery, type PlannerMode } from './day2-agent-runtime';
import { createStaticResourceRegistry } from '../resources/static-resource-registry';
import type { Day4Config } from '../payment/day4-config';
import { DEVNET_NETWORK, DEVNET_USDC_MINT } from '../payment/day4-config';
import { runDay4Preflight } from '../payment/day4-preflight';
import { selectDay4Quote } from '../payment/day4-payment';
import { PurchaseLedger, type PurchaseRecord } from '../purchases/purchase-ledger';
import { hash, PurchaseSchema } from '../purchases/spending-policy';
import { executeApprovedPayment, paymentBinding, paymentEndpoint } from '../purchases/approved-payment';

const TaskSchema = z.object({ taskId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), task: z.string().trim().min(1).max(1000) }).strict();
function publicResult(record: PurchaseRecord, ledger: PurchaseLedger) {
  return { taskId: record.purchase.taskId, status: record.status, policy: record.decision, amountUSDC: record.purchase.amount / 1_000_000,
    transaction: record.transaction, data: record.data, events: ledger.events(record.purchase.taskId),
    summary: record.data ? `示例快照（${record.data.as_of}）：SOL 价格 $${record.data.spot_price_usd}，24 小时变化 ${record.data.change_24h_pct}%，RSI ${record.data.rsi_14d}。数据来自 Demo fixture，不是实时行情。` : undefined };
}
export async function runDay5Task(input: { taskId: string; task: string }, options: {
  planner: CapabilityPlanner; plannerMode: PlannerMode; config: Day4Config; ledger: PurchaseLedger; origin: string;
  // Trusted composition dependencies for integration tests, never model/tool inputs.
  preflight?: typeof runDay4Preflight; pay?: typeof executeApprovedPayment;
}) {
  const { taskId, task } = TaskSchema.parse(input);
  const { config, ledger } = options;
  if (config.cluster !== 'devnet' || config.network !== DEVNET_NETWORK || config.mint !== DEVNET_USDC_MINT) throw new Error('Day 5 policy only supports Circle USDC on Devnet');
  const endpoint = paymentEndpoint(options.origin);
  const binding = paymentBinding(config, endpoint);
  const existing = ledger.get(taskId);
  if (existing) {
    if (existing.purchase.taskHash !== hash(task) || existing.purchase.binding !== binding) throw new Error('Task ID already belongs to different input or configuration');
    // A restart never signs again, including an abandoned APPROVED/PAYING record.
    return { ...publicResult(existing, ledger), reused: true };
  }
  // Registry endpoint is a logical HTTPS identity. Only the fixed local endpoint
  // above is routable in this desktop demo; no URL ever comes from the model.
  const resources = createStaticResourceRegistry({ endpoint: 'https://day5.local.invalid/api/paid/market-snapshot', asset_id: config.mint, network: config.network, allowed_pay_to: config.merchant });
  const discovery = await runDay2Discovery({ task, planner: options.planner, plannerMode: options.plannerMode, resources });
  if (discovery.discovery?.status !== 'found' || !discovery.discovery.resource) return { taskId, status: 'NO_PURCHASE', discovery };
  const preflight = await (options.preflight ?? runDay4Preflight)(config);
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
  const header = response.headers.get('PAYMENT-REQUIRED');
  if (response.status !== 402 || !header) throw new Error('Expected a valid x402 quote');
  const quote = selectDay4Quote(header, config, preflight.facilitator.feePayer);
  const now = Date.now();
  const purchase = PurchaseSchema.parse({ id: randomUUID(), taskId, taskHash: hash(task), resourceId: discovery.discovery.resource.resource_id,
    providerId: discovery.discovery.resource.provider_id, input: { asset: 'SOL' }, amount: Number(quote.amount), currency: 'USDC', decimals: 6,
    mint: quote.asset, network: quote.network, payTo: quote.payTo, scheme: quote.scheme, quoteFingerprint: hash(quote),
    createdAt: now, expiresAt: now + Math.min(quote.maxTimeoutSeconds, 300) * 1000, binding });
  const reserved = ledger.reserve(purchase, quote, resources[0]);
  // Only the invocation that created the unique purchase can execute its approval.
  if (reserved.purchase.id !== purchase.id || reserved.status !== 'APPROVED') return { ...publicResult(reserved, ledger), discovery };
  try { await (options.pay ?? executeApprovedPayment)(ledger, reserved.approvalId, config, endpoint); }
  catch { return { ...publicResult(ledger.get(taskId)!, ledger), discovery }; }
  return { ...publicResult(ledger.get(taskId)!, ledger), discovery };
}

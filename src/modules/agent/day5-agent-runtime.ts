import type { Trace } from '../demo/trace';
import { MarketSnapshotOutputSchema, type MarketSnapshotOutput } from '../resources/resource-schema';
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
import { executeApprovedPayment, recoverApprovedPayment, paymentBinding, paymentEndpoint } from '../purchases/approved-payment';

const TaskSchema = z.object({ taskId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), task: z.string().trim().min(1).max(1000) }).strict();
function publicResult(record: PurchaseRecord, ledger: PurchaseLedger) {
  return { taskId: record.purchase.taskId, status: record.status, policy: record.decision, amountUSDC: record.purchase.amount / 1_000_000,
    transaction: record.transaction, data: record.data, answer: record.answer, events: ledger.events(record.purchase.taskId),
    summary: record.data ? `示例快照（${record.data.as_of}）：SOL 价格 $${record.data.spot_price_usd}，24 小时变化 ${record.data.change_24h_pct}%，RSI ${record.data.rsi_14d}。数据来自 Demo fixture，不是实时行情。` : undefined };
}
export async function runDay5Task(input: { taskId: string; task: string }, options: {
  planner: CapabilityPlanner; plannerMode: PlannerMode; config: Day4Config; ledger: PurchaseLedger; origin: string;
  // Trusted composition dependencies for integration tests, never model/tool inputs.
  preflight?: typeof runDay4Preflight; pay?: typeof executeApprovedPayment;
  answer?: (task: string, data: MarketSnapshotOutput) => Promise<string>;
  trace?: Trace;
}) {
  const { taskId, task } = TaskSchema.parse(input);
  const { config, ledger } = options;
  const trace: Trace = options.trace ?? (() => {});
  if (config.cluster !== 'devnet' || config.network !== DEVNET_NETWORK || config.mint !== DEVNET_USDC_MINT) throw new Error('Day 5 policy only supports Circle USDC on Devnet');
  const endpoint = paymentEndpoint(options.origin);
  const binding = paymentBinding(config, endpoint);
  ledger.releaseExpired();
  async function result(record: PurchaseRecord) {
    if (['PAYING', 'PAYMENT_UNKNOWN'].includes(record.status)) trace('PAYMENT_UNKNOWN', '保留原任务，只读查询原交易；禁止重新付款');
    if (record.status === 'FAILED') trace('PAYMENT_FAILED', '原任务保留失败证据，不会自动重新购买');
    let answerStatus = record.answer ? 'COMPLETE' : 'NOT_REQUESTED';
    if (record.status === 'PAID' && record.data && !record.answer && options.answer) {
      try {
        trace('ANALYSIS_STARTED');
        const answer = await options.answer(task, MarketSnapshotOutputSchema.parse(record.data));
        ledger.saveAnswer(taskId, answer);
        answerStatus = 'COMPLETE';
        trace('COMPLETED');
      } catch { answerStatus = 'FAILED'; trace('ANALYSIS_FAILED'); }
    }
    return { ...publicResult(ledger.get(taskId) ?? record, ledger), answerStatus };
  }
  const existing = ledger.get(taskId);
  if (existing) {
    if (existing.purchase.taskHash !== hash(task) || existing.purchase.binding !== binding) throw new Error('Task ID already belongs to different input or configuration');
    if (existing.status === 'PAID') trace('CACHE_HIT', '复用已购买的数据，本次新增付款 0 USDC');
    // Recovery only reads the original settlement; it cannot initiate a payment.
    await recoverApprovedPayment(ledger, taskId, config, endpoint, trace);
    return { ...await result(ledger.get(taskId)!), reused: true };
  }
  // Registry endpoint is a logical HTTPS identity. Only the fixed local endpoint
  // above is routable in this desktop demo; no URL ever comes from the model.
  const resources = createStaticResourceRegistry({ endpoint: 'https://day5.local.invalid/api/paid/market-snapshot', asset_id: config.mint, network: config.network, allowed_pay_to: config.merchant });
  trace('PLANNING');
  const discovery = await runDay2Discovery({ task, planner: options.planner, plannerMode: options.plannerMode, resources });
  if (discovery.discovery?.status !== 'found' || !discovery.discovery.resource) { trace('NO_PURCHASE', '未找到受支持的付费资源，未签名或付款'); return { taskId, status: 'NO_PURCHASE', discovery }; }
  trace('RESOURCE_FOUND', 'Premium SOL Market Snapshot');
  trace('PREFLIGHT');
  const preflight = await (options.preflight ?? runDay4Preflight)(config);
  trace('QUOTE_REQUESTED');
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
  const header = response.headers.get('PAYMENT-REQUIRED');
  if (response.status !== 402 || !header) throw new Error('Expected a valid x402 quote');
  const quote = selectDay4Quote(header, config, preflight.facilitator.feePayer);
  trace('QUOTE_RECEIVED', '0.01 测试 USDC · Solana Devnet');
  const now = Date.now();
  const purchase = PurchaseSchema.parse({ id: randomUUID(), taskId, taskHash: hash(task), resourceId: discovery.discovery.resource.resource_id,
    providerId: discovery.discovery.resource.provider_id, input: { asset: 'SOL' }, amount: Number(quote.amount), currency: 'USDC', decimals: 6,
    mint: quote.asset, network: quote.network, payTo: quote.payTo, scheme: quote.scheme, quoteFingerprint: hash(quote),
    createdAt: now, expiresAt: now + Math.min(quote.maxTimeoutSeconds, 300) * 1000, binding });
  const reserved = ledger.reserve(purchase, quote, resources[0]);
  trace(reserved.status === 'APPROVED' ? 'POLICY_APPROVED' : 'POLICY_STOPPED', `${reserved.status === 'APPROVED' ? '金额、币种、网络、收款方和预算全部通过' : reserved.decision.reason} · 剩余预算 ${(reserved.decision.remainingAfter / 1_000_000).toFixed(2)} USDC`);
  // Only the invocation that created the unique purchase can execute its approval.
  if (reserved.purchase.id !== purchase.id || reserved.status !== 'APPROVED') return { ...await result(reserved), discovery };
  try { await (options.pay ?? executeApprovedPayment)(ledger, reserved.approvalId, config, endpoint, trace); }
  catch {
    trace('PAYMENT_PAUSED');
    await recoverApprovedPayment(ledger, taskId, config, endpoint, trace);
    return { ...await result(ledger.get(taskId)!), discovery };
  }
  return { ...await result(ledger.get(taskId)!), discovery };
}

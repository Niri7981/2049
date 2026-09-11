import { loadPaymentConfig } from '../src/modules/payment/payment-config';
import { PurchaseLedger } from '../src/modules/purchases/purchase-ledger';
import { runTask } from '../src/modules/agent/task-runtime';
import { localCapabilityPlanner } from '../src/modules/agent/local-capability-planner';
async function main() {
  const [taskId, task, ...extra] = process.argv.slice(2);
  if (!taskId || !task || extra.length) throw new Error('Usage: npm run agent:run -- TASK_ID "TASK"');
  const useModel = Boolean(process.env.OPENAI_API_KEY);
  const planner = useModel ? (await import('../src/modules/agent/openai-capability-planner')).openAICapabilityPlanner : localCapabilityPlanner;
  const answer = useModel ? (await import('../src/modules/agent/openai-market-answer')).openAIMarketAnswer : undefined;
  const ledger = new PurchaseLedger();
  try {
    const result = await runTask({ taskId, task }, { planner, answer, plannerMode: useModel ? 'openai_agent' : 'local_demo', config: loadPaymentConfig(), ledger, origin: process.env.DAY4_API_ORIGIN || 'http://127.0.0.1:3000' });
    console.log(JSON.stringify({ plannerMode: useModel ? 'openai_agent' : 'local_demo', ...result }, null, 2));
    if (['REJECTED', 'NEEDS_CONFIRMATION', 'PAYMENT_UNKNOWN', 'PAYING', 'APPROVED', 'EXPIRED', 'FAILED'].includes(result.status) || ('answerStatus' in result && result.answerStatus === 'FAILED')) process.exitCode = 1;
  } finally { ledger.close(); }
}
main().catch(() => { console.error('Purchase task stopped. Check configuration and the local purchase ledger; never delete unresolved payments to retry.'); process.exitCode = 1; });

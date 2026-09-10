import { loadDay4Config } from '../src/modules/payment/day4-config';
import { PurchaseLedger } from '../src/modules/purchases/purchase-ledger';
import { runDay5Task } from '../src/modules/agent/day5-agent-runtime';
import { localCapabilityPlanner } from '../src/modules/agent/local-capability-planner';
async function main() {
  const [taskId, task, ...extra] = process.argv.slice(2);
  if (!taskId || !task || extra.length) throw new Error('Usage: npm run day5:agent -- TASK_ID "TASK"');
  const useModel = Boolean(process.env.OPENAI_API_KEY);
  const planner = useModel ? (await import('../src/modules/agent/openai-capability-planner')).openAICapabilityPlanner : localCapabilityPlanner;
  const answer = useModel ? (await import('../src/modules/agent/openai-market-answer')).openAIMarketAnswer : undefined;
  const ledger = new PurchaseLedger();
  try {
    const result = await runDay5Task({ taskId, task }, { planner, answer, plannerMode: useModel ? 'openai_agent' : 'local_demo', config: loadDay4Config(), ledger, origin: process.env.DAY4_API_ORIGIN || 'http://127.0.0.1:3000' });
    console.log(JSON.stringify({ plannerMode: useModel ? 'openai_agent' : 'local_demo', ...result }, null, 2));
    if (['REJECTED', 'NEEDS_CONFIRMATION', 'PAYMENT_UNKNOWN', 'PAYING', 'APPROVED', 'EXPIRED', 'FAILED'].includes(result.status) || ('answerStatus' in result && result.answerStatus === 'FAILED')) process.exitCode = 1;
  } finally { ledger.close(); }
}
main().catch(() => { console.error('Day 5 task stopped. Check configuration and the local purchase ledger; never delete unresolved payments to retry.'); process.exitCode = 1; });

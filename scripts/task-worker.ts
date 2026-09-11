import { DemoStore, safeText } from "../src/modules/demo/demo-store";
import type { DemoResult, Trace } from "../src/modules/demo/trace";
import { PurchaseLedger } from "../src/modules/purchases/purchase-ledger";
import { runTask } from "../src/modules/agent/task-runtime";
import { loadPaymentConfig } from "../src/modules/payment/payment-config";
import { openAICapabilityPlanner } from "../src/modules/agent/openai-capability-planner";
import { openAIMarketAnswer } from "../src/modules/agent/openai-market-answer";

async function main() {
  const [taskId, token] = process.argv.slice(2);
  const store = new DemoStore();
  const ledger = new PurchaseLedger();
  try {
    if (!store.owns(taskId, token)) return;
    const task = store.get(taskId)!;
    const trace: Trace = (type, detail) => {
      store.event(taskId, token, type, detail);
    };
    try {
      if (!process.env.OPENAI_API_KEY) throw new Error("Model missing");
      const result = await runTask(
        { taskId, task: task.task },
        {
          planner: openAICapabilityPlanner,
          plannerMode: "openai_agent",
          answer: openAIMarketAnswer,
          config: loadPaymentConfig(),
          ledger,
          origin: process.env.DAY4_API_ORIGIN || "http://127.0.0.1:3000",
          trace,
        },
      );
      const display: DemoResult = {
        status: result.status,
        reused: "reused" in result && result.reused === true,
        ...("answerStatus" in result
          ? { answerStatus: result.answerStatus }
          : {}),
        ...("answer" in result && result.answer
          ? { answer: safeText(result.answer) }
          : {}),
        ...("summary" in result && result.summary
          ? { summary: safeText(result.summary) }
          : {}),
        ...("amountUSDC" in result ? { amountUSDC: result.amountUSDC } : {}),
        ...("transaction" in result &&
        result.status === "PAID" &&
        result.transaction &&
        /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(result.transaction)
          ? { transaction: result.transaction }
          : {}),
        ...("data" in result && result.data
          ? {
              asOf: result.data.as_of,
              price: result.data.spot_price_usd,
              rsi: result.data.rsi_14d,
            }
          : {}),
      };
      const status =
        result.status === "NO_PURCHASE"
          ? "NO_PURCHASE"
          : display.answerStatus === "COMPLETE"
            ? "COMPLETE"
            : "PAUSED";
      if (display.reused && status === "COMPLETE")
        trace("COMPLETED", "原回答已恢复，本次没有再次付款");
      store.finish(taskId, token, status, display);
    } catch {
      trace("FAILED");
      store.finish(taskId, token, "PAUSED", {
        status: "PAUSED",
        reused: false,
      });
    }
  } finally {
    ledger.close();
    store.close();
  }
}
main().catch(() => {
  process.exitCode = 1;
});

import { loadPaymentConfig } from "../payment/payment-config";
import { runPaymentPreflight } from "../payment/payment-preflight";
import { selectPaymentQuote } from "../payment/solana-payment";
import { paymentEndpoint } from "../purchases/approved-payment";
import { PurchaseLedger } from "../purchases/purchase-ledger";
import { openAICapabilityPlanner } from "../agent/openai-capability-planner";
import { demoSnapshot } from "../paid-market-api/paid-market-api";
import { safeText } from "./demo-store";
export type DemoCheck = {
  label: string;
  status: "pass" | "fail" | "notice";
  detail: string;
};
export type DemoPreflight = {
  ready: boolean;
  checkedAt: number;
  mode: "historical_fixture";
  checks: DemoCheck[];
};
export async function runDemoPreflight(): Promise<DemoPreflight> {
  const checks: DemoCheck[] = [];
  const tasks = await Promise.allSettled([
    (async () => {
      const config = loadPaymentConfig();
      if (config.cluster !== "devnet") throw new Error("Devnet required");
      const state = await runPaymentPreflight(config);
      if (BigInt(state.buyer.balanceBaseUnits) < 100_000n)
        throw new Error("Ten demos require 0.10 test USDC");
      const response = await fetch(
        paymentEndpoint(process.env.DAY4_API_ORIGIN || "http://127.0.0.1:3000"),
        { signal: AbortSignal.timeout(20000), redirect: "error" },
      );
      if (response.status !== 402) throw new Error("Missing quote");
      selectPaymentQuote(
        response.headers.get("PAYMENT-REQUIRED") || "",
        config,
        state.facilitator.feePayer,
      );
      return state;
    })(),
    (async () => {
      if (!process.env.OPENAI_API_KEY) throw new Error("Missing model");
      const plan = await openAICapabilityPlanner.plan("解释 Solana 是什么");
      if (plan.needs_external_capability || plan.asset !== null)
        throw new Error("Unexpected model decision");
    })(),
    (async () => {
      const response = await fetch(
        "https://explorer.solana.com/?cluster=devnet",
        { signal: AbortSignal.timeout(20000), redirect: "error" },
      );
      await response.body?.cancel();
      if (!response.ok) throw new Error("Explorer unavailable");
    })(),
  ]);
  checks.push(
    tasks[0].status === "fulfilled"
      ? {
          label: "支付环境",
          status: "pass",
          detail: `Devnet、收款服务和 0.01 报价通过；买方 ${(Number(tasks[0].value.buyer.balanceBaseUnits) / 1e6).toFixed(2)} 测试 USDC，足够至少十次演示`,
        }
      : {
          label: "支付环境",
          status: "fail",
          detail: "请检查 Devnet、账户余额、RPC 和本机付费 API。",
        },
  );
  checks.push(
    tasks[1].status === "fulfilled"
      ? {
          label: "真实模型",
          status: "pass",
          detail: "已实际调用并验证需求判断；未付款。",
        }
      : {
          label: "真实模型",
          status: "fail",
          detail: "请检查模型配置或服务连接。",
        },
  );
  checks.push(
    tasks[2].status === "fulfilled"
      ? {
          label: "交易浏览器",
          status: "pass",
          detail: "Solana Explorer 可访问。",
        }
      : {
          label: "交易浏览器",
          status: "fail",
          detail: "Solana Explorer 暂不可访问，仍可通过 RPC 检查原交易。",
        },
  );
  const ledger = new PurchaseLedger();
  try {
    ledger.releaseExpired();
    const summary = ledger.summary();
    checks.push({
      label: "购买账本",
      status:
        summary.unresolved === 0 && summary.remainingUSDC >= 0.1
          ? "pass"
          : "fail",
      detail: summary.unresolved
        ? "存在未解决付款，请恢复原任务。"
        : `剩余日预算 ${summary.remainingUSDC.toFixed(2)} 测试 USDC；十次演示需要至少 0.10`,
    });
  } finally {
    ledger.close();
  }
  checks.push({
    label: "历史数据模式",
    status: "notice",
    detail: `固定演示快照：${demoSnapshot.as_of}。不是实时行情，不满足实时快照两小时新鲜度要求。`,
  });
  checks.push({
    label: "展示字段",
    status:
      safeText("Bearer test-secret-value") === "[已隐藏]" ? "pass" : "fail",
    detail: "使用固定事件标题及字段白名单，原支付载荷和密钥不返回页面。",
  });
  return {
    ready: checks.every((c) => c.status !== "fail"),
    checkedAt: Date.now(),
    mode: "historical_fixture",
    checks,
  };
}

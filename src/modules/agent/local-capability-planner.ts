import {
  CapabilityPlanSchema,
  type CapabilityPlan,
  type CapabilityPlanner,
} from "./capability-plan";

const marketTerms =
  /市场|行情|价格|成交量|波动率|rsi|market|price|volume|volatility|technical/i;
const directPaymentTerms = /支付|付款|转账|pay\s+\d|send\s+\d|transfer\s+\d/i;

export function planCapabilityLocally(task: string): CapabilityPlan {
  const asset = task.match(/\b(SOL|BTC|ETH)\b/i)?.[1]?.toUpperCase() ?? null;
  const isDirectPaymentRequest = directPaymentTerms.test(task);
  const needsMarketSnapshot = Boolean(asset && marketTerms.test(task) && !isDirectPaymentRequest);

  return CapabilityPlanSchema.parse(
    needsMarketSnapshot
      ? {
          needs_external_capability: true,
          capability: "crypto.market.snapshot",
          asset,
          reason: `${asset} 当前市场分析需要带时间戳的外部市场数据。`,
        }
      : {
          needs_external_capability: false,
          capability: null,
          asset: null,
          reason: isDirectPaymentRequest
            ? "任务包含直接付款指令；Day 2 Agent 不接受付款请求。"
            : "当前任务不需要 V0 提供的市场快照能力。",
        },
  );
}

export const localCapabilityPlanner: CapabilityPlanner = {
  async plan(task) {
    return planCapabilityLocally(task);
  },
};

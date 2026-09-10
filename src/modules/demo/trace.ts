export const traceTitles = {
  TASK_STARTED: "已收到任务",
  PLANNING: "Agent 正在判断需要的数据",
  RESOURCE_FOUND: "找到 SOL 市场数据服务",
  NO_PURCHASE: "此任务未购买付费数据",
  PREFLIGHT: "检查网络、账户与测试余额",
  QUOTE_REQUESTED: "向数据服务请求报价",
  QUOTE_RECEIVED: "收到 402 付费报价",
  POLICY_APPROVED: "消费规则通过，预算已预占",
  POLICY_STOPPED: "消费规则暂停或拒绝购买",
  SIGNING: "专用钱包正在准备签名",
  SIGNED: "签名已保存",
  SUBMITTED: "已向服务提交原支付凭证",
  CHAIN_CONFIRMED: "Solana Devnet 原交易已确认",
  DATA_VALIDATED: "已获取并校验市场数据",
  ANALYSIS_STARTED: "Agent 正在使用付费数据分析",
  COMPLETED: "任务完成，回答已保存",
  ANALYSIS_FAILED: "分析暂未完成，可复用数据重试",
  CACHE_HIT: "复用原任务，本次不重新购买",
  RECOVERY_STARTED: "正在查询原付款，不会重新签名",
  PAYMENT_PAUSED: "付款尚未完成，保留原任务",
  INTERRUPTED: "运行已中断，请恢复原任务",
  FAILED: "任务暂停，请检查配置后重试原任务",
  PAYMENT_UNKNOWN: "付款状态未知，预算保持冻结",
  PAYMENT_FAILED: "已确认付款未成功",
} as const;
export type TraceType = keyof typeof traceTitles;
export type Trace = (type: TraceType, detail?: string) => void;
export type DemoEvent = {
  eventId: string;
  taskId: string;
  sequence: number;
  type: TraceType;
  actor: string;
  status: "running" | "success" | "warning" | "error";
  title: string;
  at: number;
  detail: string;
};
const actors: Record<TraceType, string> = {
  TASK_STARTED: "System",
  PLANNING: "Agent",
  RESOURCE_FOUND: "Discovery",
  NO_PURCHASE: "Agent",
  PREFLIGHT: "System",
  QUOTE_REQUESTED: "Tool",
  QUOTE_RECEIVED: "API",
  POLICY_APPROVED: "Policy",
  POLICY_STOPPED: "Policy",
  SIGNING: "Wallet",
  SIGNED: "Wallet",
  SUBMITTED: "Payment",
  CHAIN_CONFIRMED: "Solana",
  DATA_VALIDATED: "Tool",
  ANALYSIS_STARTED: "Agent",
  COMPLETED: "Agent",
  ANALYSIS_FAILED: "Agent",
  CACHE_HIT: "System",
  RECOVERY_STARTED: "Payment",
  PAYMENT_PAUSED: "Payment",
  INTERRUPTED: "System",
  FAILED: "System",
  PAYMENT_UNKNOWN: "Payment",
  PAYMENT_FAILED: "Payment",
};
export function executionEvent(
  taskId: string,
  sequence: number,
  type: TraceType,
  at: number,
  detail: string,
): DemoEvent {
  const status = ["FAILED", "PAYMENT_FAILED"].includes(type)
    ? "error"
    : [
          "ANALYSIS_FAILED",
          "POLICY_STOPPED",
          "PAYMENT_PAUSED",
          "PAYMENT_UNKNOWN",
          "INTERRUPTED",
        ].includes(type)
      ? "warning"
      : [
            "RESOURCE_FOUND",
            "NO_PURCHASE",
            "QUOTE_RECEIVED",
            "POLICY_APPROVED",
            "SIGNED",
            "CHAIN_CONFIRMED",
            "DATA_VALIDATED",
            "COMPLETED",
            "CACHE_HIT",
          ].includes(type)
        ? "success"
        : "running";
  return {
    eventId: `${taskId}:${sequence}`,
    taskId,
    sequence,
    type,
    actor: actors[type],
    status,
    title: traceTitles[type],
    at,
    detail,
  };
}
export type DemoResult = {
  status: string;
  answerStatus?: string;
  answer?: string;
  summary?: string;
  transaction?: string;
  amountUSDC?: number;
  reused: boolean;
  asOf?: string;
  price?: number;
  rsi?: number;
};
export type DemoTask = {
  taskId: string;
  task: string;
  status: "RUNNING" | "COMPLETE" | "PAUSED" | "NO_PURCHASE";
  createdAt: number;
  result?: DemoResult;
  events: DemoEvent[];
};

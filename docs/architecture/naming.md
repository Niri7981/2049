# 按职责命名与历史数据兼容

这次改名只调整源码、脚本、测试、文档名称及其引用，不改变网络支持、发现方式、消费规则、签名、恢复或错误处理逻辑。

## 核心文件对照

| 原名称 | 当前名称 | 职责 |
|---|---|---|
| `day2-agent-runtime.ts` | `src/modules/agent/discovery-runtime.ts` | 判断任务所需能力并发现资源 |
| `day5-agent-runtime.ts` | `src/modules/agent/task-runtime.ts` | 编排发现、报价、审批、付款与结果复用 |
| `day2-demo-registry.ts` | `src/modules/resources/discovery-fixture-registry.ts` | 离线发现用的示例资源 |
| `day4-config.ts` | `src/modules/payment/payment-config.ts` | 支付配置与网络限制 |
| `day4-preflight.ts` | `src/modules/payment/payment-preflight.ts` | 付款前环境检查 |
| `day4-payment.ts` | `src/modules/payment/solana-payment.ts` | 报价核对、模拟、签名与确认 |
| `day4-keychain.ts` | `src/modules/payment/keychain.ts` | 专用钥匙串访问 |
| `day4-wallet.ts` | `src/modules/payment/wallet.ts` | 加载并验证买方签名器 |
| `day2-demo.tsx` | `src/app/discovery-demo.tsx` | 资源发现演示组件 |
| `day7-demo.tsx` | `src/app/task-console.tsx` | 任务输入、执行记录与结果展示 |
| `day7-worker.ts` | `scripts/task-worker.ts` | 网页任务后台入口 |

导出名称同步按职责调整，例如 `runDiscovery`、`runTask`、`loadPaymentConfig`、`runPaymentPreflight`、`prepareSolanaPayment` 和 `TaskConsole`。测试文件使用对应模块名称。

## 命令对照

| 原命令 | 当前命令 |
|---|---|
| `day4:server` | `npm run demo:dev` |
| `day7:demo` | `npm run demo` |
| `day7:preflight` | `npm run demo:preflight` |
| `day5:agent` | `npm run agent:run -- TASK_ID "TASK"` |
| `day5:model-check` | `npm run model:check` |
| `day6:acceptance` | `npm run task:acceptance` |
| `day4:wallet` | `npm run wallet:setup` |
| `day4:accounts` | `npm run wallet:accounts` |
| `day4:preflight` | `npm run payment:preflight` |
| `day4:pay` | `npm run payment:pay` |
| `day4:localnet` | `npm run localnet:start` |
| `day4:localnet:init` | `npm run localnet:init` |
| `day4:smoke` | `npm run localnet:smoke` |

统一命令入口为 `scripts/run.mjs`；网页仍使用原有 HTTP 路由。

## 保留的兼容标识

以下名称属于已经使用的数据或配置约定，保留原值。本次不做数据库迁移，不重建钱包，也不重置任务身份：

- `.data/day4-*` 钱包、账户准备日志、独立付款日志和结算数据库；`.data/day5-ledger.sqlite` 购买账本；`.data/day7-demo.sqlite` 网页任务记录。
- `.data/day6/`、`.data/day7/` 验收与演示产物，以及已有验收任务 ID 前缀 `day6-devnet-`。更换任务 ID 可能被当作新购买，不能随文件名一起替换。
- SQLite 内部表 `day4_quotes`、`day4_settlements`。
- macOS 钥匙串服务名 `com.2049.day4.*`，以及链上交易 memo 的 `day4:` 前缀。
- 现有环境变量 `DAY4_API_ORIGIN`、`DAY4_SETTLEMENT_DB`，继续按 `.env.example` 配置。
- 历史文档里的阶段编号、真实任务 ID 和交易证据。

这些保留值不代表源码仍按开发天数组织；统一它们需要另一次明确的数据与协议迁移。

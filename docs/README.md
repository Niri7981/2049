# Day 1 Design Index

## 阅读顺序

| Step | Document | Decision |
|---:|---|---|
| 1 | [Product Definition](architecture/product-definition.md) | 冻结一句话目标和核心证明 |
| 2 | [Demo Input](demo/demo-input.md) | 冻结唯一用户输入及其解释 |
| 3 | [Demo Output](demo/demo-output.md) | 冻结最终必须展示的结果 |
| 4 | [V0 Scope](architecture/v0-scope.md) | 冻结必做、非目标和 Scope Cut |
| 5 | [System Actors](architecture/system-actors.md) | 冻结角色、职责和信任区域 |
| 6 | [Happy Path](architecture/happy-path.md) | 冻结完整成功执行序列 |
| 7 | [State Machine](architecture/state-machine.md) | 冻结任务、购买、支付和 Tool 状态 |
| 8 | [Resource Schema](architecture/resource-schema.md) | 冻结 Tool Metadata 和 Discovery 合同 |
| 9 | [PurchaseRequest Schema](architecture/purchase-request-schema.md) | 冻结购买请求和不可变字段 |
| 10 | [Spending Policy](architecture/spending-policy.md) | 冻结 Approved、Rejected 和 NeedsConfirmation |
| 11 | [Wallet Architecture](architecture/wallet-architecture.md) | 冻结钱包、Private Key 和签名边界 |
| 12 | [x402 Flow](architecture/x402-flow.md) | 冻结 402、签名、结算和 200 流程 |
| 13 | [Paid Market Data](architecture/paid-market-data.md) | 冻结 Paid API 数据合同 |
| 14 | [Execution Trace](architecture/execution-trace.md) | 冻结可观察事件和敏感信息边界 |
| 15 | [Risks and Fallbacks](architecture/risks-and-fallbacks.md) | 冻结风险 Gate、Fallback 和 Preflight |
| 16 | [Day 2 Plan](demo/day-2-plan.md) | 冻结下一天的开发入口和验收标准 |
| — | [Architecture Overview](architecture/overview.md) | 汇总整体架构、控制流和数据流 |

## Day 1 已冻结的关键决定

- TypeScript 全栈。
- Next.js Node runtime。
- 单用户、单 Agent、单 Resource、单 Provider。
- Static Local Resource Registry。
- Premium SOL Market Snapshot API。
- 0.01 Solana Devnet 测试 USDC。
- x402 V2 `exact` scheme。
- Dedicated backend Demo Buyer Wallet。
- Agent 只能发 Purchase Intent，不能直接付款。
- Policy 是唯一消费授权方。
- Wallet Signer 是唯一 Private Key 使用方。
- 市场数据使用演示前刷新的缓存快照。
- SQLite 保存预算、幂等和 Execution Events。
- Web Activity Feed 与 Console 共用同一事件源。
- 不使用 MCP、Marketplace、Mainnet、多链或多 Provider。

## 实现前仍需填入的运行时值

以下不是架构开放问题，而是实施时生成或配置的具体值：

- Demo Buyer Wallet public address。
- Demo Merchant Wallet public address。
- Buyer runtime secret。
- Paid API 实际本地 endpoint。
- Primary 和备用 Solana Devnet RPC URL。
- 实际使用的 x402 Facilitator URL。
- 演示当天的 Market Snapshot 数值与 `as_of`。

Private Key 不会写入任何设计文档。

## Day 1 Definition of Done

- [x] 一句话产品目标已冻结。
- [x] 标准 Demo 输入已冻结。
- [x] 最终 Demo 输出已冻结。
- [x] V0 Scope 和 non-goals 已冻结。
- [x] 系统参与者和权限边界已冻结。
- [x] Happy Path 已编号。
- [x] 状态机和终止状态已冻结。
- [x] Resource Schema 已冻结。
- [x] PurchaseRequest Schema 已冻结。
- [x] Spending Policy 已冻结。
- [x] Wallet 与 Private Key 边界已冻结。
- [x] x402 两次 HTTP 请求流程已冻结。
- [x] Paid API 数据合同已冻结。
- [x] Execution Trace 已冻结。
- [x] 风险、Fallback 和每日 Gate 已冻结。
- [x] Day 2 小任务和验收标准已冻结。
- [x] 没有编写产品源码或安装依赖。

## Day 1 Demo Checkpoint

现在应该可以只依靠这些文档，在五分钟内完整讲清：

```text
用户提交任务
→ Agent 判断需要市场数据
→ Registry 找到付费 Tool
→ API 返回 402
→ Agent 请求购买
→ Policy 自动批准
→ Wallet 在后端签名
→ x402 通过 Facilitator 在 Solana Devnet 结算
→ Paid API 返回 JSON
→ 数据加入 Context
→ Agent 完成原始分析
```

下一阶段从 Day 2 Plan 开始，不再重新设计产品范围。

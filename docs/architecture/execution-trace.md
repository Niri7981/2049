# D1-14 Execution Trace

> Day 7 实现：`src/modules/demo/trace.ts` 定义 `DemoEvent`，`demo-store.ts` 先提交 SQLite，再把同一对象写入 Console；网页每 1.5 秒读取持久化记录。字段 `eventId`、`taskId`、`at`、`detail` 分别对应下文设计中的 `event_id`、`task_id`、`timestamp`、`safe_details`。实际事件合并非关键子阶段，详见 [Day 7 演示说明](../demo/demo-runbook.md)。下文保留原设计目录，不表示所有概念事件均单独实现。

## 目标

让非技术观众能够在 30–60 秒内看懂 Agent 刚才做了什么、为什么花钱、谁批准了支付、链上是否成功，以及购买的数据是否真正被使用。

Execution Trace 不是调试日志的原样展示，也不是模型隐藏思维链。

## V0 输出方式

V0 同时使用：

- Web Activity Feed：Demo 的主要展示界面。
- Server Console：开发和排错使用。

两者消费同一套结构化 ExecutionEvent，避免出现两套互相矛盾的日志逻辑。

## ExecutionEvent 字段

| Field | Required | Purpose |
|---|---:|---|
| `event_id` | 是 | 事件唯一 ID |
| `task_id` | 是 | 关联 AgentTask |
| `sequence` | 是 | 单任务严格递增顺序 |
| `timestamp` | 是 | 事件发生时间 |
| `actor` | 是 | Agent、Discovery、Policy、Payment、Solana、API、Tool 或 System |
| `type` | 是 | 稳定机器事件类型 |
| `status` | 是 | running、success、warning 或 error |
| `title` | 是 | Feed 中的一行标题 |
| `safe_details` | 否 | 已经过滤的结构化展示信息 |
| `duration_ms` | 否 | 阶段耗时 |

不保存自由格式 Chain-of-Thought。

## Happy Path 事件目录

| Sequence | Type | Actor | User-Facing Meaning |
|---:|---|---|---|
| 1 | `TASK_RECEIVED` | System | 已收到用户任务 |
| 2 | `AGENT_PLANNING` | Agent | 正在理解任务 |
| 3 | `CAPABILITY_REQUIRED` | Agent | 需要当前 SOL 市场数据 |
| 4 | `DISCOVERY_STARTED` | Discovery | 正在查找可用 Resource |
| 5 | `RESOURCE_FOUND` | Discovery | 找到 Premium SOL Market Snapshot API |
| 6 | `TOOL_REQUEST_STARTED` | Tool | 正在首次请求 Paid API |
| 7 | `PAYMENT_REQUIRED` | API | API 返回 HTTP 402，价格 0.01 USDC |
| 8 | `PURCHASE_REQUEST_CREATED` | System | 已创建不可变购买请求 |
| 9 | `PURCHASE_REQUESTED` | Agent | Agent 请求购买该 Resource |
| 10 | `POLICY_EVALUATING` | Policy | 正在检查消费规则 |
| 11 | `POLICY_APPROVED` | Policy | 金额、Token、network、payee 和预算全部通过 |
| 12 | `PAYMENT_STARTED` | Payment | 正在执行已批准的支付 |
| 13 | `PAYMENT_SIGNED` | Wallet | Demo Wallet 已完成签名 |
| 14 | `PAYMENT_SUBMITTED` | x402 | 已携带支付载荷重试 API |
| 15 | `PAYMENT_VERIFYING` | API | Provider 正在验证付款 |
| 16 | `TRANSACTION_CONFIRMING` | Solana | 正在等待 Solana Devnet 确认 |
| 17 | `TRANSACTION_CONFIRMED` | Solana | 测试 USDC 交易已确认 |
| 18 | `PAYMENT_VERIFIED` | API | API 已确认结算 |
| 19 | `TOOL_RESULT_RECEIVED` | Tool | 已收到市场快照 JSON |
| 20 | `TOOL_RESULT_VALIDATED` | System | 市场数据通过 Schema 和安全检查 |
| 21 | `CONTEXT_UPDATED` | Agent | Paid data 已加入 Agent Context |
| 22 | `FINAL_ANALYSIS_STARTED` | Agent | 正在使用付费数据完成原任务 |
| 23 | `TASK_COMPLETED` | Result | SOL 市场分析完成 |

## 非成功事件

| Type | Meaning | UI Behavior |
|---|---|---|
| `POLICY_REJECTED` | 硬性规则失败 | 红色终止，显示确定性原因 |
| `USER_CONFIRMATION_REQUIRED` | 超过自动支付上限但未超每日预算 | 黄色暂停，不付款 |
| `PAYMENT_FAILED` | 已确定没有成功结算 | 红色终止，可安全重试说明 |
| `PAYMENT_UNKNOWN` | 可能已经提交但状态未知 | 黄色警告，禁止再次付款 |
| `TOOL_REQUEST_FAILED` | API 请求失败 | 红色终止或安全重试 |
| `TOOL_RESULT_REJECTED` | JSON 未通过验证 | 红色终止，不进入 Context |
| `TASK_FAILED` | Agent 或系统不可恢复错误 | 红色终止 |

## Web Activity Feed 展示规则

页面按 sequence 从上到下展示事件。

每项最多展示：

- Actor。
- 简短动作标题。
- 状态。
- 时间或耗时。
- 一到三项安全详情。

关键事件允许展开：

- Resource：名称、capability、预期价格。
- Policy：规则检查结果和剩余预算。
- Payment：金额、network、缩略地址、status。
- Solana：transaction signature 和 Explorer 链接。
- Tool：数据时间和关键指标摘要。

## 允许记录的数据

- User Task 的安全文本。
- Resource ID、name、capability。
- 公开 Provider ID。
- 格式化金额和整数金额。
- Network。
- Mint public address。
- Buyer 与 Merchant public address 的缩略值。
- Policy rule results。
- Payment status。
- Transaction signature。
- Solana Explorer URL。
- Tool Result 的允许字段摘要。
- Error code 和安全错误消息。

## 禁止记录的数据

- Private Key。
- Seed Phrase。
- 完整运行时 secret。
- 完整 `PAYMENT-SIGNATURE`。
- 未过滤的 `PAYMENT-REQUIRED` 或 `PAYMENT-RESPONSE` 原始内容。
- HTTP Authorization header。
- OpenAI API Key。
- 原始环境变量。
- 模型隐藏 Chain-of-Thought。
- Tool Result 中未通过 Schema 的文本。
- 包含 secret 的错误堆栈。

## Reasoning 的展示边界

允许展示结构化决定：

> 当前市场分析需要带时间戳的价格、成交量和技术指标，因此需要 `crypto.market.snapshot` 能力。

不展示：

- 模型逐 token 推理。
- 隐藏思维过程。
- 未经校验的长篇自由文本。

所有 Policy 理由必须由规则结果生成，而不是由 LLM 撰写。

## Transaction Event 详情

`TRANSACTION_CONFIRMED` 可展示：

- amount：0.01 测试 USDC。
- network：Solana Devnet。
- payer：缩略 public address。
- recipient：缩略 public address。
- transaction signature：缩略显示，可复制。
- Explorer link。
- confirmation timestamp。

它不能把“获得 signature”误写为“confirmed”。只有确认后的 settlement 才产生此事件。

## 事件存储与实时传输

- 事件先写入 SQLite，再推送给 UI。
- 每个 Task 的 sequence 必须唯一且递增。
- UI 重连后从最后一个 sequence 继续读取。
- V0 使用 SSE，避免引入 WebSocket 双向复杂度。
- Console sink 使用相同 safe event payload。
- 页面刷新后仍能恢复完整 Feed。

## Demo 成功画面

最后一个事件必须是 `TASK_COMPLETED`，并且页面同时能看到：

- `RESOURCE_FOUND`。
- `PAYMENT_REQUIRED`。
- `POLICY_APPROVED`。
- `TRANSACTION_CONFIRMED`。
- `TOOL_RESULT_RECEIVED`。
- `CONTEXT_UPDATED`。
- 最终市场分析。

如果观众只能看到最终答案而看不到购买过程，Demo 不合格。

## D1-14 验收标准

- Web 和 Console 使用同一套结构化事件。
- Happy Path 的关键阶段都有稳定事件类型。
- 失败、拒绝、需确认和支付未知有独立事件。
- Trace 能证明价格、Policy、链上确认和 Tool Result 使用情况。
- 页面不展示隐藏思维链。
- Secret、Private Key 和完整支付签名永不进入 Event。
- 页面刷新后仍能按 sequence 恢复执行过程。

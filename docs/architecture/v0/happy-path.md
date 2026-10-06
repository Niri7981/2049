# D1-06 Happy Path

## 目标

定义 V0 唯一成功路径，作为后续模块实现、集成测试、Execution Trace 和 Demo Script 的共同依据。

标准用户任务：

> 使用专业市场数据分析一下 SOL 当前的市场情况。

## 阶段一：接收并理解任务

| Step | Actor | Action | Input | Output |
|---:|---|---|---|---|
| 1 | User | 提交标准 Demo 任务 | 自然语言任务 | User Task |
| 2 | Web UI | 将任务发送给 Task API | User Task | Create Task Request |
| 3 | Task API | 校验输入并创建任务 | Create Task Request | `task_id`、Task status `RECEIVED` |
| 4 | Execution Trace | 记录任务已接收 | task_id、safe task summary | `TASK_RECEIVED` event |
| 5 | Agent Runtime | 请求结构化任务判断 | User Task | Capability Plan |
| 6 | Agent Runtime | 确认需要外部市场数据 | Capability Plan | capability `crypto.market.snapshot`、asset `SOL` |
| 7 | Execution Trace | 记录所需能力及公开理由 | capability、asset、reason | `CAPABILITY_REQUIRED` event |

阶段完成条件：Agent 已明确任务需要 SOL 市场快照，但尚未请求 Tool 或付款。

## 阶段二：发现并选择 Resource

| Step | Actor | Action | Input | Output |
|---:|---|---|---|---|
| 8 | Agent Runtime | 查询 Resource Registry | capability、asset | Discovery Request |
| 9 | Resource Registry | 精确匹配允许的 Resource | `crypto.market.snapshot`、`SOL` | Premium SOL Market Snapshot metadata |
| 10 | Agent Runtime | 选择唯一匹配项 | Resource Metadata | Selected `resource_id` |
| 11 | Execution Trace | 记录 Resource 名称和预期价格 | 安全 Resource 摘要 | `RESOURCE_FOUND` event |

阶段完成条件：Agent 找到唯一 Resource，知道它可能需要约 0.01 测试 USDC，但此价格还不是最终支付授权。

## 阶段三：首次调用并获取 402 报价

| Step | Actor | Action | Input | Output |
|---:|---|---|---|---|
| 12 | Agent Runtime | 请求调用所选 Resource | resource_id、asset `SOL` | Invoke Resource Request |
| 13 | Paid Resource Client | 从 Registry 解析固定 endpoint | resource_id | Allowed endpoint |
| 14 | Paid Resource Client | 首次调用 Paid API | validated SOL request | HTTP request without payment |
| 15 | Paid API | 返回付费要求 | 未携带有效付款的请求 | HTTP 402 + `PAYMENT-REQUIRED` |
| 16 | x402 Client Adapter | 解码并标准化报价 | `PAYMENT-REQUIRED` | Normalized Payment Requirement |
| 17 | Purchase Request Service | 比较 402 与 Registry 预期配置 | Payment Requirement、Resource Metadata | Match result |
| 18 | Purchase Request Service | 创建不可变购买记录 | task、resource、input、payment requirement | `purchase_request_id`、status `PENDING` |
| 19 | Execution Trace | 显示价格、Token、网络和 Provider | 安全化的 Payment Requirement | `PAYMENT_REQUIRED` event |

阶段完成条件：系统拥有一条来自真实 HTTP 402 的不可变 Purchase Request；Agent 没有提供金额、network、mint 或 payee。

## 阶段四：Agent 请求购买，Policy 作出决定

| Step | Actor | Action | Input | Output |
|---:|---|---|---|---|
| 20 | Agent Runtime | 判断该 Resource 能帮助完成任务 | Resource purpose、safe quote summary | Purchase Intent |
| 21 | Agent Runtime | 请求购买已有 Purchase Request | purchase_request_id、reason summary | Purchase Request Action |
| 22 | Execution Trace | 记录 Agent 请求购买 | purchase_request_id、safe reason | `PURCHASE_REQUESTED` event |
| 23 | Policy Engine | 读取不可变 Purchase Request 和 Spend Ledger | purchase_request_id | Policy Evaluation Input |
| 24 | Policy Engine | 检查 resource、amount、mint、network、payee、expiry 和幂等状态 | Policy Evaluation Input | Rule Results |
| 25 | Policy Engine | 检查单笔上限和每日剩余预算 | amount、daily spent、policy limits | Budget Result |
| 26 | Policy Engine | 返回并保存 `Approved` | 全部规则通过 | Approved Policy Decision、approval_id |
| 27 | Execution Trace | 展示批准结果和规则理由 | Approved Decision | `POLICY_APPROVED` event |

阶段完成条件：支付获得确定性的 Policy 授权。Agent 的购买理由不会覆盖或修改任何 Policy 规则。

## 阶段五：签名、x402 重试和 Solana 结算

| Step | Actor | Action | Input | Output |
|---:|---|---|---|---|
| 28 | Payment Orchestrator | 原子领取 Approved Purchase | approval_id | Purchase status `PAYING` |
| 29 | Payment Orchestrator | 创建 Payment 记录 | purchase_request_id | Payment status `CREATED` |
| 30 | Wallet Signer | 重新读取并验证批准记录 | approval_id、Payment Requirement | Signable approved payload |
| 31 | x402 Client Adapter | 创建 exact SVM payment payload | Approved Requirement、original request | Unsigned payment payload |
| 32 | Wallet Signer | 使用 Dedicated Demo Wallet 签名 | approved payment payload | Signed payment payload |
| 33 | Execution Trace | 记录签名已完成，不记录签名内容 | payment_id、public wallet address | `PAYMENT_SIGNED` event |
| 34 | x402 Client Adapter | 携带 `PAYMENT-SIGNATURE` 重试原 API 请求 | original request、signed payload | Paid HTTP request |
| 35 | Paid API | 将支付载荷交给 Facilitator 验证 | Payment Payload、Payment Details | Verification Result |
| 36 | Paid API | 准备符合 Schema 的市场快照 | verified request、cached snapshot | Valid Resource Response |
| 37 | Paid API / x402 Middleware | 请求 Facilitator 结算 | verified payload、payment details | Settlement Request |
| 38 | x402 Facilitator | 向 Solana Devnet 提交已签名交易 | Settlement Request | Submitted transaction |
| 39 | Solana Devnet | 执行测试 USDC SPL Token 转账 | Signed transaction | Confirmed transaction signature |
| 40 | x402 Facilitator | 返回结算成功结果 | Solana confirmation | Settlement Response |
| 41 | Paid API | 返回付费资源和结算证明 | Market Snapshot、Settlement Response | HTTP 200 JSON + `PAYMENT-RESPONSE` |
| 42 | Payment Orchestrator | 保存交易结果并关闭支付 | PAYMENT-RESPONSE、transaction signature | Payment status `CONFIRMED` |
| 43 | Execution Trace | 展示金额、状态和 Explorer 链接 | Confirmed Payment | `TRANSACTION_CONFIRMED` event |

阶段完成条件：Solana Devnet 上存在一笔确认的测试 USDC transaction，且 Paid API 已返回市场 JSON。

## 阶段六：验证数据并完成原始任务

| Step | Actor | Action | Input | Output |
|---:|---|---|---|---|
| 44 | Paid Resource Client | 提取 JSON 和 Payment Response | HTTP 200 response | Raw Tool Result、payment proof |
| 45 | Result Validator | 验证 Schema、字段、大小、时间戳和数值范围 | Raw Tool Result | Validated Tool Result |
| 46 | Execution Trace | 记录收到的安全数据摘要 | Validated Tool Result summary | `TOOL_RESULT_RECEIVED` event |
| 47 | Context Assembler | 标记数据来源和不可信属性 | Validated Tool Result、resource_id、as_of | Tool Context Item |
| 48 | Agent Runtime | 将 Tool Context Item 加入当前任务 | Existing Context、Tool Context Item | Updated Agent Context |
| 49 | Execution Trace | 记录 Context 已更新 | task_id、resource_id | `CONTEXT_UPDATED` event |
| 50 | Agent Runtime | 使用付费数据生成 SOL 市场分析 | Original Task、Updated Context | Final Answer |
| 51 | Agent Runtime | 检查回答是否引用 as_of 和至少三个指标 | Final Answer、Tool Result | Validated Final Answer |
| 52 | Task API | 将任务标记为完成 | Validated Final Answer | Task status `COMPLETED` |
| 53 | Execution Trace | 记录完成事件 | task_id、result summary | `TASK_COMPLETED` event |
| 54 | Web UI | 展示最终分析、Trace 和交易证据 | Task、Events、Payment、Final Answer | Demo success screen |

## Happy Path 最终状态

| Object | Final State |
|---|---|
| AgentTask | `COMPLETED` |
| PurchaseRequest | `PAID` |
| PolicyDecision | `APPROVED` |
| Payment | `CONFIRMED` |
| ToolInvocation | `SUCCEEDED` |
| Final Answer | 已生成，并引用付费数据 |

## 不可跳过的检查点

以下任意一步被跳过，都不算完整 V0：

- Agent 明确判断需要外部能力。
- Resource Registry 完成发现。
- Paid API 首次返回真实 HTTP 402。
- Purchase Request 从 Registry 和 402 创建。
- Policy 独立返回 Approved。
- Wallet 只为 Approved 记录签名。
- Solana Devnet transaction 得到确认。
- Paid API 返回结构化 JSON。
- Tool Result 经过验证后加入 Context。
- 最终回答实际引用付费数据。

## D1-06 验收标准

- 每一步都有唯一 Actor。
- 每一步都有明确 Input 和 Output。
- Agent、Policy、Wallet、x402、Facilitator、Solana 和 Paid API 的职责没有混合。
- 支付字段不来自 LLM。
- x402 使用“首次 402、携带签名重试、结算后 200”的两次请求结构。
- 最终结果与最初用户任务形成闭环。

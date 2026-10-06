# D1-07 State Machine

## 目标

定义 V0 中每类对象的合法状态、状态负责人和转换规则。

状态机需要保证：

- 失败时能够安全停止。
- 支付状态未知时不会自动创建第二笔交易。
- Agent 不能直接修改 Policy 或 Payment 状态。
- 每个任务都有明确终点，不会无限运行。

## 1. AgentTask 状态机

### 状态

| Status | Meaning | Owner |
|---|---|---|
| `RECEIVED` | 用户任务已创建 | Task API |
| `PLANNING` | Agent 正在判断任务需要什么能力 | Agent Runtime |
| `DISCOVERING` | 正在查询 Resource Registry | Agent Runtime |
| `RESOURCE_SELECTED` | 已选择唯一 Resource | Agent Runtime |
| `REQUESTING_RESOURCE` | 正在首次调用 Paid API | Agent Runtime |
| `PAYMENT_REQUIRED` | 已收到 402 并创建 Purchase Request | Purchase Request Service |
| `WAITING_FOR_POLICY` | Agent 已请求购买，等待 Policy 决定 | Agent Runtime |
| `PAYMENT_PROCESSING` | 已批准，正在签名和结算 | Payment Orchestrator |
| `TOOL_RESULT_RECEIVED` | 已收到并验证 Tool Result | Result Validator |
| `SYNTHESIZING` | Agent 正在使用数据生成最终回答 | Agent Runtime |
| `COMPLETED` | 原始任务已完成 | Task API |
| `NEEDS_CONFIRMATION` | 合法资源但消费需要用户确认 | Policy Engine |
| `REJECTED` | Policy 拒绝购买，任务停止 | Policy Engine |
| `PAYMENT_UNKNOWN` | 无法确定支付是否成功，必须人工或查询链上状态 | Payment Orchestrator |
| `TOOL_FAILED` | Paid API 或 Tool Result 不可用 | Paid Resource Client / Validator |
| `FAILED` | 其他不可恢复错误 | 当前阶段负责人 |

### 正常转换

```text
RECEIVED
→ PLANNING
→ DISCOVERING
→ RESOURCE_SELECTED
→ REQUESTING_RESOURCE
→ PAYMENT_REQUIRED
→ WAITING_FOR_POLICY
→ PAYMENT_PROCESSING
→ TOOL_RESULT_RECEIVED
→ SYNTHESIZING
→ COMPLETED
```

### 合法分支

```text
PLANNING → FAILED
DISCOVERING → FAILED
REQUESTING_RESOURCE → TOOL_FAILED
WAITING_FOR_POLICY → NEEDS_CONFIRMATION
WAITING_FOR_POLICY → REJECTED
PAYMENT_PROCESSING → PAYMENT_UNKNOWN
PAYMENT_PROCESSING → FAILED
TOOL_RESULT_RECEIVED → TOOL_FAILED
SYNTHESIZING → FAILED
```

### 终止状态

- `COMPLETED`
- `REJECTED`
- `PAYMENT_UNKNOWN`
- `TOOL_FAILED`
- `FAILED`

`NEEDS_CONFIRMATION` 是暂停状态，不是成功状态。V0 没有确认 UI 时，它不会自动继续。

## 2. PurchaseRequest 状态机

### 状态

| Status | Meaning | Who Can Set It |
|---|---|---|
| `PENDING` | 已根据 402 创建，尚未评估 | Purchase Request Service |
| `EVALUATING` | Policy 正在评估 | Policy Engine |
| `APPROVED` | Policy 已批准 | Policy Engine |
| `NEEDS_CONFIRMATION` | 需要用户确认 | Policy Engine |
| `REJECTED` | 不允许支付 | Policy Engine |
| `PAYING` | Payment Orchestrator 已领取执行权 | Payment Orchestrator |
| `PAID` | 已确认结算 | Payment Orchestrator |
| `PAYMENT_UNKNOWN` | 结算结果未知 | Payment Orchestrator |
| `EXPIRED` | 402 报价已过期 | Purchase Request Service / Policy Engine |
| `FAILED` | 在确认没有成功扣款后，支付过程失败 | Payment Orchestrator |

### 正常转换

```text
PENDING
→ EVALUATING
→ APPROVED
→ PAYING
→ PAID
```

### 其他合法转换

```text
PENDING → EXPIRED
EVALUATING → REJECTED
EVALUATING → NEEDS_CONFIRMATION
EVALUATING → EXPIRED
APPROVED → EXPIRED
PAYING → PAYMENT_UNKNOWN
PAYING → FAILED
```

### 不变量

- 创建后不得修改 resource、amount、asset、network、payee、input hash 和 expiry。
- `REJECTED`、`PAID`、`EXPIRED` 不得重新进入 `APPROVED`。
- 一个 Purchase Request 最多关联一个成功 Payment。
- `PAYMENT_UNKNOWN` 不得直接回到 `PAYING`。
- 状态未知时必须先查询原交易结果。

## 3. PolicyDecision 状态

PolicyDecision 本身不需要复杂状态机。每次评估只产生一个不可修改结果：

| Decision | Meaning | Payment Allowed? |
|---|---|---:|
| `APPROVED` | 所有规则通过，可以自动付款 | 是 |
| `REJECTED` | 存在硬性规则违规 | 否 |
| `NEEDS_CONFIRMATION` | Resource 合法，但金额超过自动支付边界 | 否，等待用户确认 |

PolicyDecision 创建后不可更新。如果未来用户确认，应创建新的确认记录，而不是修改原决定。

## 4. Payment 状态机

### 状态

| Status | Meaning | Owner |
|---|---|---|
| `CREATED` | 已为 Approved Purchase 创建 Payment | Payment Orchestrator |
| `SIGNING` | Wallet 正在生成签名 | Wallet Signer |
| `SIGNED` | 已生成签名，但尚未确认提交结果 | Wallet Signer |
| `SUBMITTING` | 付费请求已发送，Facilitator 正在处理 | x402 Client / Facilitator |
| `CONFIRMING` | 已知交易已提交，等待 Solana 确认 | Facilitator / Payment Orchestrator |
| `CONFIRMED` | 链上结算成功 | Payment Orchestrator |
| `REJECTED` | Wallet 或 Facilitator 在提交前拒绝 | Wallet / Facilitator |
| `FAILED` | 已确定没有成功结算 | Payment Orchestrator |
| `UNKNOWN` | 请求超时或响应丢失，无法判断是否已扣款 | Payment Orchestrator |

### 正常转换

```text
CREATED
→ SIGNING
→ SIGNED
→ SUBMITTING
→ CONFIRMING
→ CONFIRMED
```

### 失败转换

```text
CREATED → REJECTED
SIGNING → REJECTED
SIGNING → FAILED
SIGNED → FAILED
SUBMITTING → UNKNOWN
SUBMITTING → FAILED
CONFIRMING → UNKNOWN
CONFIRMING → FAILED
```

### 支付安全规则

- 只有 `APPROVED` Purchase Request 可以创建 Payment。
- `CONFIRMED` 是不可逆终止状态。
- `SUBMITTING` 或 `CONFIRMING` 超时必须进入 `UNKNOWN`，不能假设失败。
- `UNKNOWN` 时禁止创建新 Payment。
- 只有查询 Facilitator、RPC 或 transaction signature 后，才能把 `UNKNOWN` 修正为 `CONFIRMED` 或 `FAILED`。
- 每次状态变化都必须产生 Execution Event。

## 5. ToolInvocation 状态机

| Status | Meaning |
|---|---|
| `CREATED` | Agent 已请求调用 Resource |
| `REQUESTING` | 正在首次调用 API |
| `PAYMENT_REQUIRED` | API 返回 402 |
| `WAITING_FOR_PAYMENT` | 已创建 Purchase Request |
| `RETRYING_WITH_PAYMENT` | 正携带 x402 支付载荷重试 |
| `VALIDATING_RESULT` | 已收到 JSON，正在检查 |
| `SUCCEEDED` | Tool Result 验证通过 |
| `FAILED` | Tool 请求或结果验证失败 |

正常转换：

```text
CREATED
→ REQUESTING
→ PAYMENT_REQUIRED
→ WAITING_FOR_PAYMENT
→ RETRYING_WITH_PAYMENT
→ VALIDATING_RESULT
→ SUCCEEDED
```

规则：

- `SUCCEEDED` 以前，Tool Result 不得进入 Agent Context。
- Payment 已确认但 API 响应丢失时，不重新付款；使用原 payment identifier 幂等重取。
- JSON Schema 验证失败时进入 `FAILED`，不能把原始内容交给 Agent。

## 6. 状态所有权规则

| State Area | 唯一写入者 |
|---|---|
| Task planning/discovery states | Agent Runtime |
| Purchase creation | Purchase Request Service |
| Policy decision | Policy Engine |
| Purchase payment states | Payment Orchestrator |
| Wallet signing states | Wallet Signer，经 Payment Orchestrator 记录 |
| Tool result states | Paid Resource Client / Result Validator |
| Final completion | Task API |

LLM 只能建议下一步动作，不能直接写入数据库状态。

## 7. 全局超时规则

| Stage | Timeout Result | Automatic Retry? |
|---|---|---:|
| Agent planning | Task `FAILED` | 最多一次模型重试 |
| Resource discovery | Task `FAILED` | 否；Registry 是本地的 |
| First API request | Tool `FAILED` | 最多一次安全重试 |
| Policy evaluation | Task `FAILED` | 否；应为本地确定性操作 |
| Before transaction submission | Payment `FAILED` | 可重新处理同一 Payment，不能创建新 Payment |
| After possible submission | Payment `UNKNOWN` | 不付款；只查询状态 |
| Result validation | Tool `FAILED` | 可用同一已确认付款幂等重取一次 |
| Final answer generation | Task `FAILED` | 可重试生成，不重新购买数据 |

## 8. 最大执行边界

V0 固定以下保护：

- 每个 Task 最多创建一个 Purchase Request。
- 每个 Purchase Request 最多一个成功 Payment。
- 每个 Task 最多一次实际付费 Tool 调用。
- Agent 最多执行有限轮次，建议不超过 8 个 Tool/Model turns。
- Final Answer 重试不得触发新的 Tool Purchase。
- 任意未知支付状态都会停止自主执行。

## 9. D1-07 验收标准

- Task、PurchaseRequest、Payment 和 ToolInvocation 各自拥有独立状态机。
- 每个状态有明确含义和唯一负责人。
- 成功、拒绝、需确认、Tool 失败和支付未知都有明确终点。
- `UNKNOWN` 状态不会触发第二笔付款。
- Agent 和 LLM 不能直接修改支付状态。
- 已购买的数据可以用于重试最终回答，而无需再次购买。

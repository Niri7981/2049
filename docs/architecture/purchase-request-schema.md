# D1-09 PurchaseRequest Schema

## 目标

PurchaseRequest 是 Agent 推理区域与可信支付区域之间的安全边界。

它表示：

> 系统已经从一个允许的 Resource 和一次真实 HTTP 402 中，生成了一笔具体、不可变、等待 Policy 判断的购买请求。

PurchaseRequest 不是交易，也不代表已经批准或已经支付。

## 谁创建 PurchaseRequest

唯一创建者：`Purchase Request Service`。

创建前必须已经具备：

1. 一个有效的 AgentTask。
2. 一个来自 Static Registry 的 Resource。
3. 一次符合 x402 Schema 的 HTTP 402。
4. 通过 Schema 校验的 Tool Input。
5. Registry 与 402 的价格、Token、network 和 payee 完全匹配。

Agent 不能创建完整 PurchaseRequest。Agent 只能在它创建以后，请求购买该 `purchase_request_id`。

## V0 字段

| Field | Type Concept | Required | Source | Mutable? | Purpose |
|---|---|---:|---|---:|---|
| `purchase_request_id` | unique string | 是 | Purchase Request Service | 否 | 购买请求唯一标识 |
| `task_id` | string | 是 | AgentTask | 否 | 关联原始用户任务 |
| `resource_id` | string | 是 | Static Registry | 否 | 关联被购买的 Resource |
| `provider_id` | string | 是 | Static Registry | 否 | 关联固定 Provider |
| `tool_invocation_id` | string | 是 | Paid Resource Client | 否 | 关联首次 API 调用和后续重试 |
| `input` | validated object | 是 | Agent Tool Call，经 Input Schema 验证 | 否 | V0 固定为 `asset = SOL` |
| `input_hash` | deterministic hash | 是 | Purchase Request Service | 否 | 绑定本次调用参数并参与幂等判断 |
| `payment_scheme` | fixed string | 是 | HTTP 402，与 Registry 校验 | 否 | V0 固定为 x402 `exact` |
| `amount_minor` | positive integer | 是 | HTTP 402，与 Registry 校验 | 否 | 支付金额，V0 为 10000 个最小单位 |
| `currency` | fixed string | 是 | Static Registry | 否 | UI 使用，V0 为 USDC |
| `asset_id` | Solana mint address | 是 | HTTP 402，与 Registry 校验 | 否 | 精确指定测试 USDC |
| `asset_decimals` | integer | 是 | Static Registry | 否 | V0 为 6 |
| `network` | CAIP-2 identifier | 是 | HTTP 402，与 Registry 校验 | 否 | 精确指定 Solana Devnet |
| `pay_to` | Solana address | 是 | HTTP 402，与 Registry 校验 | 否 | 精确指定 Merchant Wallet |
| `resource_endpoint_id` | internal reference | 是 | Static Registry | 否 | 绑定服务端 allowlist endpoint，不保存 Agent 提交的 URL |
| `quote_fingerprint` | deterministic hash | 是 | Normalized 402 Requirement | 否 | 检测报价内容是否被替换 |
| `quote_expires_at` | timestamp | 是 | HTTP 402 或本地安全有效期 | 否 | 防止签署过期报价 |
| `idempotency_key` | unique string | 是 | Purchase Request Service | 否 | 防止同一任务和输入重复购买 |
| `status` | enum | 是 | 状态负责人 | 是，仅允许合法状态转换 | 表示评估和付款进度 |
| `created_at` | timestamp | 是 | Purchase Request Service | 否 | 审计创建时间 |

## V0 标准记录

| Field | Expected Value |
|---|---|
| `task_id` | 当前 SOL 分析任务 ID |
| `resource_id` | `premium-sol-market-snapshot` |
| `provider_id` | `demo-market-data-provider` |
| `input` | `asset = SOL` |
| `payment_scheme` | `exact` |
| `amount_minor` | `10000` |
| `currency` | `USDC` |
| `asset_decimals` | `6` |
| `asset_id` | Circle Solana Devnet 测试 USDC mint |
| `network` | Solana Devnet CAIP-2 identifier |
| `pay_to` | 固定 Demo Merchant Wallet public address |
| `status` | `PENDING` |

## Agent 可以提交什么

在请求购买时，Agent 只允许提交：

| Field | Required | Effect on Payment |
|---|---:|---|
| `purchase_request_id` | 是 | 定位服务器已经创建的不可变记录 |
| `reason_summary` | 是 | 仅用于 Trace 和审计，不影响 Policy 规则 |

`reason_summary` 示例语义：

> 当前 SOL 市场分析需要该 Resource 提供的价格、成交量和技术指标。

Agent 不允许提交或覆盖：

- amount。
- currency。
- asset mint。
- network。
- payee。
- endpoint。
- payment scheme。
- expiry。
- idempotency key。
- transaction。

## 幂等键

V0 的幂等身份由以下业务信息共同确定：

- `task_id`
- `resource_id`
- `input_hash`

同一 Task、同一 Resource、同一规范化输入只能存在一个有效 PurchaseRequest。

以下内容不进入幂等键：

- Agent 的自然语言购买理由。
- UI 重试次数。
- Execution Trace 文本。
- 当前 Payment 状态。

这样可以防止 Agent 改写理由后产生第二笔购买。

## 创建时的验证顺序

Purchase Request Service 必须按以下顺序检查：

1. Task 存在且处于 `REQUESTING_RESOURCE`。
2. Resource 存在且 `enabled = true`。
3. Tool Input 已通过 Resource Input Schema。
4. HTTP response status 为 402。
5. `PAYMENT-REQUIRED` 可以被正常解码。
6. Payment scheme 等于 Registry 预期值。
7. Amount 是正整数且等于 Registry 预期值。
8. Asset mint 等于 Registry allowlist。
9. Network 等于 Registry allowlist。
10. Payee 等于 Registry allowlist。
11. Quote 尚未过期。
12. 不存在相同 idempotency key 的有效记录。
13. 创建状态为 `PENDING` 的 PurchaseRequest。

任意一步失败都不得生成可付款的 PurchaseRequest。

## 不可变字段

创建后，以下字段永远不能更新：

- task_id。
- resource_id。
- provider_id。
- tool_invocation_id。
- input。
- input_hash。
- payment_scheme。
- amount_minor。
- currency。
- asset_id。
- asset_decimals。
- network。
- pay_to。
- resource_endpoint_id。
- quote_fingerprint。
- quote_expires_at。
- idempotency_key。
- created_at。

如果 Paid API 返回了新价格或新 payee，系统必须创建新的报价流程；不得修改旧 PurchaseRequest。

## 可变字段

只有 `status` 可以变化，而且必须遵守状态机：

```text
PENDING
→ EVALUATING
→ APPROVED
→ PAYING
→ PAID
```

允许的终止或暂停分支：

- `REJECTED`
- `NEEDS_CONFIRMATION`
- `EXPIRED`
- `PAYMENT_UNKNOWN`
- `FAILED`

状态修改者必须符合 D1-07 的状态所有权规则。

## Policy 读取的内容

Policy Engine 只读取 PurchaseRequest 和本地 Spend Ledger，不读取原始用户 Prompt 来决定支付权限。

它需要判断：

- Resource 是否允许。
- Provider 是否允许。
- 金额是否低于单笔上限。
- 每日剩余预算是否足够。
- Currency 和 asset mint 是否正确。
- Network 是否正确。
- Payee 是否正确。
- Quote 是否有效。
- 是否已经存在付款。

Agent 的 `reason_summary` 可以显示在 Execution Trace 中，但不能覆盖任何失败规则。

## Wallet 读取的内容

Wallet Signer 不接受一组自由支付参数，而是接收内部 `approval_id`。

签名前必须重新读取对应 PurchaseRequest，并确认：

- status 为 `APPROVED` 或已由 Payment Orchestrator 原子转换为 `PAYING`。
- approval 对应同一 purchase_request_id。
- amount、asset、network、payee 和 quote fingerprint 未变化。
- Quote 未过期。
- 没有其他成功或活动 Payment。

## 日志与 UI 可见性

### 可以展示

- purchase_request_id 的缩略值。
- Resource name。
- 0.01 USDC。
- Solana Devnet。
- Provider name。
- Agent 的 reason summary。
- Policy 状态。

### 不展示

- 完整内部 endpoint。
- 完整原始 402 header。
- quote fingerprint 原值。
- 完整 payee 以外的内部支付载荷。
- 任何私钥或签名材料。

## D1-09 验收标准

- PurchaseRequest 的创建者唯一。
- 所有支付关键字段都有可信来源。
- Agent 只能提交 purchase_request_id 和理由摘要。
- 金额使用整数最小单位，不使用浮点数。
- 相同 Task、Resource 和 Input 不会产生重复有效购买请求。
- 创建后不能修改金额、Token、network、payee 或 endpoint。
- Policy 和 Wallet 都基于同一条服务器记录工作。
- PurchaseRequest 明确区分“购买意图”“支付批准”和“已完成支付”。

# D1-10 Spending Policy

## 目标

Spending Policy 是 V0 唯一的消费授权边界。

它回答的不是“这个 Tool 有没有用”，而是：

> 对于这条已经固定金额、Token、network、payee 和 Resource 的 PurchaseRequest，系统是否允许付款？

Policy 使用确定性规则，不使用 LLM 做授权判断。

## V0 Policy 配置

| Rule | V0 Value | Meaning |
|---|---:|---|
| `max_single_purchase_minor` | `100000` | 单笔最多自动支付 0.10 USDC |
| `daily_budget_minor` | `1000000` | 每日总预算 1.00 USDC |
| `auto_pay_under_limit` | `true` | 全部规则通过且单笔不超限时自动批准 |
| `allowed_currency` | `USDC` | UI 货币名称固定为 USDC |
| `allowed_asset_id` | Circle Solana Devnet 测试 USDC mint | 只允许指定测试 USDC |
| `allowed_asset_decimals` | `6` | 金额使用 6 位精度 |
| `allowed_network` | Solana Devnet CAIP-2 identifier | 不允许 Mainnet 或其他链 |
| `allowed_resource_id` | `premium-sol-market-snapshot` | 只允许唯一 Paid API |
| `allowed_provider_id` | `demo-market-data-provider` | 只允许固定 Provider |
| `allowed_pay_to` | Demo Merchant Wallet public address | 只允许固定收款地址 |
| `allowed_payment_scheme` | `exact` | 只允许 x402 固定价格支付 |
| `max_paid_tools_per_task` | `1` | 每个 Task 最多一次付费 Tool |
| `max_active_payments_per_purchase` | `1` | 同一 PurchaseRequest 不能并发付款 |

金额换算：

- 0.01 USDC = 10,000 最小单位。
- 0.10 USDC = 100,000 最小单位。
- 1.00 USDC = 1,000,000 最小单位。

## Policy 输入

Policy Engine 只能读取：

- 服务器保存的 PurchaseRequest。
- Static Resource Registry。
- 当日 Spend Ledger。
- 当前 Task 的购买次数。
- 已存在的 Payment 状态。
- 当前服务端时间。

Policy Engine 不使用以下内容作为授权依据：

- 原始用户 Prompt。
- Agent 的隐藏推理。
- Agent 声称任务“非常重要”。
- Paid API 返回的自然语言说明。
- UI 提交的金额或收款地址。

Agent 的 `reason_summary` 只用于 Trace，不影响规则结果。

## 固定评估顺序

Policy 必须按以下顺序评估，并在硬性安全规则失败时立即拒绝：

1. PurchaseRequest 是否存在。
2. PurchaseRequest status 是否为 `PENDING` 或合法的 `EVALUATING`。
3. PurchaseRequest 是否由服务端创建且字段完整。
4. Resource 是否存在并处于 enabled 状态。
5. Resource ID 是否在 allowlist。
6. Provider ID 是否在 allowlist。
7. Payment scheme 是否为 `exact`。
8. Amount 是否为正整数。
9. Currency 是否为 USDC。
10. Asset mint 是否为指定测试 USDC。
11. Asset decimals 是否为 6。
12. Network 是否为 Solana Devnet。
13. Payee 是否为固定 Merchant Wallet。
14. 402 quote fingerprint 是否仍与 PurchaseRequest 一致。
15. Quote 是否尚未过期。
16. Registry expected price 是否等于 402 amount。
17. 是否已有成功 Payment。
18. 是否已有活动 Payment。
19. 当前 Task 是否已经使用过付费 Tool。
20. 本次金额是否超过单笔自动支付上限。
21. 本次金额加当日已确认消费是否超过每日预算。
22. 返回最终 Decision。

## 三种 Decision

### `APPROVED`

只有在以下条件全部满足时返回：

- 所有身份、Resource、Token、network、payee 和 quote 规则通过。
- 不存在成功或活动 Payment。
- Task 尚未完成其他付费 Tool 调用。
- 单笔金额小于或等于 0.10 USDC。
- 本次消费后当日累计小于或等于 1.00 USDC。
- `auto_pay_under_limit = true`。

Approved 只创建不可变 PolicyDecision 和内部 `approval_id`，不会直接签名。

### `NEEDS_CONFIRMATION`

只有在以下情况下返回：

- 所有安全和 allowlist 规则均通过。
- 没有重复 Payment。
- 单笔金额大于 0.10 USDC。
- 本次消费后仍没有超过 1.00 USDC 每日预算。

V0 不实现完整确认 UI。因此该状态会暂停任务，绝不会自动付款。

### `REJECTED`

以下任意情况直接拒绝：

- 未知或 disabled Resource。
- 未知 Provider。
- 错误 payment scheme。
- 金额不是正整数。
- Currency、asset mint 或 decimals 不匹配。
- Network 不是 Solana Devnet。
- Payee 不是固定 Merchant Wallet。
- Quote 被修改或已经过期。
- 402 价格与 Registry 预期价格不一致。
- 已有成功或活动 Payment。
- 当前 Task 已经购买过一次付费 Tool。
- 本次消费会超过每日预算。
- PurchaseRequest 缺少必需字段或来源不可信。

## 决策矩阵

| Case | Single Amount | Daily Spent Before | Resource / Asset / Network / Payee | Existing Payment | Decision | Reason |
|---|---:|---:|---|---|---|---|
| 标准 Demo | 0.01 | 0.00 | 全部匹配 | 无 | `APPROVED` | 小额合法消费，可自动付款 |
| 单笔刚好上限 | 0.10 | 0.00 | 全部匹配 | 无 | `APPROVED` | 不超过单笔上限 |
| 单笔超过上限 | 0.11 | 0.00 | 全部匹配 | 无 | `NEEDS_CONFIRMATION` | 超过自动支付上限但未超每日预算 |
| 每日预算刚好用完 | 0.10 | 0.90 | 全部匹配 | 无 | `APPROVED` | 支付后累计正好 1.00 |
| 超过每日预算 | 0.10 | 0.91 | 全部匹配 | 无 | `REJECTED` | 支付后累计 1.01 |
| 错误 network | 0.01 | 0.00 | Network 不匹配 | 无 | `REJECTED` | 硬性安全规则失败 |
| 错误 USDC mint | 0.01 | 0.00 | Asset 不匹配 | 无 | `REJECTED` | 不允许其他 Token |
| 错误 payee | 0.01 | 0.00 | Payee 不匹配 | 无 | `REJECTED` | 防止收款地址替换 |
| API 临时涨价 | 0.02 | 0.00 | 402 amount 与 Registry 不同 | 无 | `REJECTED` | V0 不接受动态价格 |
| Quote 过期 | 0.01 | 0.00 | 其他字段匹配 | 无 | `REJECTED` | 不签署过期报价 |
| 已有活动支付 | 0.01 | 0.00 | 全部匹配 | `SUBMITTING` | `REJECTED` | 防止并发重复支付 |
| 已支付成功 | 0.01 | 0.00 | 全部匹配 | `CONFIRMED` | `REJECTED` | 相同购买不能二次付款 |
| 状态未知 | 0.01 | 0.00 | 全部匹配 | `UNKNOWN` | `REJECTED` | 必须先查询原交易 |

## Approved Decision 必须记录

| Field | Purpose |
|---|---|
| `policy_decision_id` | 审计唯一标识 |
| `purchase_request_id` | 绑定不可变 PurchaseRequest |
| `decision` | `APPROVED` |
| `rule_results` | 保存每条规则是否通过 |
| `reason` | 可展示的确定性批准理由 |
| `approved_amount_minor` | 与 PurchaseRequest amount 完全一致 |
| `daily_spent_before_minor` | 决策前累计消费 |
| `daily_remaining_after_minor` | 批准后的理论剩余额度 |
| `created_at` | 决策时间 |
| `expires_at` | Approval 有效期，不得超过 quote expiry |

PolicyDecision 创建后不可修改。

## 标准 Demo 的批准理由

标准 0.01 USDC 请求应产生以下可展示理由：

> Purchase approved: 0.01 USDC does not exceed the 0.10 USDC single-purchase limit; the Resource, Provider, Token, Solana Devnet network, payee and daily budget all match the configured Spending Policy.

这段文字由系统根据规则结果生成，不由 LLM 自由编写。

## 每日预算计算

当日已消费金额只累计：

- Payment status 为 `CONFIRMED` 的记录。
- 使用相同允许 asset mint 的付款。
- 按 `Asia/Shanghai` 自然日计算，每日 00:00 重置统计窗口。

`UNKNOWN` Payment 不直接计为已消费，但会冻结同一 PurchaseRequest，并阻止新支付，直到状态被查清。

## Policy 与 Wallet 的边界

Policy Engine：

- 读取规则和账本。
- 生成 PolicyDecision。
- 不读取 Private Key。
- 不签名。
- 不发送 HTTP 请求或 Solana transaction。

Wallet Signer：

- 不重新解释 Policy。
- 只接受有效 `approval_id`。
- 签名前核对 approval 和 PurchaseRequest 字段。
- 无权把 Rejected 或 NeedsConfirmation 改成 Approved。

## D1-10 验收标准

- 0.01 USDC 标准 Demo 请求必定得到 `APPROVED`。
- 0.11 USDC 合法请求得到 `NEEDS_CONFIRMATION`，不会自动付款。
- 超过每日预算得到 `REJECTED`。
- 错误 Resource、mint、network、payee、scheme 或动态价格均被拒绝。
- 重复、并发和未知状态 Payment 均不能再次付款。
- Policy 不读取 Prompt 或模型推理来改变授权结果。
- Policy 只授权，不接触 Private Key 或执行交易。

## Day 5 实现补充

主要规则已在 `src/modules/purchases/` 落地。为避免并发预算透支，实际可用预算还扣除未完成的预占；`PAYING` / `PAYMENT_UNKNOWN` 会阻止后续付款。预算覆盖此运行时账本，不追踪其他程序的链上转账。过期批准和未知付款目前保守保留，自动对账与释放待后续实现。详见 [Day 5 运行说明](../demo/day-5-runbook.md)。

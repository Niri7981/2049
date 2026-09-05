# D1-08 Resource Schema

## 目标

定义 Agent 和系统如何无歧义地理解一个可购买的外部能力。

Resource Metadata 负责描述：

- Tool 能做什么。
- 接受什么输入。
- 返回什么结果。
- 预期需要支付多少钱。
- 使用什么 Token 和网络。
- 允许向谁付款。

Resource Metadata 不等于支付授权。真正付款前仍必须读取并验证 Paid API 返回的 HTTP 402。

## V0 Resource 字段

| Field | Type Concept | Required | Visible to Agent? | Purpose |
|---|---|---:|---:|---|
| `resource_id` | string | 是 | 是 | 稳定唯一 ID；Agent 只能通过这个 ID 使用 Resource |
| `name` | string | 是 | 是 | UI 和 Agent 可读名称 |
| `description` | string | 是 | 是 | 说明这个 Resource 能解决什么问题 |
| `capability` | fixed string | 是 | 是 | 机器匹配能力，例如 `crypto.market.snapshot` |
| `provider_id` | string | 是 | 是 | 固定 Provider 标识，用于展示和 allowlist |
| `endpoint` | HTTPS URL | 是 | 否 | 服务端实际调用地址；不得由 Agent 提供或修改 |
| `method` | HTTP method | 是 | 否 | V0 固定为 `GET` |
| `input_schema` | schema reference | 是 | 是 | 限制合法输入及其格式 |
| `output_schema` | schema reference | 是 | 是 | 验证付费 API 的返回结果 |
| `expected_price_minor` | integer | 是 | 是 | 预期价格的 USDC 最小单位整数 |
| `currency` | fixed string | 是 | 是 | UI 货币符号，V0 固定为 `USDC` |
| `asset_id` | string | 是 | 可显示 | 精确的 Solana Devnet 测试 USDC mint |
| `asset_decimals` | integer | 是 | 否 | V0 固定为 6，用于金额换算和校验 |
| `network` | CAIP-2 identifier | 是 | 是 | 精确标识 Solana Devnet |
| `allowed_pay_to` | Solana address | 是 | 可显示缩略值 | 唯一允许的 Provider 收款地址 |
| `payment_scheme` | fixed string | 是 | 是 | V0 固定为 x402 `exact` |
| `enabled` | boolean | 是 | 否 | 紧急关闭 Resource 的本地开关 |

## 唯一 V0 Resource

| Field | V0 Value |
|---|---|
| `resource_id` | `premium-sol-market-snapshot` |
| `name` | Premium SOL Market Snapshot API |
| `description` | 返回带时间戳的 SOL 市场价格、成交量、波动率和技术指标快照 |
| `capability` | `crypto.market.snapshot` |
| `provider_id` | `demo-market-data-provider` |
| `endpoint` | 由服务端 Registry 配置，Agent 不可见 |
| `method` | `GET` |
| `input_schema` | `MarketSnapshotInput` |
| `output_schema` | `MarketSnapshotOutput` |
| `expected_price_minor` | `10000` |
| `currency` | `USDC` |
| `asset_id` | Circle Solana Devnet 测试 USDC mint |
| `asset_decimals` | `6` |
| `network` | Solana Devnet CAIP-2 identifier |
| `allowed_pay_to` | Demo Merchant Wallet public address |
| `payment_scheme` | `exact` |
| `enabled` | `true` |

`expected_price_minor = 10000` 且 USDC decimals 为 6，因此展示价格为 0.01 USDC。

## Input Schema 合同

V0 输入只保留一个业务字段：

| Field | Allowed Value | Required | Reason |
|---|---|---:|---|
| `asset` | `SOL` | 是 | V0 只支持唯一 Demo 资产 |

不允许：

- 任意 symbol。
- 自定义 endpoint。
- 自定义 provider。
- 自定义价格或支付参数。
- 交易、买卖、杠杆或仓位参数。

## Output Schema 合同

Paid API 必须返回以下业务字段：

| Field | Type Concept | Required | Purpose |
|---|---|---:|---|
| `asset` | fixed string `SOL` | 是 | 标明数据对象 |
| `as_of` | ISO timestamp | 是 | 标明快照时间，防止冒充实时数据 |
| `spot_price_usd` | non-negative number | 是 | SOL 美元现货价格 |
| `change_24h_pct` | finite number | 是 | 24 小时涨跌幅 |
| `volume_24h_usd` | non-negative number | 是 | 24 小时成交量 |
| `market_cap_usd` | non-negative number | 是 | 市值 |
| `volatility_7d_pct` | non-negative number | 是 | 7 日波动率 |
| `rsi_14d` | number from 0 to 100 | 是 | 14 日 RSI |
| `support_levels_usd` | ascending number list | 是 | 支撑位列表 |
| `resistance_levels_usd` | ascending number list | 是 | 阻力位列表 |
| `source_label` | short string | 是 | 数据来源说明 |
| `is_demo_snapshot` | boolean `true` | 是 | 明确标记 Demo 快照 |

## 字段来源边界

| Data | Authoritative Source | Agent Can Change? |
|---|---|---:|
| Resource capability | Static Registry | 否 |
| Endpoint | Static Registry | 否 |
| Expected price | Static Registry | 否 |
| Actual quoted price | HTTP 402 `PAYMENT-REQUIRED` | 否 |
| Currency display name | Static Registry | 否 |
| Asset mint | Registry 与 HTTP 402 必须一致 | 否 |
| Network | Registry 与 HTTP 402 必须一致 | 否 |
| Payee | Registry 与 HTTP 402 必须一致 | 否 |
| Tool input asset | Agent 可从允许值中选择；V0 只有 SOL | 仅限 Schema |
| Purchase reason | Agent | 是，但不影响 Policy 规则 |

## Discovery Matching 规则

Resource Registry 只进行确定性匹配：

1. `enabled` 必须为 true。
2. Capability 必须精确等于 `crypto.market.snapshot`。
3. Input Schema 必须接受 `asset = SOL`。
4. V0 必须只返回一个结果。
5. 零个结果时停止任务并报告缺少能力。
6. 多个结果时停止并报告 Registry 配置错误，不让 Agent 自由选择 Provider。

## 价格验证规则

首次 HTTP 402 返回后，Purchase Request Service 必须检查：

- 402 scheme 等于 Resource 的 `payment_scheme`。
- 402 amount 等于 `expected_price_minor`。
- 402 asset mint 等于 `asset_id`。
- 402 network 等于 `network`。
- 402 payee 等于 `allowed_pay_to`。
- Quote 未过期。

任何一项不一致，都不能自动创建可支付的 Approved Purchase。

## 不加入 V0 的字段

以下字段暂不加入 Resource Schema：

- tags。
- rating。
- popularity。
- provider reputation。
- pricing tiers。
- subscription plan。
- usage quota。
- inventory。
- geographic availability。
- SLA。
- refund policy。
- marketplace listing status。
- multiple payment options。

它们都不帮助完成唯一自主购买 Demo。

## D1-08 验收标准

- Agent 能通过 Resource Metadata 理解 Tool 的能力、输入、输出和预期价格。
- endpoint、mint、network 和 payee 不能由 Agent 修改。
- 金额使用整数最小单位，不使用浮点数执行 Policy。
- Resource Schema 只支持一个 SOL Market Snapshot Tool。
- Registry 价格与实际 HTTP 402 报价职责明确。
- Output Schema 足以支持最终回答引用至少三个付费指标。
- 没有 Marketplace、动态排名或多 Provider 字段。

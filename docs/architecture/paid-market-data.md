# D1-13 Paid Market Data Contract

## 目标

定义 V0 唯一 Paid API 的产品价值、输入输出、数据来源、付费前后行为和质量边界。

API 的存在必须让观众容易理解：Agent 缺少完成任务所需的当前市场数据，所以购买一次结构化数据调用。

## Resource 定义

| Item | Decision |
|---|---|
| Name | Premium SOL Market Snapshot API |
| Resource ID | `premium-sol-market-snapshot` |
| Capability | `crypto.market.snapshot` |
| Provider | `demo-market-data-provider` |
| Asset | SOL |
| Price | 0.01 测试 USDC |
| Network | Solana Devnet |
| Payment | x402 exact |
| Response | JSON |
| Runtime source | 本地缓存、带时间戳的市场快照 |

## 为什么选择 Market Snapshot

- “当前市场分析”明显需要外部数据。
- 数据具有清晰的按次价值。
- JSON 可直接验证并加入 Agent Context。
- 最终回答可以明确引用购买到的指标。
- 不需要文档抓取、向量搜索或复杂异步任务。
- 单个 SOL 场景足以证明自主购买闭环。

## 数据来源策略

V0 采用“演示前刷新、运行时冻结”的快照：

1. Demo 前从可信公开行情来源获取一次 SOL 数据。
2. 将数据标准化为固定 Output Schema。
3. 记录准确 `as_of` 和 `source_label`。
4. 运行时 Paid API 只返回已经验证的快照。
5. Demo 不依赖第三方行情 API 的实时可用性。

这样保留真实数据基础，同时避免 rate limit、API key、网络超时和第三方 Schema 变化破坏 Demo。

## 新鲜度规则

| Condition | Behavior |
|---|---|
| 快照不超过 2 小时 | 标准 Demo，可描述为当前市场快照 |
| 快照 2–24 小时 | 可以运行，但 UI 和最终回答必须显示陈旧提示 |
| 快照超过 24 小时 | Demo preflight 失败，不允许用“当前市场”措辞 |
| 缺少 `as_of` | Output validation 失败 |

目标是在正式演示前 30 分钟内刷新一次快照。

## API 输入

| Field | Required | Allowed Value |
|---|---:|---|
| `asset` | 是 | `SOL` |

其他资产返回请求错误，不产生 PurchaseRequest，也不触发支付。

## API 输出

| Field | Type / Constraint | Required | Agent Usage |
|---|---|---:|---|
| `asset` | 固定 `SOL` | 是 | 确认分析对象 |
| `as_of` | ISO 8601 timestamp | 是 | 声明数据时间 |
| `spot_price_usd` | 大于 0 的有限数值 | 是 | 当前价格判断 |
| `change_24h_pct` | 有限百分比 | 是 | 短期方向 |
| `volume_24h_usd` | 非负有限数值 | 是 | 活跃度判断 |
| `market_cap_usd` | 大于 0 的有限数值 | 是 | 规模背景 |
| `volatility_7d_pct` | 非负有限数值 | 是 | 风险水平 |
| `rsi_14d` | 0–100 | 是 | 动量判断 |
| `support_levels_usd` | 升序正数数组，最多 3 项 | 是 | 下方关键位置 |
| `resistance_levels_usd` | 升序正数数组，最多 3 项 | 是 | 上方关键位置 |
| `source_label` | 受长度限制的纯文本 | 是 | 数据来源声明 |
| `is_demo_snapshot` | 固定为 true | 是 | 防止冒充实时生产数据 |

V0 不返回自由格式的“操作建议”或“系统指令”。市场判断由 Agent 根据结构化数值生成。

## 数据一致性规则

Result Validator 必须检查：

- `asset` 为 SOL。
- `as_of` 是合法时间且不在未来。
- 数值不是 NaN、Infinity 或字符串伪装。
- Price、volume、market cap 和 volatility 非负。
- RSI 在 0 到 100 之间。
- 支撑位和阻力位已排序且数组长度受限。
- 支撑位应低于 spot price，阻力位应高于 spot price。
- `source_label` 不超过固定长度。
- Response body 不超过 V0 大小限制。
- 不包含 Schema 以外的可执行指令字段。

验证失败时，原始响应不得进入 Agent Context。

## 未付款行为

首次请求没有有效 `PAYMENT-SIGNATURE` 时：

- 返回 HTTP 402。
- 返回机器可读 `PAYMENT-REQUIRED`。
- 不返回市场数据 body。
- 不创建长期 API key。
- 不泄露部分 premium 指标。

## 付款后行为

第二次请求携带有效 `PAYMENT-SIGNATURE` 时：

1. 验证 Payment Payload。
2. 准备并验证市场 JSON。
3. 完成 settlement。
4. 返回 HTTP 200。
5. 返回 `PAYMENT-RESPONSE`。
6. 返回完整市场快照 JSON。

如果市场 JSON 无法生成或不符合 Schema，应避免完成新的 settlement；如果已经确认付款，则允许使用同一 payment identifier 幂等重取数据，不能再次收费。

## Tool Result 进入 Context 的格式边界

Context Assembler 添加的内容应包含：

- Resource ID。
- Provider ID。
- `as_of`。
- 已验证的业务字段。
- Payment ID 或 transaction signature 的引用。
- 明确的 `untrusted_tool_data` 标记。

它不应包含：

- 原始 HTTP headers。
- `PAYMENT-SIGNATURE`。
- Provider 返回的未验证额外字段。
- 可被解释为 system/developer instruction 的包装文本。

## 最终回答使用要求

Agent 的最终分析必须至少引用：

- `spot_price_usd`。
- `change_24h_pct` 或 `volume_24h_usd`。
- `volatility_7d_pct`、`rsi_14d` 或关键价位中的至少一个。
- `as_of`。

最终回答必须区分：

- 数据事实：Paid API 返回的数字。
- Agent 判断：根据数字形成的市场解释。

并明确声明：数据为带时间戳的 Demo 快照，不构成投资建议。

## V0 不做

- 不实时代理第三方 Market API。
- 不支持 BTC、ETH 或任意 symbol。
- 不做 K 线图。
- 不做交易信号、买卖建议或价格预测。
- 不做历史数据下载。
- 不做 sentiment、链上地址或 DEX analytics。
- 不对快照准确性做生产级 SLA。

## D1-13 验收标准

- Paid API 的价值与用户任务直接相关。
- 输入只有 SOL，输出为结构化 JSON。
- 运行时不依赖第三方行情服务。
- 数据包含明确来源和时间戳。
- 新鲜度规则明确，陈旧数据不会冒充当前数据。
- Tool Result 足以支持最终回答引用至少三个指标。
- 未验证响应不能进入 Agent Context。
- 支付成功后数据可幂等重取，不能重复收费。

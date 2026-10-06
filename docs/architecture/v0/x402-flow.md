# D1-12 x402 Payment Flow

## 目标

固定 V0 的 x402 V2 wire protocol、模块职责和成功条件，避免实现时把“支付”和“API 重试”拆成错误的三次请求流程。

## V0 协议选择

| Item | Decision |
|---|---|
| Protocol | x402 V2 |
| Scheme | `exact` |
| Network | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Asset | Solana Devnet 测试 USDC |
| Amount | 0.01 USDC / 10,000 最小单位 |
| Client | 服务端 x402 Client Adapter |
| Resource Server | Premium SOL Market Snapshot API |
| Facilitator | x402.org 默认测试 Facilitator，失败时使用预先验证的备用项 |

x402 官方网络表当前列出 Solana Devnet、测试 USDC mint 和 6 位精度，并说明默认 Facilitator 面向测试环境：[x402 Network and Token Support](https://docs.x402.org/core-concepts/network-and-token-support)。

## 三个标准 Header

| Header | Direction | Purpose |
|---|---|---|
| `PAYMENT-REQUIRED` | Paid API → Client | Base64 编码的 PaymentRequired，描述可接受付款条件 |
| `PAYMENT-SIGNATURE` | Client → Paid API | Base64 编码的 PaymentPayload，证明买方已授权付款 |
| `PAYMENT-RESPONSE` | Paid API → Client | Base64 编码的 SettlementResponse，说明结算结果 |

Header 语义以 x402 V2 官方说明为准：[x402 HTTP 402](https://docs.x402.org/core-concepts/http-402)。

## 正确的 HTTP 结构

```text
Request #1
Client → Paid API
No payment payload

Response #1
Paid API → Client
HTTP 402
PAYMENT-REQUIRED: <machine-readable quote>

Request #2
Client → Paid API
Same resource request
PAYMENT-SIGNATURE: <signed payment payload>

Response #2
Paid API → Client
HTTP 200
PAYMENT-RESPONSE: <settlement result>
Body: <paid market JSON>
```

V0 不采用以下错误理解：

```text
先付款
→ 等待 transaction ID
→ 第三次请求 API 并只提交 transaction ID
```

在标准 exact 流程中，第二次 API 请求携带签名支付载荷；Server 和 Facilitator 在该请求生命周期中完成验证与结算，然后返回资源和 settlement response。

## Payment Requirement 必须包含或派生的信息

| Field Concept | V0 Expectation | Validation |
|---|---|---|
| x402 version | V2 支持值 | 不支持则拒绝 |
| scheme | `exact` | 必须匹配 Registry |
| network | Solana Devnet CAIP-2 ID | 必须精确匹配 |
| asset | 固定测试 USDC mint | 必须精确匹配 |
| amount | 10,000 最小单位 | 必须精确匹配预期价格 |
| payTo | 固定 Merchant address | 必须精确匹配 allowlist |
| resource | 当前 Paid API 资源 | 必须绑定当前 invocation |
| description | SOL 市场快照描述 | 仅展示，不作为授权依据 |
| mime type | JSON | 其他类型拒绝 |
| validity | 未过期 | 过期拒绝 |

具体 SDK 字段名称以锁定版本的类型定义为准；内部系统统一映射到 Normalized Payment Requirement，避免 SDK 字段变化扩散到 Policy。

## 完整协议步骤

1. Paid Resource Client 根据 `resource_id` 解析固定 endpoint。
2. Client 发送首次无支付请求。
3. Paid API 检查不到有效 payment payload。
4. Paid API 返回 HTTP 402 和 `PAYMENT-REQUIRED`。
5. x402 Client Adapter 解码 Base64 JSON。
6. Adapter 验证基础 Schema，并标准化 scheme、network、asset、amount、payee、resource 和 validity。
7. Purchase Request Service 将标准化报价与 Registry 比较。
8. 所有字段匹配后创建不可变 PurchaseRequest。
9. Agent 收到安全报价摘要，并提交 purchase intent。
10. Policy Engine 返回 `APPROVED`。
11. Payment Orchestrator 原子领取执行权。
12. Wallet Signer 重新验证 approval 和 PurchaseRequest。
13. x402 SVM Client 基于批准内容创建 exact payment payload。
14. Wallet Signer 对 payload 所需内容签名。
15. Client 使用完全相同的业务输入重试原 API，并附加 `PAYMENT-SIGNATURE`。
16. Paid API 将 Payment Payload 与原 Payment Details 交给 Facilitator `/verify`。
17. Facilitator 验证签名、金额、network、asset、payee 和有效期。
18. 验证成功后，Paid API 准备符合 Output Schema 的市场数据。
19. Paid API 或 x402 middleware 请求 Facilitator `/settle`。
20. Facilitator 将已签名交易提交到 Solana Devnet。
21. Facilitator 等待链上确认。
22. Facilitator 返回 Settlement Response 和 transaction signature。
23. Paid API 返回 HTTP 200、`PAYMENT-RESPONSE` 和 JSON body。
24. Client 验证 Settlement Response 与 PurchaseRequest 一致。
25. Payment 标记为 `CONFIRMED`，Tool Result 进入验证阶段。

Facilitator 的标准职责是验证、提交链上结算并等待确认，而不是持有买方私钥或制定预算：[x402 Facilitator](https://docs.x402.org/core-concepts/facilitator)。

## 各模块边界

### Agent Runtime

负责：

- 选择 Resource。
- 发起首次 Tool 调用。
- 收到安全化的 402 摘要。
- 请求购买 PurchaseRequest。
- 使用最终 Tool Result。

不负责：

- 解码原始支付 header。
- 决定付款是否合法。
- 创建签名或 transaction。

### x402 Client Adapter

负责：

- 处理 x402 header。
- 把 SDK 对象转换为内部标准模型。
- 创建 payment payload。
- 携带签名重试原请求。
- 解析 settlement response。

不负责：

- 批准预算。
- 保存 Private Key。
- 选择未知 Resource 或 payee。

### Wallet Signer

负责：

- 对已批准的 payload 签名。

不负责：

- HTTP 请求。
- 402 解析。
- Facilitator 调用。

### Paid API

负责：

- 声明 Payment Requirements。
- 检查付费请求。
- 使用 Facilitator 验证和结算。
- 结算成功后返回资源。

不负责：

- Agent Policy。
- 买方 Wallet。

### Facilitator

负责：

- `/verify`。
- `/settle`。
- 提交交易并等待确认。

不负责：

- 持有 Buyer Private Key。
- 判断购买是否符合用户预算。

## 价格与报价边界

- Registry price 是应用预期值。
- HTTP 402 amount 是当前请求的协议报价。
- PurchaseRequest 保存二者验证后的固定结果。
- Policy 只读取 PurchaseRequest，不信任 Agent 转述。
- 二者不一致时，V0 直接 `REJECTED`。
- V0 不做协商、动态价格或多个 payment option 选择。

## 重试与幂等性

- Request #2 必须使用与 Request #1 相同的 resource 和规范化 input。
- PurchaseRequest 与 `input_hash` 绑定。
- 同一 purchase 只能有一个活动 Payment。
- HTTP timeout 发生在可能提交以后时进入 `UNKNOWN`。
- `UNKNOWN` 时只查询原 settlement，不生成新 payload。
- Payment 已确认但 JSON response 丢失时，使用同一 payment identifier 幂等重取资源。
- Paid API 必须防止一笔 transaction 被用于多个 resource fulfillment。

x402 SVM helper 包含短期 SettlementCache，用于阻止 Solana 上的重复 settlement 竞态；V0 仍需 SQLite 做跨流程的持久幂等性：[x402 Solana duplicate settlement](https://docs.x402.org/core-concepts/facilitator)。

## 成功条件

x402 调用只有同时满足以下条件才算成功：

- Response status 为 200。
- `PAYMENT-RESPONSE` 可以解析。
- Settlement status 表示成功。
- Transaction signature 存在。
- Network、payer、payee、asset 和 amount 与 PurchaseRequest 一致。
- JSON body 通过 Paid API Output Schema。

只有 payment 成功但 JSON 无效，不算 Tool 调用成功。

## 失败结果

| Failure | Internal Result | May Auto-Pay Again? |
|---|---|---:|
| 402 malformed | Purchase rejected | 否 |
| Quote mismatch | Policy rejected | 否 |
| Signature creation failed before submission | Payment failed | 只能重试同一 Payment |
| Facilitator verification failed | Payment rejected | 否，先修正原因 |
| Request timeout after possible submission | Payment unknown | 否 |
| Settlement failed with confirmed no-transfer | Payment failed | 可人工决定是否重试同一 purchase |
| Settlement confirmed but JSON missing | Tool failed / payment confirmed | 否；只幂等重取数据 |
| JSON Schema invalid | Tool failed / payment confirmed | 否 |

## V0 不做

- 不实现 `upto` scheme。
- 不实现 batch settlement。
- 不支持多个网络或多个 Token。
- 不支持多个 Facilitator 自动竞价。
- 不实现 x402 Bazaar discovery。
- 不把 transaction ID 当作长期 API key。
- 不自建 Facilitator，除非官方测试 Facilitator 成为阻断项。

## D1-12 验收标准

- 三个 x402 V2 header 的方向和职责明确。
- 协议固定为两次 HTTP 请求。
- Registry、402、PurchaseRequest 和 Policy 的价格职责没有混淆。
- Agent、Wallet、x402 Client、Paid API、Facilitator 和 Solana 的职责分离。
- 支付成功需要 settlement 和链上确认，不能只看 signature。
- 重试流程不会产生重复支付。
- V0 只支持 Solana Devnet、测试 USDC 和 exact scheme。

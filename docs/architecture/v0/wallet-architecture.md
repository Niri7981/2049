# D1-11 Wallet Architecture

## 目标

让系统能够在用户预先设定的 Spending Policy 范围内自动付款，同时确保 LLM 永远无法读取或直接使用 Private Key。

V0 不连接用户个人钱包，不使用 Mainnet，也不实现生产级托管。

## V0 决策

V0 使用一个后端托管的 Dedicated Demo Buyer Wallet：

- 专门用于本项目。
- 只连接 Solana Devnet。
- 只存放少量 Devnet SOL 和测试 USDC。
- 由 Wallet Signer 模块读取运行时 secret 并完成签名。
- Agent 只能看到 public address、余额摘要和支付结果。

Paid API 使用另一个独立的 Demo Merchant Wallet 收款。

## 为什么选择这个方案

| Option | Autonomous Payment | Safety | 7-Day Complexity | Decision |
|---|---:|---:|---:|---|
| 用户自己的 Wallet | 差，每次通常需要用户确认 | 用户自托管最好 | 中 | 不符合小额自动支付体验 |
| Dedicated Agent Wallet | 好 | 资产隔离 | 低中 | 采用其隔离原则 |
| Custodial Demo Wallet | 好 | 测试资产下风险可控 | 最低 | V0 实际实现方式 |
| Delegated / Scoped Wallet | 好 | 更适合生产 | 高 | V1 再考虑 |

V0 实际上是“后端托管的 Dedicated Demo Wallet”：既隔离资产，又避免浏览器 Wallet 弹窗阻断自动付款。

## 固定链上参数

| Item | V0 Value |
|---|---|
| Cluster | Solana Devnet |
| CAIP-2 network | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Asset | Circle Solana Devnet 测试 USDC |
| Mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Decimals | 6 |
| Demo amount | 10,000 最小单位，即 0.01 USDC |
| Payment scheme | x402 `exact` |
| Buyer | Dedicated Demo Buyer Wallet |
| Recipient | Dedicated Demo Merchant Wallet |
| Primary fee payer | 由实际 x402 SVM / Facilitator 流程决定并在交易摘要中验证 |
| Confirmation requirement | 不把“拿到 signature”当成功；必须得到确认的 settlement result |

Circle 官方文档列出的 Solana Devnet USDC mint 和精度见：[Circle Solana Devnet USDC](https://developers.circle.com/stablecoins/quickstart-transfer-10-usdc-on-solana)。

## 两个 Wallet 的职责

### Demo Buyer Wallet

负责：

- 持有少量测试 USDC。
- 对已经通过 Policy 的 x402 payment payload 签名。
- 作为付款方出现在链上交易中。

不能：

- 被用户 Prompt 直接调用。
- 接受 Agent 提供的 amount、mint、network 或 payee。
- 使用 Mainnet RPC。
- 存放真实资产。

### Demo Merchant Wallet

负责：

- 作为 Paid API 的固定收款地址。
- 接收测试 USDC。
- 用于 Registry 与 HTTP 402 的 payee 一致性检查。

Merchant Wallet 不需要向 Agent 暴露任何 secret。Paid API 只需要它的 public address。

## Private Key 存放

V0 的 Buyer Private Key 只存在于服务端运行时 secret：

- 本地开发时通过进程环境注入。
- 不创建或提交明文 keypair 文件。
- 不写入 SQLite。
- 不写入 Resource Registry。
- 不进入 Browser bundle。
- 不进入 Agent Context。
- 不进入错误堆栈或 Execution Trace。
- 不复制到 README、截图或 Demo Video。

项目只记录 Buyer public address 和 Merchant public address。

## 访问矩阵

| Component | Buyer Public Address | Buyer Balance | Buyer Private Key | Sign Operation |
|---|---:|---:|---:|---:|
| Web UI | 是，缩略显示 | 是，安全摘要 | 否 | 否 |
| Agent Runtime | 可选 | 可选摘要 | 否 | 否 |
| Policy Engine | 是 | 只读预算信息 | 否 | 否 |
| Payment Orchestrator | 是 | 是 | 否 | 只能请求签名 |
| Wallet Signer | 是 | 是 | 是 | 是 |
| x402 Client Adapter | 是 | 否 | 否 | 接收签名后的 payload |
| Paid API | 是 | 否 | 否 | 否 |
| Execution Trace | 缩略值 | 可展示 | 否 | 否 |

## 自动付款的授权含义

用户在启动 Demo 前配置 Spending Policy，相当于明确提供一项 standing approval：

> 对固定 Resource、固定 Merchant、固定 Devnet 测试 USDC，单笔不超过 0.10 USDC 且每日累计不超过 1.00 USDC 时，允许系统无需逐笔点击自动付款。

这不是让 LLM 自由花钱。每一笔仍需要：

1. 真实 HTTP 402。
2. 不可变 PurchaseRequest。
3. Policy 的确定性 `APPROVED`。
4. Wallet Signer 的二次字段核对。

## Wallet Signer 输入合同

Wallet Signer 只接受内部 `approval_id`，不接受自由组合的付款参数。

签名前必须重新读取并核对：

- PurchaseRequest status 为合法的付款中状态。
- PolicyDecision 为 `APPROVED`。
- Approval 未过期。
- Quote 未过期。
- Resource、amount、mint、network 和 payee 与批准记录完全一致。
- 当前没有其他活动或成功 Payment。
- Cluster 明确为 Devnet。

任何一项失败都不签名。

## Transaction 检查

签名前或提交前，系统必须能够形成安全的交易摘要：

| Field | Expected |
|---|---|
| Cluster | Devnet |
| Sender | Demo Buyer public address |
| Recipient | Registry 固定 Merchant address |
| Token mint | 固定 Devnet USDC mint |
| Amount | 10,000 最小单位 |
| Token program | 与目标 mint 实际 owner 匹配的受支持 Token Program |
| Fee payer | x402 生成结果中明确可识别的 fee payer |
| Recent blockhash / validity | 未过期 |

如果 x402 SDK 允许在提交前模拟完整交易，则执行模拟并检查结果。若 Facilitator 负责最终构建或提交，则把 Facilitator verification 作为协议级预检，同时仍以链上确认作为最终事实。

## ATA 与余额准备

Demo 前必须验证：

- Buyer 的测试 USDC Associated Token Account 存在。
- Merchant 的测试 USDC Associated Token Account 存在，或 x402 流程能够安全创建。
- Buyer 至少持有可完成 10 次 Demo 的测试 USDC。
- 如果 Buyer 或 Merchant 需要承担创建 ATA 或网络费用，则对应账户持有少量 Devnet SOL。
- Mint、token account owner 和 decimals 均与预期一致。

## 支付成功的定义

以下情况不算支付成功：

- 只生成了签名。
- 只获得 transaction signature。
- RPC 返回已收到请求但尚未确认。
- Client-side callback 声称成功。

V0 只有在 Facilitator settlement 成功且可以通过 Solana RPC 查询到确认交易时，才将 Payment 标记为 `CONFIRMED`。

## 支付未知状态

如果请求可能已经提交但响应超时：

1. Payment 进入 `UNKNOWN`。
2. 冻结对应 PurchaseRequest。
3. 禁止创建第二笔 Payment。
4. 使用原 transaction signature、payment identifier 或 Facilitator 状态查询。
5. 查询到确认后转为 `CONFIRMED`。
6. 明确查询不到并确认未结算后才转为 `FAILED`。

Solana `getTransaction` 在指定 commitment 下找不到已确认交易时会返回 null，因此查询必须考虑传播和确认延迟，不能因为一次 null 就立即重付。参考：[Solana getTransaction](https://solana.com/docs/rpc/http/gettransaction)。

## 资产损失上限

V0 的 blast radius 由三层限制：

1. Wallet 只存少量无真实价值的 Devnet 资产。
2. Policy 限制单笔 0.10、每日 1.00 测试 USDC。
3. Resource、mint、network 和 payee 全部固定 allowlist。

测试完成后可以废弃 Buyer Wallet，并用新 Wallet 进行正式演示。

## V0 不做

- 不实现用户 Wallet Connect。
- 不使用 Mainnet。
- 不实现 MPC、HSM 或 KMS。
- 不实现链上 delegate allowance。
- 不编写自定义 Solana Program。
- 不实现批量支付、订阅或退款。
- 不把 Private Key 交给外部 LLM 工具。

## D1-11 验收标准

- Buyer 与 Merchant Wallet 角色明确分离。
- Private Key 只存在于 Wallet Signer 的服务端 secret 边界。
- Agent、UI、Policy、Paid API 和 Trace 均无法读取 Private Key。
- 自动付款被定义为 Policy 范围内的预先授权，而不是 LLM 自由支出。
- Cluster、mint、decimals、amount、recipient 和确认语义均已固定。
- Signature 不等于成功，必须等待 settlement 和链上确认。
- `UNKNOWN` 状态绝不自动重付。
- Wallet 不持有真实资产，Mainnet 明确禁止。

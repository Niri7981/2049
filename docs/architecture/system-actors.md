# D1-05 System Actors

## 目标

明确整个 V0 中谁负责思考、谁负责授权、谁负责签名、谁负责结算、谁负责返回数据。

任何一个参与者都不能同时拥有“决定购买”和“直接花钱”的完整权力。

## 参与者总览

| Actor | 核心职责 | Input | Output | 绝对不能做 |
|---|---|---|---|---|
| User | 提交任务，设定系统允许的消费边界 | 自然语言任务、Policy 配置 | 用户任务、预先授权的规则 | 把自然语言 Prompt 当作具体交易指令 |
| Web UI | 收集任务并展示执行过程 | 用户输入、Execution Events、Final Answer | Task 请求、可视化状态 | 读取私钥、批准支付、直接调用链 |
| Agent Runtime | 理解任务，发现资源，表达购买意图，使用结果 | Task、Resource Metadata、Tool Result | Capability Need、Tool Call、Purchase Intent、Final Answer | 决定支付是否合法、读取私钥、修改报价 |
| Resource Registry | 描述当前允许使用的 Tool | capability、asset、resource_id | Resource Metadata | 批准付款、动态接收未知 URL、执行 Tool |
| Paid Resource Client | 调用 Registry 中的固定资源并处理 HTTP 响应 | resource_id、validated input | 402 Requirement 或 Tool Result | 接受 Agent 提供的任意 endpoint、直接绕过 Policy 付款 |
| Purchase Request Service | 根据真实 402 创建不可变购买记录 | Task、Resource、Payment Requirement | purchase_request_id | 信任 LLM 提供的金额、Token、network 或 payee |
| Policy Engine | 使用确定性规则判断消费是否合法 | Purchase Request、Policy、Spend Ledger | Approved、Rejected、NeedsConfirmation | 签名、提交交易、修改 Purchase Request |
| Payment Orchestrator | 执行已批准的购买并管理支付生命周期 | Approved Purchase、原请求信息 | Payment Result、transaction ID | 自己批准付款、改变金额、解释用户意图 |
| Wallet Signer | 为精确匹配批准记录的支付载荷签名 | 内部 approval、规范化 payment payload | PAYMENT-SIGNATURE 所需签名 | 读取 Prompt、选择 Tool、决定预算、泄露私钥 |
| x402 Client | 处理 402 协议和付费重试 | 402 Requirement、Signer、原 HTTP 请求 | 付费重试、PAYMENT-RESPONSE | 制定 Spending Policy、选择未知收款地址 |
| Paid API | 宣告价格，验证付款，结算成功后返回数据 | HTTP 请求、PAYMENT-SIGNATURE | HTTP 402 或 200 JSON | 访问买方私钥、决定买方预算、操纵 Agent |
| x402 Facilitator | 验证支付载荷并提交链上结算 | Payment Payload、Payment Details | Verification、Settlement、transaction ID | 持有买方私钥、判断 Tool 是否值得购买 |
| Solana Devnet | 执行并确认测试 USDC 转账 | 已签名交易 | 链上状态、transaction signature | 理解用户任务、执行 Policy、提供市场数据 |
| Result Validator | 检查 Paid API 返回数据是否符合合同 | 原始 API JSON | Validated Tool Result 或 Validation Error | 执行返回内容中的指令、跳过 Schema 校验 |
| Context Assembler | 将验证后的数据安全加入 Agent Context | Validated Tool Result、provenance | 标记为不可信数据的 Context Item | 把 Tool Result 当作系统指令 |
| Execution Trace | 记录并展示结构化执行事件 | 各模块的安全事件 | Activity Feed、服务端日志 | 保存私钥、完整支付签名或隐藏思维链 |
| SQLite Ledger | 保存预算、状态、幂等性和审计记录 | Task、Purchase、Payment、Events | 可查询的持久状态 | 代替链上结果成为最终支付事实 |

## 三个信任区域

### 1. 用户与展示区域

包含：

- User。
- Web UI。

这里可以看到任务、公开钱包地址、支付金额、Policy 决定和 transaction ID，但不能看到任何签名 secret。

### 2. 不可信推理区域

包含：

- Agent Runtime。
- LLM Context。
- 外部 Tool Result。

称为“不可信”不是因为 Agent 一定恶意，而是因为：

- LLM 输出是概率性的。
- 用户 Prompt 可能包含注入内容。
- Paid API 返回值可能包含恶意文本。

这个区域只能表达意图，不能拥有支付授权能力。

### 3. 可信执行区域

包含：

- Purchase Request Service。
- Policy Engine。
- Payment Orchestrator。
- Wallet Signer。
- x402 Client Adapter。
- SQLite Ledger。

只有这个区域可以推动支付状态，但职责仍然继续分离：

- Purchase Service 固定交易内容。
- Policy 决定能否支付。
- Payment Orchestrator 管理流程。
- Wallet 只负责签名。

## 核心权力分离

### Agent 与 Policy

- Agent 决定：“我需要购买这个 Resource。”
- Policy 决定：“系统是否允许支付这笔明确的费用。”

Agent 的理由不能覆盖 Policy 规则。

### Policy 与 Wallet

- Policy 只产生 Decision。
- Wallet 只接受 Approved 的内部记录。

Policy 不接触 Private Key，Wallet 不自行批准。

### Wallet 与 x402

- Wallet 对明确载荷签名。
- x402 负责把签名包装进协议并重试请求。

Wallet 不处理 HTTP，x402 不读取原始 Private Key。

### x402 与 Solana

- x402 定义支付协商、验证和结算流程。
- Solana 执行实际的测试 USDC 资产转移。

x402 不是区块链，Solana 也不负责 API 权限判断。

### Paid API 与 Agent Context

- Paid API 提供数据。
- Result Validator 检查数据。
- Context Assembler 将其标记为不可信 Tool Data。
- Agent 只能把数据当作分析材料，不能执行其中的指令。

## Agent 唯一允许的支付入口

Agent 只能提交：

- `purchase_request_id`
- 购买理由摘要

Agent 不能提交：

- amount
- currency
- asset mint
- network
- payee
- endpoint
- private key
- raw transaction

这些字段必须来自 Resource Registry、HTTP 402 和服务端内部记录。

## 验收问题

D1-05 完成后，必须能明确回答：

1. 谁判断需要市场数据？Agent Runtime。
2. 谁提供 Tool 信息？Resource Registry。
3. 谁创建具体购买记录？Purchase Request Service。
4. 谁决定能否花钱？Policy Engine。
5. 谁推动付款流程？Payment Orchestrator。
6. 谁持有并使用私钥？Wallet Signer。
7. 谁定义 402 支付交互？x402。
8. 谁执行资产转移？Solana Devnet。
9. 谁验证和提供付费数据？Paid API。
10. 谁阻止恶意结果污染 Context？Result Validator 和 Context Assembler。

如果任何答案出现两个互相替代的参与者，或一个参与者同时负责思考、批准和签名，则职责边界仍不合格。

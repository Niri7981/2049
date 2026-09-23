# BOUND

> Give your agent a card, not your wallet.

[中文](#中文) · [English](#english)

BOUND（仓库代号：2049）是构建在 [x402](https://www.x402.org/) 之上的本地 Agent 消费控制层。Agent 只能请求购买；钱包、私钥、额度、授权、付款状态与恢复逻辑都由用户电脑上的 BOUND 后端掌控。

```text
Agent → Purchase Request → BOUND Card → Policy / Budget / Authority
                                      ├─ APPROVED → x402 → Solana → Resource
                                      └─ DENIED   → no signer → $0 spent
```

---

## 中文

### BOUND 是什么

BOUND 为 AI Agent 提供一张可编程消费卡，而不是钱包访问权。用户可以限定总额度、单笔上限、Provider、Operation、网络、资产、收款方和有效期。Agent 无法读取私钥，也不能自行指定金额、收款方、资产、网络、URL、付款载荷、交易或批准状态。

BOUND 负责：

- 本地钱包和 macOS 钥匙串签名器
- SpendGrant 生命周期、共享额度、暂停和撤销
- 原子预算预占、幂等请求和购买账本
- 付款前授权复核、异常状态和原付款恢复
- 安全的购买记录和审计信息

x402 负责：

- HTTP 402 协商与 `PaymentRequirements`
- 付款载荷构造和支付方案
- Facilitator verify / settle
- Solana 付款机制

### 当前状态

目前已经完成 BOUND STEP 1：把持久化的 `APPROVED` 请求桥接到现有真实付款流水线。

- Codex MCP 提供 `get_spending_status`、`get_market_quote` 和 `request_purchase`。
- `request_purchase` 只接受 `requestId`、后端定义的 `offerId` 和用途摘要。
- basic offer 的真实 x402 报价为 0.20 test USDC；策略批准后复用同一持久报价进入 claim、官方 x402 client、本地 signer、Facilitator、Solana 确认、恢复和资源交付路径。
- premium offer 的真实 x402 报价为 20 test USDC；它必须到达 BOUND 策略并被拒绝，保持 `paymentStatus: NOT_STARTED`，不会加载 signer。
- 同一请求重试只查询或恢复原购买；`PAYING`、`PAYMENT_UNKNOWN` 和已付款待交付状态不会创建替代付款。
- 本地账本持久保存一个默认 Codex CardMember；MCP 连接和凭据可以轮换，但同一成员仍拥有原购买与已交付资源。
- 付款执行默认关闭。只有显式设置 `APP2049_ENABLE_DEVNET_PURCHASES=1` 才允许已批准请求进入 Devnet 付款路径。

STEP 1 已通过模拟外部依赖的自动化测试；本轮没有执行新的真实 0.20 Devnet 付款。仓库此前已经完成独立的 0.01 test USDC Devnet 真实交易验收。执行模式隔离、统一 Purchase View、卡片式 UI、多真实 Agent/CardMember 和最终 0.20 实付演示属于后续步骤。

### 安全边界

- 金额以资产最小单位整数保存和比较。
- 报价在策略决策时持久化；执行不会重新报价。
- execution binding 覆盖买方、HTTP 方法、完整 endpoint、网络、资产、收款方和完整付款要求。
- claim、加载 signer 前、SDK 实际签名前、保存 payload 以及首次提交前都会重新检查授权、暂停、到期、共享额度、Grant 范围、报价指纹和执行绑定。
- `DENIED` 只读取账本中的持久事实，不进入 preflight、claim、payload、verify 或 settle。
- 提交超时进入 `PAYMENT_UNKNOWN`；恢复只使用原 payload，绝不重新签名或重新扣款。
- App 与 MCP 使用同一后端业务入口；MCP 不提供额度管理、密钥导出或通用签名能力。

### 本地运行

要求 macOS 和 Node.js 24.5 或更高版本。

```bash
npm ci
npm run app:dev
```

App 使用 `127.0.0.1:3049` 本地服务。关闭窗口后服务继续在菜单栏运行；退出 App 时停止服务。首次启动会创建产品专用钱包，私钥只保存在 macOS 钥匙串中。

在 App 中：

1. 设置每日共享额度。
2. 启用 Agent 连接。
3. 创建包含总额、单笔上限和到期时间的 SpendGrant。
4. 让 Codex 通过 MCP 调用 `request_purchase`。

MCP 本机连接方式见 [MCP 接入说明](docs/architecture/mcp-integration.md)。产品范围、阶段和真实验收状态以 [plan.md](plan.md) 为准。

### 开发与验证

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

历史网页 Demo、本地链、独立 Devnet 付款入口及旧 0.01 路径仍作为测试设施保留。相关运行手册位于 [docs/demo](docs/demo)，架构文档入口位于 [docs/README.md](docs/README.md)。

### 当前限制

- 只接入 Codex；尚未接入多个真实 Agent host。
- 只支持 Solana Devnet 上的测试 USDC 产品路径。
- Codex 宿主中的可验证逐笔原对话确认尚未完成。
- STEP 2–7 尚未实施，包括执行模式迁移、Purchase View、卡片式 UI、多真实 Agent/CardMember 和最终真实 0.20 演示。
- 自建 Paid API 和市场快照是明确标注的测试设施，不是生产市场数据服务。

---

## English

### What is BOUND?

BOUND gives an AI agent a programmable spending card instead of wallet access. A user can restrict the total budget, per-purchase amount, provider, operation, network, asset, payee, and expiry. The agent never receives a private key and cannot choose the amount, payee, asset, network, URL, payment payload, transaction, or approval state.

BOUND owns:

- The local wallet and macOS Keychain signer
- SpendGrant lifecycle, shared budgets, pause, and revocation
- Atomic reservations, idempotent requests, and the purchase ledger
- Authority checks before payment, uncertain states, and original-payment recovery
- Safe purchase history and audit data

x402 owns:

- HTTP 402 negotiation and `PaymentRequirements`
- Payment payload construction and payment schemes
- Facilitator verification and settlement
- Solana payment mechanics

### Current status

BOUND STEP 1 is complete: persisted `APPROVED` requests are now connected to the existing real payment pipeline.

- The Codex MCP server exposes `get_spending_status`, `get_market_quote`, and `request_purchase`.
- `request_purchase` accepts only a `requestId`, a server-defined `offerId`, and a short reason.
- The basic offer receives a real x402 quote for 0.20 test USDC. After policy approval, that same persisted quote flows through the existing claim, official x402 client, local signer, Facilitator, Solana confirmation, recovery, and resource-delivery path.
- The premium offer receives a real x402 quote for 20 test USDC. It reaches BOUND policy and is denied with `paymentStatus: NOT_STARTED`; the signer is never loaded.
- Retrying the same request only queries or recovers the original purchase. `PAYING`, `PAYMENT_UNKNOWN`, and paid-but-undelivered records never create a replacement payment.
- The local ledger persists one default Codex CardMember. MCP connections and credentials may rotate while that member keeps ownership of its purchases and delivered resources.
- Payment execution is disabled by default. Approved requests can enter the Devnet payment path only when `APP2049_ENABLE_DEVNET_PURCHASES=1` is explicitly set.

STEP 1 is verified with automated tests and mocked external payment dependencies; no new real 0.20 Devnet payment was made in this step. The repository contains earlier evidence for an independent real 0.01 test USDC Devnet transaction. Execution-mode isolation, a unified Purchase View, card-style UI, multiple real Agent/CardMember support, and the final real 0.20 demo remain future steps.

### Security boundaries

- Amounts are stored and compared as integers in the asset's smallest unit.
- The quote is persisted during policy evaluation and is never re-quoted for execution.
- The execution binding covers the buyer, HTTP method, complete endpoint, network, asset, payee, and full payment requirements.
- Authority, pause state, expiry, shared budget, Grant scope, quote fingerprint, and execution binding are rechecked during claim, before loading the signer, at the SDK signing boundary, before saving the payload, and before the first submission.
- A `DENIED` request returns from persisted ledger facts without entering preflight, claim, payload creation, verification, or settlement.
- A submission timeout becomes `PAYMENT_UNKNOWN`. Recovery reuses the original payload and never re-signs or creates a replacement charge.
- The App and MCP use the same backend service. MCP cannot manage limits, export keys, or request arbitrary signatures.

### Run locally

Requires macOS and Node.js 24.5 or newer.

```bash
npm ci
npm run app:dev
```

The App runs a local service on `127.0.0.1:3049`. Closing the window keeps it available from the menu bar; quitting the App stops the service. The first launch creates a dedicated product wallet whose private key remains in macOS Keychain.

In the App:

1. Set a shared daily limit.
2. Enable the Agent connection.
3. Create a SpendGrant with a total limit, per-purchase limit, and expiry.
4. Ask Codex to call `request_purchase` through MCP.

See [MCP integration](docs/architecture/mcp-integration.md) for local connection details. [plan.md](plan.md) is authoritative for product scope, milestones, and real acceptance evidence.

### Development and verification

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

The historical web demo, local validator flow, standalone Devnet payment entry point, and legacy 0.01 path remain as test facilities. Their runbooks are under [docs/demo](docs/demo), with the architecture index at [docs/README.md](docs/README.md).

### Current limitations

- Codex is the only integrated Agent host; multiple real Agent hosts are not connected yet.
- The product path currently supports test USDC on Solana Devnet only.
- Verifiable per-purchase confirmation inside the original Codex conversation is not complete.
- STEP 2–7 are not implemented yet, including execution-mode migration, Purchase View, card-style UI, multiple real Agent/CardMember support, and the final real 0.20 demo.
- The self-hosted Paid API and market snapshot are explicitly labeled test facilities, not a production market-data service.

## Documentation

- [Implementation plan / 实施计划](plan.md)
- [MCP integration / MCP 接入](docs/architecture/mcp-integration.md)
- [Architecture index / 架构索引](docs/README.md)
- [Development rules / 开发规范](AGENTS.md)

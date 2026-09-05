# Architecture Overview

## V0 目标

证明一个 AI Agent 能在不接触 Private Key 的前提下，自主发现并购买一次完成任务所需的付费 API 调用，然后使用返回数据完成原始任务。

## 总体架构

```text
┌──────────────────────────── Browser ────────────────────────────┐
│ Task Input          Activity Feed          Final Analysis       │
└──────────────────────────────┬───────────────────────────────────┘
                               │ Task API / SSE
┌──────────────────────────────▼───────────────────────────────────┐
│                    Next.js Node Application                     │
│                                                                  │
│  ┌──────────── Untrusted Reasoning Zone ──────────────────────┐  │
│  │ Agent Runtime                                               │  │
│  │ Task → Capability Plan → Discovery → Purchase Intent       │  │
│  │                                                             │  │
│  │ Agent can call:                                             │  │
│  │ - discover_resources                                       │  │
│  │ - invoke_resource                                          │  │
│  │ - request_purchase(purchase_request_id)                    │  │
│  │                                                             │  │
│  │ No shell / No raw HTTP / No wallet / No private key        │  │
│  └───────────────┬───────────────────────────▲─────────────────┘  │
│                  │                           │ validated data      │
│       ┌──────────▼──────────┐     ┌──────────┴───────────────┐   │
│       │ Static Resource     │     │ Result Validator &       │   │
│       │ Registry            │     │ Context Assembler        │   │
│       └──────────┬──────────┘     └──────────▲───────────────┘   │
│                  │                           │                    │
│  ┌───────────────▼──── Trusted Execution Zone ────────────────┐  │
│  │ Paid Resource Client                                       │  │
│  │        │                                                    │  │
│  │        ▼                                                    │  │
│  │ Purchase Request Service ← HTTP 402                         │  │
│  │        │                                                    │  │
│  │        ▼                                                    │  │
│  │ Policy Engine ── Approved ──► Payment Orchestrator          │  │
│  │                                     │                       │  │
│  │                                     ▼                       │  │
│  │                               Wallet Signer                 │  │
│  │                                     │                       │  │
│  │                               x402 Client Adapter           │  │
│  └─────────────────────────────────────┼───────────────────────┘  │
│                                        │ PAYMENT-SIGNATURE        │
│  ┌─────────────────────────────────────▼───────────────────────┐  │
│  │ Paid SOL Market API                                        │  │
│  │ No payment → 402                                           │  │
│  │ Valid settlement → 200 + JSON                              │  │
│  └──────────────────────────────┬──────────────────────────────┘  │
│                                 │                                 │
│  ┌──────────────────────────────▼──────────────────────────────┐  │
│  │ SQLite Ledger + Execution Events                           │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────┬──────────────────────────────────┘
                                │ verify / settle
                       ┌────────▼─────────┐
                       │ x402 Facilitator │
                       └────────┬─────────┘
                                │ signed transaction
                       ┌────────▼─────────┐
                       │ Solana Devnet    │
                       │ Test USDC        │
                       └──────────────────┘
```

## 模块映射

| Folder | Module Responsibility |
|---|---|
| `src/app` | UI、Task API、SSE 和应用入口 |
| `src/modules/agent` | Agent Runtime、Capability Plan、Context 使用 |
| `src/modules/resources` | Static Registry 和 Resource Discovery |
| `src/modules/policy` | Spending Policy 决策 |
| `src/modules/payments` | 支付生命周期和幂等编排 |
| `src/modules/wallet` | 服务端 Private Key 和签名边界 |
| `src/modules/x402` | x402 header、payload、重试和 settlement adapter |
| `src/modules/paid-market-api` | 402-gated SOL Market Snapshot API |
| `src/modules/execution-trace` | 结构化事件、Activity Feed 和 Console sink |
| `src/shared/schemas` | 运行时输入输出验证 |
| `src/shared/types` | 跨模块稳定类型 |
| `src/data/market-snapshots` | 演示前刷新的缓存数据 |
| `src/db` | SQLite Ledger 和审计记录 |

## 核心控制流

```text
User Task
→ Agent Capability Plan
→ Static Resource Discovery
→ First Paid API Request
→ HTTP 402
→ Immutable PurchaseRequest
→ Agent Purchase Intent
→ Policy APPROVED
→ Wallet Signature
→ x402 Paid Retry
→ Facilitator Settlement
→ Solana Confirmation
→ Paid JSON
→ Result Validation
→ Agent Context
→ Final Answer
```

## 核心数据流

| Data | Produced By | Consumed By | Trust Level |
|---|---|---|---|
| User Task | User | Agent Runtime | Untrusted input |
| Capability Plan | Agent Runtime | Resource Registry | Schema validated |
| Resource Metadata | Static Registry | Agent、Purchase Service | Trusted local config |
| Payment Requirement | Paid API / x402 | Purchase Service | Untrusted until validated |
| PurchaseRequest | Purchase Service | Policy、Payment、Wallet | Trusted immutable record |
| PolicyDecision | Policy Engine | Payment Orchestrator | Trusted authorization |
| Signed Payment Payload | Wallet Signer | x402 Client | Sensitive transient data |
| Settlement Response | Facilitator / Paid API | Payment Orchestrator | Validate against purchase |
| Market Snapshot | Paid API | Result Validator | Untrusted external data |
| Validated Tool Result | Result Validator | Context Assembler | Safe data, not instructions |
| ExecutionEvent | Each module | SQLite、UI、Console | Redacted safe telemetry |

## 四个权威来源

| Question | Authority |
|---|---|
| 系统允许使用哪个 Tool？ | Static Resource Registry |
| 当前请求实际报价是什么？ | HTTP 402 Payment Requirement |
| 这笔支出是否允许？ | Spending Policy Decision |
| 资金是否真正转移？ | Facilitator settlement + Solana confirmed transaction |

LLM 不是以上任何一项的权威来源。

## V0 部署形态

- 一个 Next.js Node 应用。
- Paid API 作为独立模块和 HTTP Route 存在。
- 一个 SQLite 文件。
- 一个后端 Demo Buyer Wallet。
- 一个 Merchant public address。
- 一个外部 x402 Facilitator。
- 一个或两个 Solana Devnet RPC endpoint。

这是模块化单体，不是微服务。未来可以抽离 Paid API、Signer 或 Registry，但 V0 不提前拆分。

## 成功定义

只有以下全部成立才算完整：

- Agent 自己识别外部能力需求。
- Agent 发现付费 Resource。
- Paid API 返回真实 402。
- Policy 自动批准 0.01 测试 USDC。
- Agent 无法读取 Private Key。
- Solana Devnet transaction 确认。
- Paid API 返回结构化 JSON。
- JSON 经过验证并加入 Context。
- 最终回答明确使用购买到的数据。
- Execution Trace 能证明整个过程。

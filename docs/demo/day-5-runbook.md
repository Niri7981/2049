# Day 5：受规则约束的自动购买

Day 4 证明脚本可以完成 x402 付款。Day 5 的核心是把任务发现接到消费规则、持久化购买账本和批准后的签名器上。

## 已实现

- 任务入口先判断是否需要 SOL 市场快照；其他币种、解释问题和直接转账指令不会购买。
- 服务端从固定 Registry 和真实 x402 402 报价创建购买请求。模型不能设置金额、mint、收款方或 URL。
- 确定性 Policy：单笔自动上限 0.10 USDC、上海自然日预算 1 USDC；固定 Devnet、Circle 测试 USDC、商家和 Resource。当前 API 价格固定 0.01，动态涨价被拒绝。
- Policy 对价格正确且超过单笔上限的请求返回 `NEEDS_CONFIRMATION`；当前固定价格 API 不会触发这一分支，边界已用测试验证。
- SQLite 原子保存不可变购买内容和决策，并预占预算；同一任务只能有一个购买，只有创建该记录的调用可以领取付款。
- 签名入口只接收内部 approval ID，再读账本核对绑定；继续使用 Day 4 的模拟、钥匙串签名、x402 Facilitator 和链上确认。
- 保存验证后的结果。相同任务 ID 与相同文本重跑返回原结果，不重新发现、签名或购买；复用 ID 但更改文本/钱包配置会报错。
- 超时及提交结果不明进入 `PAYMENT_UNKNOWN`，冻结新付款；进程在 `PAYING` 时退出也保持冻结。
- 购买决策、执行领取、付款完成或未知状态保存在本地审计事件表。

## 使用

使用现有 Day 4 专用钱包及 `.env.local`，无需新建钱包。先启动本机 API：

```bash
npm run day4:server
```

另一个终端：

```bash
npm run day5:agent -- my-sol-task-001 "根据价格、成交量和 RSI 分析 SOL 市场情况"
```

同一任务重试必须保留 ID 和任务文本；换一个 ID 表示新的任务，可能产生下一笔 0.01 USDC 付款。暂停、拒绝或未知状态的 CLI 返回非零退出码。

配置 `OPENAI_API_KEY` 时沿用 OpenAI Agents SDK 规划器（最多 3 turns，30 秒超时）；没有 Key 时输出明确的 `local_demo` 模式。最终摘要目前由已校验快照生成，尚未做模型生成长篇分析。

## 实际 Devnet 验收

2026-09-09，任务 `day5-devnet-001`，使用 `local_demo` 规划模式：

1. 发现 SOL Resource，收到真实 402。
2. Policy 返回 `APPROVED`，Day 5 账本剩余预算 0.99 USDC。
3. 专用钱包实际付款 0.01 Circle Devnet USDC，链上确认后记录 `PAID`。
4. 独立 RPC 检查余额：买方 0.99 → 0.98 USDC；商家 0.01 → 0.02 USDC。
5. CLI 重启并重跑原任务返回 `reused: true`、同一 TX 和缓存数据，没有再次扣款。

[查看 Day 5 Devnet 交易](https://explorer.solana.com/tx/2MbvQGGhR3sQjMocSUEiB7Ez4toaDfxgcRpyTv4a4VRMduQDLTUBtFvDmMgL4W8ERodcJ11152SHjm3H1gKZCS4c?cluster=devnet)。数据为明确标注的 Demo fixture，不是实时行情。

165 项测试通过，包括预算边界、报价更改、任务并发、双连接预算预占、数据库重开、未知付款、批准 ID 和收款凭证绑定。TypeScript、ESLint 和生产构建通过。

## 文件重点

| 文件 | 职责 |
|---|---|
| `src/modules/purchases/spending-policy.ts` | 购买 Schema、规范化报价指纹、上海日期、固定 allowlist 和金额规则；不读私钥、不请求网络。 |
| `src/modules/purchases/purchase-ledger.ts` | 购买与批准记录、原子预算预占、唯一任务、执行领取、结果缓存与审计事件。 |
| `src/modules/purchases/approved-payment.ts` | 内部批准 ID 到签名付款的边界；核对配置、持久化签名载荷、验证回执和结果。 |
| `src/modules/agent/day5-agent-runtime.ts` | 编排发现、报价、购买创建、Policy、付款、缓存结果及简短数据摘要。 |
| `scripts/day5-agent.ts` | 开发者命令入口，选择真实模型或明确标注的本地规划模式。 |
| `scripts/day4-run.mjs` | 新增 Day 5 入口，复用既有代理设置。 |
| `src/modules/agent/openai-capability-planner.ts` | 限制模型轮次和超时，模型不取得付款权限。 |
| `tests/unit/day5-policy-ledger.test.ts` | 规则边界、预占预算、唯一领取、持久化与崩溃保护。 |
| `tests/unit/day5-approved-payment.test.ts` | 无批准/绑定改变不读签名器，超时不重签，错误回执不记成功。 |
| `tests/integration/day5-agent-runtime.test.ts` | 发现到付款的受控依赖验收、并发一次购买、重跑缓存、不相关任务零付款。 |

## 范围和剩余事项

- 当前是本机 CLI；网页仍是 Day 2 Discovery，不会因为此改动自动开始付款。没有开放远程自动付款接口。
- 真实模型分支尚未在线验收：本机未配置 OpenAI API Key。Devnet 支付验收使用本地确定性规划器。
- 日预算只约束此 Day 5 账本管理的购买，不包含此前 Day 4 手工验收、其他程序或 Phantom 转账。不要把它当作整个钱包的链上限额。
- 预算计算包含当日已确认消费以及所有未完成的预占额度。未知状态全局冻结；这是对架构里只统计已确认支出的保守补充，防止并发和跨日未决付款突破预算。
- `APPROVED` 后进程退出时不会自动重启付款，预占仍保留；过期预占释放和人工批准 UI 尚未实现。
- 未知交易自动对账、付款成功但结果丢失后的自动恢复尚未实现；保留原载荷和可用交易 ID，人工核对，禁止删除账本重付。
- `.data/day5-ledger.sqlite` 含内部购买记录和签名载荷，不上传 Git，也不暴露给模型。开发工具和同一登录用户下的其他进程仍属于可信本机环境。

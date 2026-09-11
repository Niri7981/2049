# D1-15 Risks and Fallbacks

## 目标

提前确定哪些问题可能让七天 Demo 失败、如何尽早发现，以及出现问题时切到什么方案。

Fallback 的原则是缩小实现复杂度，但不能伪造自主购买闭环。

## 风险矩阵

| ID | Risk | Probability | Impact | Early Signal | Primary Mitigation | Fallback | Decision Deadline |
|---|---|---|---|---|---|---|---|
| R01 | x402 TypeScript SDK 接口变化 | 中 | 高 | 类型、示例或 header 与文档不一致 | Day 3 前锁定版本；隔离 x402 Adapter | 手动处理 V2 headers，但继续使用官方 SVM scheme | Day 3 中午 |
| R02 | 默认 Facilitator 不可用 | 中 | 高 | verify/settle 持续超时或返回不支持网络 | Day 3 检查 supported network；Day 4 早测 | 切换预先验证的 Solana x402 Facilitator | Day 4 中午 |
| R03 | Solana Devnet RPC 不稳定 | 中高 | 高 | 请求延迟、429、confirmation 丢失 | 准备两个 RPC；有界重试 | 切换备用 RPC；使用已录制视频保底展示 | Day 4 |
| R04 | Circle Faucet 领不到测试 USDC | 中 | 高 | Wallet 余额为零 | Day 1–2 提前领取并预充两个 Wallet | 使用已经预充的备用 Buyer Wallet | Day 2 结束 |
| R05 | Merchant ATA 不存在 | 中 | 中 | 交易模拟或 settlement 报 token account 错误 | Demo 前创建并验证 ATA | 更换为已准备 ATA 的 Merchant Wallet | Day 4 中午 |
| R06 | Fee payer 或 SOL 余额假设错误 | 中 | 中高 | 构建或提交时报 fee 错误 | 明确读取交易 fee payer；Buyer/Merchant 预留少量 Devnet SOL | 采用 Facilitator sponsor 或给实际 fee payer 补 Devnet SOL | Day 4 |
| R07 | Agent 不稳定地选择 Tool | 中 | 高 | 同一 Prompt 偶尔不发现 Resource | Structured Capability Plan、固定 vocabulary、唯一 Resource | 标准 Demo Prompt 走确定性 capability fallback | Day 2 结束 |
| R08 | Agent 重复请求购买 | 中 | 高 | 同一 Task 出现多个 purchase intent | 每 Task 一次付费 Tool；唯一 idempotency key | 第二次请求返回已有 PurchaseRequest | Day 5 |
| R09 | 并发或重试造成重复付款 | 低中 | 极高 | 同一 Purchase 出现多个 Payment | SQLite unique constraint、原子 `PAYING`、SettlementCache | 冻结 Purchase，人工核对链上状态 | Day 5 |
| R10 | 402 报价或 payee 被修改 | 低中 | 极高 | Registry 与 402 不一致 | amount、mint、network、payee 全字段精确匹配 | 立即 Rejected，不提供动态确认 | Day 3 |
| R11 | Payment 已提交但响应超时 | 中 | 高 | Client timeout，无明确 settlement response | 使用 `UNKNOWN` 状态；保存可用标识 | 查询 Facilitator 和 Solana；禁止重付 | Day 5 |
| R12 | Payment 成功但 API 数据未返回 | 中 | 高 | 链上 confirmed，HTTP body 缺失 | 尽量成功生成资源后再 settle；缓存 fulfillment | 使用同一 payment identifier 幂等重取 | Day 6 |
| R13 | Paid API 返回错误或恶意 JSON | 中 | 高 | Schema 失败、异常字符串或越界数值 | Output Schema、大小和范围校验 | Tool 标记失败，不进入 Context | Day 6 |
| R14 | 缓存行情过旧 | 中 | 中 | `as_of` 超过 2 小时 | Demo preflight 刷新快照 | 2–24 小时显示陈旧警告；超过 24 小时停止 Demo | Day 7 演示前 |
| R15 | 实时行情 Provider 失败 | 高 | 中 | rate limit、API key 或网络错误 | 运行时不调用第三方 Provider | 使用已验证缓存快照 | 已决定 |
| R16 | Private Key 出现在日志或前端 | 低 | 极高 | bundle、trace 或错误中发现 secret | Signer 封装、字段 allowlist、日志扫描 | 立即废弃 Wallet、轮换 secret、停止演示 | 每次演示前 |
| R17 | Mainnet 配置误用 | 低 | 极高 | RPC、network ID 或 mint 出现 Mainnet 值 | Devnet 三重校验；Wallet 不持有真实资产 | 阻止启动，不自动修正或继续 | 启动时 |
| R18 | SQLite / Node runtime 不兼容 | 低中 | 中 | 部署环境无法加载 SQLite | 固定 Node runtime，本地先测 | Payment Ledger 改为单进程内存加受控 JSONL，仅限 Demo | Day 5 |
| R19 | SSE Activity Feed 延迟或断线 | 中 | 低中 | UI 不更新但后台在运行 | 先写 SQLite，再推送；支持按 sequence 恢复 | 页面完成后一次性读取事件列表 | Day 7 |
| R20 | 前端消耗过多时间 | 中 | 中 | Day 6 仍在调整布局 | UI 固定为输入、Feed、结果三块 | 使用最小无动画页面或 Terminal Trace | Day 7 上午 |
| R21 | MCP 集成分散时间 | 高 | 中 | 开始设计 MCP server/client | V0 明确禁止 MCP | Static Registry | 已决定 |
| R22 | Demo Wallet 测试资金耗尽 | 中 | 中 | 余额不足 10 次演示 | Preflight 检查余额；只做必要链上测试 | 切备用 Wallet 或重新领取测试资产 | 每次演示前 |

## Fallback 等级

### Plan A：目标实现

```text
OpenAI Agent
→ Static Registry
→ Paid API HTTP 402
→ Policy
→ x402 SVM Client
→ Default Test Facilitator
→ Solana Devnet Test USDC
→ Paid JSON
→ Agent Final Answer
```

### Plan B：替换不稳定外部依赖

触发条件：默认 Facilitator 或主要 RPC 不稳定。

改变：

- 使用预先验证的备用 Facilitator。
- 使用备用 Devnet RPC。

不改变：

- 真实 HTTP 402。
- Policy。
- Wallet 隔离。
- 测试 USDC 链上 settlement。
- Paid API JSON。

### Plan C：收缩 Agent 和 UI

触发条件：Agent selection 或前端进度影响 E2E。

改变：

- Agent 只做一次结构化 Capability Plan。
- 标准 Prompt 可使用确定性 fallback mapping。
- UI 只保留输入、事件列表和最终回答。
- SSE 失败时页面结束后读取完整事件。

不改变：支付闭环。

### Plan D：本地 x402 兼容结算适配器

仅在所有测试 Facilitator 都阻断时使用。

要求：

- 保留真实 HTTP 402 和 V2 header 结构。
- 保留 PurchaseRequest、Policy 和 Signer 边界。
- 在 Solana Devnet 发送真实测试 USDC。
- Paid API 独立验证 transaction 的 mint、amount、sender、recipient 和新鲜度。
- 明确向观众说明未使用公共 Facilitator，不能声称完整兼容生产 x402 Facilitator。

这是最后手段，不是首选架构。

## 不允许的 Fallback

- 用假的 transaction ID 假装支付成功。
- 只修改数据库余额，不发生链上交易。
- 跳过 HTTP 402。
- 让 Agent 直接获得 Private Key。
- 直接返回市场数据但声称已经购买。
- 为赶进度切换到 Mainnet。
- 用户手动点击 Pay 代替小额自主付款。
- 一笔已知或未知 Payment 失败后盲目重付。

## 每日风险 Gate

| Day | Gate |
|---|---|
| Day 2 | Agent 对标准 Prompt 稳定发现唯一 Resource；两个 Demo Wallet 已有测试资产 |
| Day 3 | Paid API 稳定返回可解析的真实 402；报价字段全部匹配 Registry |
| Day 4 | 无 Agent 情况下完成一次 x402 Solana Devnet settlement，并拿到可查询 TX |
| Day 5 | Policy 自动批准 0.01；重复请求不会产生第二笔 Payment |
| Day 6 | 完整 E2E 连续运行五次；失败路径不会误付款 |
| Day 7 | Preflight 全绿；UI 和录屏不泄露 secret |

如果某个 Gate 当天没有通过，下一天优先解决 Gate 或执行 Fallback，不继续增加功能。

## Demo Preflight

每次正式演示前检查：

1. Network 明确为 Solana Devnet。
2. Mint 等于固定 Devnet USDC mint。
3. Buyer 与 Merchant 地址等于 allowlist。
4. Buyer 测试 USDC 余额足够。
5. 实际 fee payer 有足够 Devnet SOL，或 Facilitator sponsor 正常。
6. Buyer 与 Merchant token account 状态正确。
7. Primary RPC 正常。
8. Facilitator 支持目标 network。
9. Paid API 首次请求返回 402。
10. Registry 与 402 amount、mint、network、payee 一致。
11. 实时模式下 Market snapshot 不超过 2 小时。Day 7 使用 Scope Cut 允许的历史 fixture 模式，必须保留真实时间并明确标注“不是实时行情”；不能把它算作实时新鲜度通过。
12. SQLite 中没有阻塞 Demo 的活动或 UNKNOWN Payment。
13. Execution Trace redaction 检查通过。
14. Solana Explorer 可访问。
15. 完整 dry run 成功一次。

## Scope Cut 顺序

Day 7 执行记录：采用历史 fixture 和 SQLite 轮询；保留真实模型、策略审批、Devnet 付款和原交易校验。2026-09-10 Explorer 在线检查返回 429，因此严格现场 Preflight 未全绿；保留失败提示，可回看本机证据和视频，待外部服务恢复后重验。[详情](../demo/demo-runbook.md)。

进度落后时依次砍：

1. 动画和高级样式。
2. 实时行情依赖。
3. 完整 NeedsConfirmation UI。
4. 非关键 Event 持久化。
5. 开放式 Agent 多轮规划。
6. 独立 Paid API 部署。

绝不能砍：

- Agent 判断需要外部能力。
- Resource Discovery。
- HTTP 402。
- PurchaseRequest。
- Policy 自动批准。
- LLM 与 Private Key 隔离。
- Solana Devnet 测试 USDC transaction。
- Paid API payment verification。
- JSON 加入 Context。
- Agent 使用付费数据完成原任务。
- Execution Trace。

## D1-15 验收标准

- 所有高影响依赖都有 Early Signal、Mitigation 和 Fallback。
- x402、Facilitator、RPC、Faucet、Wallet、Agent、数据和 UI 风险均被覆盖。
- 每个关键风险有最晚决策时间。
- Fallback 不会伪造链上支付或跳过 Policy。
- 每一天都有明确 Risk Gate。
- 正式演示有可执行 Preflight。

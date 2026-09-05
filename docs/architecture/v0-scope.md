# D1-04 V0 Scope

## V0 必须完成

V0 只实现以下完整闭环：

1. 用户提交一个自然语言任务。
2. Agent 判断任务需要 SOL 市场数据。
3. Agent 从 Static Resource Registry 发现一个付费 API。
4. Agent 首次调用 API 并收到 HTTP 402。
5. 系统读取约 0.01 USDC 的机器可读报价。
6. Agent 发出 Purchase Request。
7. Spending Policy 自动批准合法的小额消费。
8. 后端 Demo Wallet 在 Agent 无法读取私钥的前提下完成签名。
9. 支付在 Solana Devnet 上得到确认。
10. Paid API 返回结构化市场数据。
11. 数据经过验证后加入 Agent Context。
12. Agent 使用这些数据完成原始市场分析。
13. 页面展示完整 Execution Trace 和交易证据。

## V0 固定配置

| Item | V0 Decision |
|---|---|
| 用户 | 单用户，不登录 |
| Agent | 单 Agent |
| Demo Task | SOL 市场分析 |
| Resource | 一个 Premium SOL Market Snapshot API |
| Provider | 一个固定 Demo Provider |
| Price | 约 0.01 测试 USDC |
| Currency | Solana Devnet 测试 USDC |
| Network | Solana Devnet |
| Payment Scheme | x402 exact fixed-price |
| Wallet | 后端托管的 Dedicated Demo Wallet |
| Resource Discovery | Static Local Registry |
| Market Data | 带时间戳的缓存快照 |
| Persistence | SQLite |
| UI | 一个任务输入、Activity Feed、最终结果 |

## V0 明确不做

### 产品层

- API Marketplace。
- Provider 入驻系统。
- 搜索、排名、评分或推荐系统。
- API 订阅和套餐。
- API 余额或额度交易。
- API resale。
- 用户账户、团队和权限管理。
- 用户历史账单中心。
- Agent Economy 或 Token 经济模型。

### Agent 层

- 多 Agent 协作。
- 长期记忆。
- Agent 自由访问互联网。
- 通用浏览器、Shell 或代码执行能力。
- 动态安装未知 Tool。
- 任意 URL 调用。
- 自动交易或投资操作。

### Tool 层

- 多 Provider。
- 多个市场数据 API。
- MCP Tool Discovery。
- x402 Bazaar 或其他 Marketplace Discovery。
- 动态价格比较。
- Provider 信誉和评分。
- Tool 组合、工作流市场或 resale。

### 支付层

- Mainnet 支付。
- 用户自己的 Wallet 连接。
- 多钱包管理。
- 多链。
- 多 Token。
- 订阅、预授权扣款或批量结算。
- 退款、争议处理和会计系统。
- Production custody。
- 链上智能合约 Spending Policy。

### 数据与基础设施

- PostgreSQL。
- Redis。
- 消息队列。
- 微服务。
- Kubernetes。
- Production scaling。
- 多区域部署。
- 实时第三方行情依赖。
- 数据分析 Dashboard。

### UI 层

- 复杂聊天产品。
- 多页面后台。
- 高级图表和交易终端。
- 动画系统。
- 主题切换。
- Wallet connect UI。
- Marketplace 页面。

## 新需求判断规则

遇到新功能建议时，只问三个问题：

1. 没有它，Agent 是否仍能完成一次自主购买？
2. 没有它，观众是否仍能看懂购买过程？
3. 没有它，Demo 是否仍能安全、稳定地重复运行？

如果三个答案都是“可以”，该功能不进入 V0。

## 允许进入 V0 的变更

只有以下类型的变更可以在七天内新增：

- 修复完整闭环中的阻断问题。
- 降低错误支付或私钥泄露风险。
- 提高 Demo 重复成功率。
- 让核心 Execution Trace 更容易理解。
- 替换不稳定依赖，但不扩大产品范围。

## Scope Cut 顺序

如果开发落后，按以下顺序继续缩减：

1. 取消所有高级 UI 样式，只保留任务、Feed 和结果。
2. 取消实时第三方行情，使用固定快照。
3. 取消完整用户确认 UI，只保留 `NeedsConfirmation` 状态。
4. 取消非关键 Execution Event 持久化，只保留 Payment Ledger。
5. 将 Agent 规划缩减为一次结构化判断。

不得砍掉：

- HTTP 402。
- Agent Purchase Request。
- Policy 自动批准。
- LLM 与私钥隔离。
- Solana Devnet 测试 USDC 支付。
- Paid API 返回 JSON。
- 数据进入 Agent Context。
- Agent 使用付费数据完成任务。
- 可理解的 Execution Trace。

## 验收标准

D1-04 只有在以下条件全部满足时才算完成：

- V0 必做功能可以用一条闭环描述。
- 所有固定技术和产品约束都有明确值。
- Marketplace、MCP、多链、多 Provider 和 Mainnet 被明确排除。
- 新需求有统一的进入判断规则。
- 开发落后时有明确的 Scope Cut 顺序。
- 自主购买核心闭环被标记为不可删除。

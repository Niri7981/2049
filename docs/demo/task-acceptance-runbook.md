# 完整任务：运行与验收

> 历史阶段说明中的 Day 编号和原交易 ID 保留用于追溯；文件名、代码入口和命令已更新为功能名称。
## 行为

同一个任务连续执行：真实模型判断需求 → Registry 发现 → HTTP 402 报价 → Policy 与预算预占 → 钱包签名 → x402 settlement → 链上核对原交易 → 有界 JSON 校验 → 模型分析 → 缓存回答。

同一任务 ID 和原文本重跑：

- `PAID` 且已有回答：直接复用，不调用模型、不付款。
- `PAID` 但回答失败：只重试模型分析。
- `PAYING` / `PAYMENT_UNKNOWN` 且有原签名载荷：发送 `PAYMENT-RECOVERY: 1`，仅查询原结算和取回数据，不签名、不重新 settle。
- 未领取的过期 `APPROVED`：释放预算；不得将已经领取付款的记录按过期释放。
- 签名前检查、钱包访问或模拟明确失败，且没有保存待提交载荷：标记 `FAILED` 并释放预算。

服务端恢复检查签名载荷与已验证记录完全一致。已缓存交付直接返回；结算结果未知时，先核对已有交易 ID，没有回执时按唯一 memo 查询买方最近 100 条链上记录，最多检查 3 个候选。候选必须与原签名交易 message 的 SHA-256 和链上交易签名一致。

链上 `confirmed` 成功恢复数据；失败须在 `finalized` 再确认后标记 `FAILED`。客户端也独立读取原链交易作相同的内容核对，不能仅凭 HTTP 回执认定成功或释放预算。

## 运行

本机 `.env.local` 沿用 Day 5 的 Devnet 钱包及模型配置，不需要新建钱包。模型请求保留 1200-token 输出上限，超时为 60 秒，关闭 SDK tracing。

```bash
npm run demo:dev
npm run task:acceptance
```

验收脚本会执行当天固定 ID 的五个任务，每个任务付款 0.01 测试 USDC，完成后通过另一 SQLite 连接验证原任务重跑不调用模型或付款。重复运行脚本会复用当天已有任务，输出 `fresh` 说明是否为新任务。需要独立新批次时可运行 `npm run task:acceptance -- BATCH`；每个新批次最多再购买五次，切勿用新批次绕过未知付款。

此外，脚本在隔离的内存账本中重建“客户端丢失响应”和“服务端丢失结算回执”的状态，使用真实已确认交易和原签名载荷验证恢复，不修改正式账本或再次付款。最后独立读取买卖双方余额，检查总变动与新购买次数一致。

明细保存在 `.data/day6/`（Git 忽略）；文件不含私钥、API Key 或签名载荷。脚本中途失败时保留原任务 ID，不通过更换 ID 或删除账本重付。

## 有意保留的边界

- 链上查不到、RPC 超时、超出有界历史窗口或没有原载荷时，继续冻结并人工核对；“查不到”不等于失败。
- 恢复按原任务重跑触发；不是常驻后台轮询。新任务不能绕过已有未知付款。
- HTTP 响应必须是 JSON，实际读取不超过 16 KiB，且符合严格 Schema。错误数据不会交给模型。
- 恢复确认时按本次确认日计入账本日预算，跨日情况下是保守记账；不声称是整个钱包的链上消费统计。
- 市场数据仍是明确标注日期的 Demo fixture，不是实时行情。
- 并发重试可重复执行只读对账；付款完成事件只保存一次。模型生成回答仍可能并发调用，付款不会重复。

## 验收记录

2026-09-10，`final` 批次在一次进程运行中连续完成五个全新任务。每个任务均使用真实模型规划和分析、真实 Devnet x402 付款，没有本地规划替代。五次独立连接重跑均复用缓存，没有新增付款或模型调用。

| 次数 | Task ID | Devnet 交易 |
|---|---|---|

| 1 | `day6-devnet-2026-09-10-final-1` | [查看交易](https://explorer.solana.com/tx/2cb2Es5h1hAgdovBtihbfwRQFoD1kydXWNcHj1ZnbKkAfUHdSuxdxxPvqqeAHeZ9Y9AWaAAL4PRhRqy7e9rDUH8Z?cluster=devnet) |
| 2 | `day6-devnet-2026-09-10-final-2` | [查看交易](https://explorer.solana.com/tx/2yaAro1K38j86XB6KX8QvTASiyHMkVz4LNpVSPaKcpNmY6JygYV6f9rvzMTpKhr4GsUX1X3yN8kBoRN9Ray4kkuC?cluster=devnet) |
| 3 | `day6-devnet-2026-09-10-final-3` | [查看交易](https://explorer.solana.com/tx/HFFNS27nBgJbpTjjDdF8xihC5mQQ6Xp1haxfHzJtGoxv3ZKLCZcMWuk2iBr1YDPACZcQcaw2F7GM1n15GN8VH5q?cluster=devnet) |
| 4 | `day6-devnet-2026-09-10-final-4` | [查看交易](https://explorer.solana.com/tx/gyPr4kJomNKcgXkL5ZCziMfQnxorrrj7BxJEivsiHmNjeQirxAabSJFrspfqMfLrYP1CJgx8DzLa4GiRHZ5LMEC?cluster=devnet) |
| 5 | `day6-devnet-2026-09-10-final-5` | [查看交易](https://explorer.solana.com/tx/2zCGmBYQJgTd2ovswBw3y5HBLnf5PDvexmDuHdGqVJWCeWN7Gesm3UvpbziSkk2BVFXP8fJuAWWsbZMZyTBeLqhx?cluster=devnet) |

- 最终批次买方：0.93 → 0.88 USDC；商家：0.07 → 0.12 USDC。五笔各 0.01 测试 USDC，总额精确匹配，无重复扣款。
- 两个故障恢复检查均通过：隔离客户端账本重建丢响应状态后，从真实 API 取回原数据；隔离服务端账本重建丢回执状态后，通过真实 RPC 和 memo 找到原交易。禁止的 Facilitator 方法未被调用。
- 前一轮演练首次在第二个任务创建购买前停止，原任务重跑后完成。为满足严格连续门槛，另跑上述全新 `final` 批次。本次开发验收合计十笔付款，买方 0.98 → 0.88 USDC，商家 0.02 → 0.12 USDC，总计 0.10 **测试** USDC。模型 API 费用另由服务后台计费。
- 183 项测试、TypeScript、ESLint 和生产构建通过。包括未知状态冻结、原内容绑定、已最终确认失败、并发恢复、客户端/服务端数据库重开、数据大小与 Schema 拒绝。
- 本地完整明细：`.data/day6/acceptance-final.json` 以及同目录五份任务 JSON；均已排除 Git。

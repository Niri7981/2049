# D1-03 Demo Output

## 目标

Demo 结束时，观众必须同时看懂三件事：

1. Agent 为什么需要购买外部能力。
2. Agent 如何在 Policy 约束下自主完成支付。
3. Agent 确实使用了购买到的数据完成原始任务。

## 最终页面必须展示的四个区域

### 1. 原始任务

显示用户提交的标准输入：

> 使用专业市场数据分析一下 SOL 当前的市场情况。

### 2. Execution Trace

至少显示以下事件，且顺序不可混乱：

1. Agent 理解任务。
2. Agent 判断需要当前市场数据。
3. Resource Discovery 找到 Premium SOL Market Snapshot API。
4. Paid API 返回 HTTP 402。
5. 系统显示价格约为 0.01 USDC、网络为 Solana Devnet。
6. Agent 发出 Purchase Request。
7. Policy 返回 Approved，并显示批准原因。
8. Wallet 对批准的支付载荷签名。
9. Solana transaction 获得确认。
10. Paid API 验证付款并返回市场数据。
11. Tool Result 被加入 Agent Context。
12. Agent 使用数据完成分析。

Execution Trace 只展示结构化决策摘要，不展示模型隐藏思维链。

### 3. 支付证据

必须展示：

- 支付金额：约 0.01 测试 USDC。
- Network：Solana Devnet。
- Policy Decision：Approved。
- 批准原因：金额低于单笔自动支付上限，且 Token、网络、Resource、收款地址均合法。
- Transaction status：Confirmed。
- Transaction signature 的缩略值。
- 可打开的 Solana Explorer 链接。

不得展示：

- Private Key。
- Seed Phrase。
- 完整 `PAYMENT-SIGNATURE`。
- 服务端环境变量。

### 4. 最终市场分析

最终回答必须：

- 明确指出市场数据的 `as_of` 时间。
- 至少引用三个 Paid API 返回的指标。
- 区分数据事实和 Agent 判断。
- 给出简洁的市场状态总结。
- 说明这不是投资建议。

建议引用的指标：

- SOL spot price。
- 24 小时涨跌幅。
- 24 小时成交量。
- 7 日波动率。
- RSI。
- 支撑位和阻力位。

## 最终回答结构

最终分析固定为四个部分：

1. **市场快照**：列出关键数据和时间。
2. **市场判断**：说明偏强、偏弱或震荡及依据。
3. **关键位置**：说明支撑位、阻力位和风险因素。
4. **数据声明**：注明数据为带时间戳的 Demo 市场快照，不构成投资建议。

## Demo 成功画面

一次成功运行结束后，页面应处于以下状态：

- Task status：Completed。
- Policy status：Approved。
- Payment status：Confirmed。
- Tool status：Succeeded。
- Final Answer：已生成。
- Activity Feed：完整可回看。

## 验收标准

D1-03 只有在以下条件全部满足时才算完成：

- 观众能看到 Agent 为什么购买数据。
- 观众能看到价格和 Policy 批准原因。
- 观众能看到真实 Solana Devnet transaction 证据。
- 观众能看到 API 返回了结构化市场数据。
- 最终分析明确引用至少三个购买到的指标。
- 页面不泄露 Private Key 或完整支付签名。
- 只看最终画面就能理解整个自主购买闭环。

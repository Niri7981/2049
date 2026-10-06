# Product Definition

## V0 一句话目标

用户提交任务后，AI Agent 能发现自己需要一份付费的 SOL 市场数据，在 Spending Policy 允许时自主支付约 0.01 测试 USDC，并使用返回的数据完成原始市场分析任务。

## 核心证明

V0 只证明一件事：

> AI Agent 可以在不接触私钥的前提下，自主购买完成任务所需要的一次外部能力，并真正使用购买结果完成任务。

## 必须包含的闭环

1. 用户提交自然语言任务。
2. Agent 判断需要外部市场数据。
3. Agent 发现一个付费 API。
4. API 返回机器可读的价格和支付要求。
5. Agent 发出 Purchase Request。
6. Spending Policy 独立判断是否允许消费。
7. 后端 Wallet 代表已批准的请求完成支付。
8. Paid API 返回结构化数据。
9. 数据被加入 Agent Context。
10. Agent 使用该数据完成用户的原始任务。

## V0 不是什么

- 不是 API Marketplace。
- 不是多 Provider 平台。
- 不是订阅产品。
- 不是 Token 项目。
- 不是多链支付系统。
- 不是 Agent Economy 平台。

## 成功判断

如果 Agent 只是付款但没有使用返回数据，V0 失败。

如果用户仍需手动点击 Pay 才能完成 0.01 USDC 的合法小额支付，V0 失败。

如果 LLM 可以读取私钥或绕过 Spending Policy，V0 失败。

只有完整完成“发现能力 → 请求购买 → Policy 批准 → 自动支付 → 获得数据 → 使用数据完成任务”，V0 才算成功。

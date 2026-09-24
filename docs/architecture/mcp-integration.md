# 2049 MCP 接入（更新于 2026-09-23）

## 已实现的范围

采用 x402 官方 MCP→HTTP 桥接示例的结构：官方 MCP SDK 负责工具注册、协议协商和 stdio；2049 的薄适配只调用运行中的本地后端。协议报价仍由现有 `@x402/core` HTTP 客户端解析。保留产品钥匙串钱包、共享额度和账本。

当前开放两个只读工具和一个可提交购买意图的工具；SpendGrant 决定意图是否获准执行付款：

- `get_spending_status`：查询产品钱包地址、余额和共用额度。
- `get_market_quote`：向本机测试 Paid API 获取真实 402 报价，检查固定资源、网络、资产、收款方和金额。返回的是 Devnet 示例快照的报价，不是实时市场数据，也不产生购买授权。
- `request_purchase`：只接受稳定 `requestId`、服务端 offer ID（`basic` / `premium`）和用途摘要。有效连接可提交购买意图，即使 SpendGrant 尚未创建、已撤销或已过期。后端取得真实 402，按 SpendGrant 与额度评估并持久写入 `APPROVED` / `DENIED`；无 Grant 返回 `SPEND_GRANT_REQUIRED`，撤销返回 `SPEND_GRANT_REVOKED`，过期返回 `SPEND_GRANT_EXPIRED`。显式启用 Devnet 付款时，只有 `APPROVED` 的 basic 请求以持久报价进入既有 claim、官方 x402 client、签名、结算、对账和交付路径；`DENIED` 保持 `paymentStatus: NOT_STARTED`。

没有开放修改额度、管理连接、导出密钥或通用签名工具。Agent 不能提交金额、URL、收款方、资产、交易或 `approved`。用户在 App 创建有限消费授权后，策略才可能批准付款；创建、替换或撤销授权会轮换连接凭据。原对话确认仍未实现，所以 M4 保持部分完成；App grant 是明确的预先委托，不冒充逐笔宿主确认。

App 在本地账本中持久维护一个默认 Codex CardMember。`connectionId` 和 generation 是可撤销的连接/凭据代次，不是经济所有者；后端签发连接时写入 `cardMemberId`，Agent 输入中没有该字段。SpendGrant 与 Agent 购买的标准化 owner 均绑定 CardMember，原连接 ID/代次仍保存在授权事实中用于审计。相同 CardMember 换用新连接或新 generation 后，以相同 `requestId` 和相同不可变请求重放，会直接复用原购买并返回持久资源，不重新取得报价或进入付款路径。

付款执行使用报价时保存的完整 offer endpoint 和金额，不重新报价。执行绑定覆盖买方、HTTP 方法、完整 endpoint、网络、资产、收款方和完整 `PaymentRequirements`。账本在 claim、加载 signer 前、SDK 实际签名前、保存 payload 以及首次 HTTP 提交前重新检查暂停、到期、共享额度、Grant 状态/版本/主体/范围/单笔与总额、quote fingerprint 和 execution binding。已保存 payload 的超时与重启恢复只重用原 payload，不重新签名或创建替代付款。

## 官方能力与本地适配

本轮锁定 `@modelcontextprotocol/sdk@1.27.1`，使用 `McpServer.registerTool`、`StdioServerTransport`。已有 x402 依赖保持不变。

- [x402 官方 MCP→HTTP 示例](https://github.com/x402-foundation/x402/blob/main/docs/guides/mcp-server-with-x402.md)：适用于当前 HTTP Paid API。示例中的自动支付由 2049 既有购买服务管理，不能复制出第二条绕开额度的付款路径。
- [`@x402/mcp`](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mcp)：处理原生付费 MCP 工具的付款元数据，不是本轮 HTTP API 的必要依赖。
- [官方 MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)：负责 MCP 协议实现。本地仅补 App 生命周期、管理与 Agent 分权、撤销，以及工具到业务入口的映射；这些属于 2049 的应用边界。
- [Codex MCP 配置](https://developers.openai.com/codex/mcp)：通过 stdio 连接本地桥接脚本。

## 本机连接

先启动 `npm run app:dev`，在 App 中启用 Agent 连接，再让 Codex 加载 MCP 配置。示例（把绝对路径换成自己的安装位置）：

```sh
codex mcp add 2049 -- /absolute/path/to/node --import /absolute/path/to/2049/node_modules/tsx/dist/loader.mjs /absolute/path/to/2049/scripts/mcp.ts
```

MCP 进程不会启动钱包服务，也不会读取项目 `.env.local`。它只读取产品数据目录内权限为 `0600` 的只读连接凭据，然后调用 loopback 后端。配置文件不包含钱包密钥或管理令牌。

连接默认关闭。启用后向活跃 CardMember 签发 `read` 和 `request_purchase`，后者只允许提交购买意图，不证明消费授权。创建或撤销 Grant 会轮换令牌并保留这两项连接能力；旧令牌立即失效。Grant 到期不必轮换令牌，后端策略仍会拒绝付款并保存拒绝记录。App 每次启用连接会产生新的连接身份，但继续绑定同一个默认 CardMember；App 重启后保持关闭并撤销旧的活跃 Grant。MCP 进程首次调用时缓存当前令牌，不会自行读取轮换后的令牌；连接或授权变化后需要重启 MCP 会话。

连接撤销只使该凭据失效；Grant 撤销阻止新消费但不删除所有权；CardMember 撤销会使其全部连接认证失败，并阻止 Agent 读取其历史资源。已提交或结果未知的原付款仍按原 payload 对账。当前产品只有一个真实默认 CardMember，因此仍保留全局 `requestId` 唯一约束，避免在本次身份修复中重建购买表和索引。启用第二个真实 CardMember 前，必须把唯一性调整为 `(cardMemberId, requestId)`。历史迁移会给同一个旧 `connectionId` 的所有 generation 分配同一个导入成员；不同旧 `connectionId` 不自动合并，且不会改写报价、批准、payload、交易、事件、资源或结算证据。

App 显示“最近收到请求”，不把启用开关当作宿主已连接的证明，也不根据客户端自报名称断言调用者就是 Codex。此机制不防御同一 macOS 用户下能读取本机文件的恶意进程。

## 验证与限制

自动化覆盖官方 SDK 握手、三个工具、错误脱敏、Agent/管理权限隔离、跨站拒绝、授权创建/撤销时令牌轮换，以及真实 402 的 0.20 批准与执行桥接、20 策略拒绝、稳定 ID 重放、同键异参、并发同 ID、并发预算、报价期间撤销、签名前撤销/过期/暂停/降额、付款事实篡改、提交超时和 SQLite 重启恢复。DENIED 测试明确断言付款与恢复入口、Facilitator `verify` / `settle` 均未调用。STEP 1 的付款依赖均为模拟，没有执行真实 Devnet 付款。产品进程同时停用旧 `/api/demo/tasks` 付款 worker，防止绕开 grant 使用另一份账本。

2026-09-19 验证：当时的 229 项自动化、类型检查、lint 和 Next.js 生产构建通过；Electron 实际启动并显示只读 Agent 连接入口。本段是只读阶段的历史证据，不证明 9 月 21 日新增购买工具已在真实宿主运行。

2026-09-20 的实际宿主验收：在 Electron App 中临时启用连接后，使用 Codex 桌面安装包内的 `codex app-server` 创建临时线程并调用 `mcpServer/tool/call` 的 `get_spending_status`。调用返回产品钱包地址、已设置的 `10000` 最小单位日额度和 `paymentEnabled: false`。App 随后显示“最近收到请求”；连接已在验收结束后通过 App 撤销，凭据文件已移除。全过程没有调用付款工具、没有签名或提交交易。

同次验收还通过 App 菜单正常退出并重新启动 Electron；重启后钱包、额度和历史记录仍可读取，Agent 连接保持关闭。无凭据访问 Agent 路由返回 `401`。

本机 Codex Desktop 的 `mcpServerOpenaiFormElicitation` 功能目前为关闭状态。因此现有宿主不能为付款工具提供可验证的原对话表单确认；模型参数、普通令牌或 MCP 调用成功均不能替代它。依据 [Codex App Server 的 MCP elicitation 约定](https://learn.chatgpt.com/docs/app-server#MCP-server-elicitation-requests)，只有宿主呈现并回传 accept/decline 的 elicitation 结果才可作为确认通道。该开关由用户决定是否开启；在开启并完成实际确认/拒绝/重放测试前，M4 保持部分完成，M5 的授权与自动付款保持未开始。

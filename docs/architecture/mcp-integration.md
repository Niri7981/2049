# 2049 MCP 接入（更新于 2026-10-02）

## Codex 专属连接路径

原生 App 的 Members → 默认 Codex Member → Connect，现在通过认证管理 API 完成 Codex 专属配置，而不是只启用 Member 凭据。当前只有 Codex 提供此路径；Claude、Grok、Gemini、Cursor、Copilot、Windsurf 保持 Unavailable。自定义 Member 的已有通用凭据入口保留，不因显示名称而推断 Provider。

```text
2049 后端 → 共享每日额度
  └─ 持久 Member UUID → Member SpendGrant / 购买所有权
       └─ 独立 AgentConnection / 可轮换凭据
            └─ CodexIntegration → Codex MCP 配置
                 └─ 官方 stdio MCP → 初始化 + 宿主 ping → 认证会话租约
                      └─ 后端 Connected 事实 → Members / Connection 界面
```

- `CodexIntegration` 封装宿主发现、配置安装、核对与移除。使用已安装 Codex 的官方 `mcp list/add/remove`，由 Codex 管理 TOML。固定默认 Member 是现有 Codex 身份，不通过 label 或客户端自报名称选择 Provider。新增 Provider 时增加独立配置适配器与明确的 Member 绑定，不复制凭据、Grant、额度或付款逻辑。
- 专属条目命名为 `2049-codex-<Member UUID 的完整 base64url 编码>`，避免覆盖现有 `2049`、`2049-research` 或其他用户条目。启动命令使用 Node、tsx loader 和桥接脚本的绝对路径；环境变量只有 `APP2049_DATA_DIR`、`APP2049_CARD_MEMBER_ID`、`APP2049_MCP_PROVIDER=codex`。不写入钱包密钥、Agent 令牌或管理认证。
- 配置经 CLI 回读核对后，保存权限为 `0600` 的 Member 配置记录，再签发凭据。管理连接操作串行执行；重复 Connect 检查配置并复用有效凭据，保留现有 Grant。配置错误不伪造 Connected，不暴露 CLI 原始错误。记录损坏只阻止 Codex 配置操作，不阻止钱包／账本启动。
- Disconnect 先撤销 Member 凭据及其 Grant，再移除确认为本功能创建且未被修改的条目。用户修改条目时返回 `CODEX_CONFIG_CONFLICT`，保留用户设置，凭据仍失效。App 正常退出保留配置，撤销凭据；配置存在不意味着 MCP 会自动启动 App。
- 保存配置不证明当前 Codex 会话已加载。App 显示 Reconnect Required，并提示新建 Codex 对话或重新加载 MCP。2049 不控制正在运行的 Codex 对话，也不启动隐藏宿主来伪造连接。

### 握手、存活与可信边界

专属桥接在官方 SDK 的 `oninitialized` 后向宿主发送 MCP `ping`，收到响应才经 `POST /api/agent/session` 报告初始化；以后每 10 秒重新 ping，再提交递增序号的心跳。接口使用现有 Member Agent 凭据、loopback／跨站限制和运行时 schema。普通工具请求、凭据 enabled、客户端自报名称、配置记录或历史 lastSeen 均不能建立 Connected。

会话租约为 30 秒，时间由后端记录；重复／乱序心跳、未初始化会话、过期会话与时钟回拨被拒绝。多个 Codex 会话可同时存在，任一当前凭据的活跃会话可维持连接。正常关闭报告 closed；宿主强制结束桥接而没有关闭报告时，租约到期后降级。凭据轮换、断开、Member 撤销、退出与后端重启立即清除本进程会话证据。失效桥接不重新读取新令牌，而是结束会话；重新加载 MCP 才取得新凭据。

Provider 事实来自本地 Codex 配置与绑定 Member 的桥接路径，不是供应商签名证明，也不防御能读取同一 macOS 用户文件、复制参数与凭据的恶意进程。租约只证明最近一次宿主响应，既不是付款授权，也不是购买成功证据。

管理投影新增 `connection.integration`，包含 Provider、配置状态、连接状态与最后握手／心跳时间，不包含令牌。配置状态是最后一次成功安装记录，Connect 会核对当前磁盘配置；Connected 另由当前会话租约决定。原生 Members 和 Connection 页面定时读取后端事实，无循环动画；服务不可用时不继续显示旧 Connected。

### 本轮验证

`tests/integration/codex-provider.test.ts` 使用实际安装的 Codex CLI / app-server，在临时 `CODEX_HOME` 中验证：管理 Connect 保存专属配置、宿主加载配置、官方 MCP 握手／持续 ping、只读调用的 Member 归属、Grant 轮换后的旧凭据拒绝、配置重新加载后的新会话、重复 Connect 保留 Grant、宿主关闭／租约失效、重启保留配置与 UUID 但关闭凭据／撤销 Grant、Disconnect 移除专属条目。没有 Codex 的环境明确跳过该用例；跳过不代表实际宿主验收通过。

测试没有调用收费模型、签名或提交付款。其他自动化覆盖配置冲突、损坏记录、错误脱敏、会话重放／过期／回拨和 Swift 状态映射。安装版当前启动证据另行报告，不用历史验收代替本轮验证。

2026-10-02 安装版验收：正常退出旧 App 与后端后，使用现有安装脚本更新 `/Users/irin/Applications/2049.app`，核对安装／构建产物哈希一致和实际进程路径。从原生 Members 点击 Codex Connect，成功保存用户 Codex 配置；真实安装的 `codex-cli 0.159.2` app-server 加载该配置并成功调用 `get_spending_status`，Members 与 Connection 实际显示 Connected 及握手时间。只读返回 `paymentEnabled: false`，没有活跃 Grant，也没有调用付款工具。无 Agent 凭据访问返回 401。验收宿主关闭后保留配置，活跃会话租约失效时回到 Reconnect Required。

本轮完整自动化 361 项、typecheck、lint、Next.js 生产构建、macOS Release 构建与原生展示／Members 管理 smoke 通过；仅包含本任务暂存内容的独立源码快照也通过 typecheck、lint 与原生 Release 构建。慢 CLI 回归先复现旧 3 秒超时失败，再验证修复：单次 CLI 最多 8 秒，完整配置操作共用 12 秒总期限。

## 已实现的范围

采用 x402 官方 MCP→HTTP 桥接示例的结构：官方 MCP SDK 负责工具注册、协议协商和 stdio；2049 的薄适配只调用运行中的本地后端。协议报价仍由现有 `@x402/core` HTTP 客户端解析。保留产品钥匙串钱包、共享额度和账本。

当前开放两个只读工具和一个可提交购买意图的工具；SpendGrant 决定意图是否获准执行付款：

- `get_spending_status`：查询产品钱包地址、余额和共用额度。
- `get_market_quote`：向本机测试 Paid API 获取真实 402 报价，检查固定资源、网络、资产、收款方和金额。返回的是 Devnet 示例快照的报价，不是实时市场数据，也不产生购买授权。
- `request_purchase`：只接受稳定 `requestId`、服务端 offer ID（`basic` / `premium`）和用途摘要。有效连接可提交购买意图，即使 SpendGrant 尚未创建、已撤销或已过期。后端取得真实 402，按 SpendGrant 与额度评估并持久写入 `APPROVED` / `DENIED`；无 Grant 返回 `SPEND_GRANT_REQUIRED`，撤销返回 `SPEND_GRANT_REVOKED`，过期返回 `SPEND_GRANT_EXPIRED`。显式启用 Devnet 付款时，只有 `APPROVED` 的 basic 请求以持久报价进入既有 claim、官方 x402 client、签名、结算、对账和交付路径；`DENIED` 保持 `paymentStatus: NOT_STARTED`。

没有开放修改额度、管理连接、导出密钥或通用签名工具。Agent 不能提交金额、URL、收款方、资产、交易或 `approved`。用户在 App 创建有限消费授权后，策略才可能批准付款；创建、替换或撤销授权会轮换连接凭据。原对话确认仍未实现，所以 M4 保持部分完成；App grant 是明确的预先委托，不冒充逐笔宿主确认。

App 在本地账本中持久维护默认 Codex CardMember 和用户创建的其他独立 CardMember。`connectionId` 和 generation 是可撤销的连接/凭据代次，不是经济所有者；后端签发连接时写入 `cardMemberId`，Agent 输入中没有该字段。SpendGrant 与 Agent 购买的标准化 owner 均绑定 CardMember，原连接 ID/代次仍保存在授权事实中用于审计。相同 CardMember 换用新连接或新 generation 后，以相同 `requestId` 和相同不可变请求重放，会直接复用原购买并返回持久资源，不重新取得报价或进入付款路径。

付款执行使用报价时保存的完整 offer endpoint 和金额，不重新报价。执行绑定覆盖买方、HTTP 方法、完整 endpoint、网络、资产、收款方和完整 `PaymentRequirements`。账本在 claim、加载 signer 前、SDK 实际签名前、保存 payload 以及首次 HTTP 提交前重新检查暂停、到期、共享额度、Grant 状态/版本/主体/范围/单笔与总额、quote fingerprint 和 execution binding。已保存 payload 的超时与重启恢复只重用原 payload，不重新签名或创建替代付款。

## 官方能力与本地适配

本轮锁定 `@modelcontextprotocol/sdk@1.27.1`，使用 `McpServer.registerTool`、`StdioServerTransport`。已有 x402 依赖保持不变。

- [x402 官方 MCP→HTTP 示例](https://github.com/x402-foundation/x402/blob/main/docs/guides/mcp-server-with-x402.md)：适用于当前 HTTP Paid API。示例中的自动支付由 2049 既有购买服务管理，不能复制出第二条绕开额度的付款路径。
- [`@x402/mcp`](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mcp)：处理原生付费 MCP 工具的付款元数据，不是本轮 HTTP API 的必要依赖。
- [官方 MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)：负责 MCP 协议实现。本地仅补 App 生命周期、管理与 Agent 分权、撤销，以及工具到业务入口的映射；这些属于 2049 的应用边界。
- [Codex MCP 配置](https://developers.openai.com/codex/mcp)：通过 stdio 连接本地桥接脚本。

## 本机连接

Codex 用户从已安装原生 App 的 Members 或 Connection 页面点击 Connect，由后端自动保存配置，然后新建 Codex 对话或重新加载 MCP。以下仅为已有通用 stdio 桥接的手工开发示例（不是新的产品 Connect 流程）：

```sh
codex mcp add 2049 -- /absolute/path/to/node --import /absolute/path/to/2049/node_modules/tsx/dist/loader.mjs /absolute/path/to/2049/scripts/mcp.ts
```

MCP 进程不会启动钱包服务，也不会读取项目 `.env.local`。它只读取产品数据目录内权限为 `0600` 的只读连接凭据，然后调用 loopback 后端。配置文件不包含钱包密钥或管理令牌。

连接默认关闭。启用后向活跃 CardMember 签发 `read` 和 `request_purchase`，后者只允许提交购买意图，不证明消费授权。创建或撤销 Grant 会轮换令牌并保留这两项连接能力；旧令牌立即失效。Grant 到期不必轮换令牌，后端策略仍会拒绝付款并保存拒绝记录。App 每次启用连接会产生新的连接身份，但继续绑定同一个默认 CardMember；App 重启后保持关闭并撤销旧的活跃 Grant。MCP 进程首次调用时缓存当前令牌，不会自行读取轮换后的令牌；连接或授权变化后需要重启 MCP 会话。

连接撤销只使该凭据失效；Grant 撤销阻止新消费但不删除所有权；CardMember 撤销会使其全部连接认证失败，并阻止 Agent 读取其历史资源。已提交或结果未知的原付款仍按原 payload 对账。当前支持多个独立 CardMember，购买请求唯一性已按 `(cardMemberId, requestId)` 隔离，所有成员仍共享同一每日额度。历史迁移会给同一个旧 `connectionId` 的所有 generation 分配同一个导入成员；不同旧 `connectionId` 不自动合并，且不会改写报价、批准、payload、交易、事件、资源或结算证据。

通用桥接的 lastSeen 仅表示最近认证请求。Codex 专属路径的 Connected 使用上述初始化、宿主 ping 与有限租约；启用开关和客户端自报名称仍不能证明连接。

## 验证与限制

自动化覆盖官方 SDK 握手、三个工具、错误脱敏、Agent/管理权限隔离、跨站拒绝、授权创建/撤销时令牌轮换，以及真实 402 的 0.20 批准与执行桥接、20 策略拒绝、稳定 ID 重放、同键异参、并发同 ID、并发预算、报价期间撤销、签名前撤销/过期/暂停/降额、付款事实篡改、提交超时和 SQLite 重启恢复。DENIED 测试明确断言付款与恢复入口、Facilitator `verify` / `settle` 均未调用。STEP 1 的付款依赖均为模拟，没有执行真实 Devnet 付款。产品进程同时停用旧 `/api/demo/tasks` 付款 worker，防止绕开 grant 使用另一份账本。

2026-09-19 验证：当时的 229 项自动化、类型检查、lint 和 Next.js 生产构建通过；Electron 实际启动并显示只读 Agent 连接入口。本段是只读阶段的历史证据，不证明 9 月 21 日新增购买工具已在真实宿主运行。

2026-09-20 的实际宿主验收：在 Electron App 中临时启用连接后，使用 Codex 桌面安装包内的 `codex app-server` 创建临时线程并调用 `mcpServer/tool/call` 的 `get_spending_status`。调用返回产品钱包地址、已设置的 `10000` 最小单位日额度和 `paymentEnabled: false`。App 随后显示“最近收到请求”；连接已在验收结束后通过 App 撤销，凭据文件已移除。全过程没有调用付款工具、没有签名或提交交易。

同次验收还通过 App 菜单正常退出并重新启动 Electron；重启后钱包、额度和历史记录仍可读取，Agent 连接保持关闭。无凭据访问 Agent 路由返回 `401`。

本机 Codex Desktop 的 `mcpServerOpenaiFormElicitation` 功能目前为关闭状态。因此现有宿主不能为付款工具提供可验证的原对话表单确认；模型参数、普通令牌或 MCP 调用成功均不能替代它。依据 [Codex App Server 的 MCP elicitation 约定](https://learn.chatgpt.com/docs/app-server#MCP-server-elicitation-requests)，只有宿主呈现并回传 accept/decline 的 elicitation 结果才可作为确认通道。该开关由用户决定是否开启；在开启并完成实际确认/拒绝/重放测试前，M4 保持部分完成，M5 的授权与自动付款保持未开始。

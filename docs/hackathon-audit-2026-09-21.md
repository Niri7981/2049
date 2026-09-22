# 2049 仓库审计与黑客松最短交付路径

审计日期：2026-09-21。基于桌面仓库 `/Users/irin/Desktop/2049`、提交 `0267a7d` 及当前工作区。本轮只交付审计文档，没有实现下述建议，没有付款、收费模型调用、提交、推送或发布。

**结论：已有值得复用的受控支付后端，但“用户委托 Agent 在明确边界内消费”的产品闭环尚未接通。** 当前最强的资产是不可变付款绑定、原子预算预占、一次执行权、原交易恢复；最大缺口是把可信用户授权、认证 Agent 与这条付款链路关联起来。继续增加行情、Provider 或支付轨道，不能解决这个缺口。

> 后续实现更新（同日）：本报告以提交 `0267a7d` 为审计基线。随后已完成 P0-1 的有限 `SpendGrant` 创建、主体绑定和策略验证；报告中“当前缺失”的描述保留为基线证据。MCP 购买工具、0.20/20 两档真实报价、实际 Codex 宿主购买和新的链上付款仍未实现或验收。

目标演示关键路径估计完成 **约 45%（合理区间 40%–50%）**；黑客松就绪度 **4/10**。这是针对本次“5 / 0.50 / 今晚到期 / 0.20 批准 / 20 拒绝”演示的工程判断，不是代码完成率、测试覆盖率或获奖概率。

## 0. 审计依据与本轮验证

检查了仓库的一方源码、所有现存 API 路由、Electron 壳、脚本、20 个测试文件、根目录计划及架构和运行文档、构建配置与依赖锁定版本。依赖只核对所用 SDK 的版本、接口和集成边界，不声称审计了全部第三方依赖源码。未读取真实私钥、连接凭据或付款载荷，也未把旧验收记录当成本轮链上证据。

| 本轮验证 | 结果 | 能证明什么 |
|---|---|---|
| `npm test` | 20 个文件，228 项通过 | 当前单元/集成测试通过；多数支付外部依赖被模拟 |
| `npm run typecheck` | 通过 | 当前 TypeScript 检查通过 |
| `npm run lint` | 通过 | 当前 lint 通过 |
| `npm run build` | 通过 | Next 生产构建通过；不是 Electron 安装包/启动验收 |
| 客户端 JS 指定敏感入口标识扫描 | 未命中本次扫描项 | 未发现指定钱包/数据库/凭据入口名称；不是完整秘密泄露证明 |
| 模拟记录跨模式重放探针 | 复现错误标注 | 内存账本、禁止网络；见安全问题 S2 |
| Electron 实机、实际 Codex 宿主、真实 Devnet 购买 | 本轮未执行 | 这些仍需新演示链路的实机验收 |

锁文件实际版本：`@x402/core` / `@x402/svm` 2.25.0，MCP SDK 1.27.1，OpenAI Agents SDK 0.17.0，Next 16.3.4，Electron 44.3.0。本轮 Node 为 25.9.0；项目要求 Node ≥24.5，`.nvmrc` 为 24。

工作区说明：开始时 `next-env.d.ts` 已有未提交改动。Next 构建自动重生成该文件，构建后它与 HEAD 一致。未提前保存原内容，因此不能确认原差异或声称已恢复；没有猜测性回填。这是本轮验证产生的副作用。

状态词含义：**IMPLEMENTED**＝代码已落地；**PARTIALLY IMPLEMENTED**＝仅部分目标/入口可用；**STUB / MOCK**＝模拟或固定演示数据；**MISSING**＝找不到可执行实现。IMPLEMENTED 不自动表示本轮真实环境验收通过。

## 1. 当前实际架构

当前是 Electron + Next.js 的本机模块化应用，不是链上权限合约，也不是云端授权服务。存在产品 App、只读 MCP、历史任务 Demo 和独立付款脚本四种入口；复用部分模块，不代表复用同一套权限与账本。

| 组件与代码 | 状态 / 责任 | 主要输入 → 输出 | 谁调用它 → 它调用谁 |
|---|---|---|---|
| [electron/main.cjs](/Users/irin/Desktop/2049/electron/main.cjs:22)、[preload.cjs](/Users/irin/Desktop/2049/electron/preload.cjs:5) | IMPLEMENTED：开发态窗口、托盘、单实例、后台服务、管理令牌与固定 IPC | 窗口/菜单/IPC 操作 → 本机服务与安全响应 | `app:dev` / renderer → Next 子进程、管理 API |
| [page.tsx](/Users/irin/Desktop/2049/src/app/page.tsx:1)、[app-dashboard.tsx](/Users/irin/Desktop/2049/src/app/app-dashboard.tsx:23) | IMPLEMENTED：钱包、每日额度、暂停、只读连接、测试购买列表；目标审计 UI 部分实现 | 后端 overview / 用户表单 → 展示与 IPC 请求 | 首页 → preload bridge；不导入签名器 |
| [management-auth.ts](/Users/irin/Desktop/2049/src/modules/app/management-auth.ts:4)、[local-request.ts](/Users/irin/Desktop/2049/src/modules/demo/local-request.ts:2) | IMPLEMENTED：管理 bearer、loopback Host、同源 JSON、跨站限制 | HTTP Request → 允许或异常 | `/api/app/*` → 本地请求检查、常量时间 token 比较 |
| [app-runtime.ts](/Users/irin/Desktop/2049/src/modules/app/app-runtime.ts:28) | IMPLEMENTED：产品业务组合与生命周期 | 购买号、origin、额度/暂停设置 → overview / 购买摘要 | 管理 API、Agent GET → 产品钱包、managed ledger、共用购买服务、原付款恢复 |
| [product-wallet.ts](/Users/irin/Desktop/2049/src/modules/app-wallet/product-wallet.ts:22)、[keychain.ts](/Users/irin/Desktop/2049/src/modules/payment/keychain.ts:35) | IMPLEMENTED：固定钥匙串钱包创建、读回复核、复用、公钥匹配 | 预期公钥 / 内部初始化 → 钱包公钥或内部 signer | AppRuntime、wallet loader → macOS `security`、Solana Kit |
| [connection.ts](/Users/irin/Desktop/2049/src/modules/mcp/connection.ts:17) | IMPLEMENTED：单个只读连接能力 | 管理启用/撤销、bearer → 验证结果、enabled/lastSeen | 管理 connection API、Agent API → 0600 描述文件、内存 token |
| [scripts/mcp.ts](/Users/irin/Desktop/2049/scripts/mcp.ts:7)、[server.ts](/Users/irin/Desktop/2049/src/modules/mcp/server.ts:6) | IMPLEMENTED：官方 SDK stdio 桥接；付款 MISSING | 两个无参数只读工具 → JSON 文本或脱敏错误 | Codex 配置启动 → 读取本地连接描述、GET Agent API |
| [market-quote.ts](/Users/irin/Desktop/2049/src/modules/purchases/market-quote.ts:7) | IMPLEMENTED：固定 API 的展示报价 | 本机 origin、支付配置 → 0.01 测试 USDC 摘要 | Agent `quote` → Paid API、官方 x402 解析；不创建购买/授权 |
| [purchase-market-snapshot.ts](/Users/irin/Desktop/2049/src/modules/purchases/purchase-market-snapshot.ts:33) | IMPLEMENTED：固定 SOL 购买编排；simulated 分支为 STUB / MOCK | `{purchaseId,intent}` + 可信配置/账本/模式 → reservation、reused、simulated | App 测试入口、旧 `runTask` → registry、preflight、402、adapter、ledger、付款或恢复 |
| [market-spend-adapter.ts](/Users/irin/Desktop/2049/src/modules/resources/market-spend-adapter.ts:8) | IMPLEMENTED：行情输入、固定资源/Provider、报价一致性 | 已选资源、SOL 请求、报价、绑定 → SpendIntent | 共用购买服务 → Zod 与哈希；不签名 |
| [spend-intent.ts](/Users/irin/Desktop/2049/src/modules/authority/spend-intent.ts:9)、[authority-policy.ts](/Users/irin/Desktop/2049/src/modules/authority/authority-policy.ts:43) | PARTIALLY IMPLEMENTED：通用消费意图与确定性额度决策 | intent、committed、unknown、controls、时间 → APPROVED / DENIED / REQUIRES_APPROVAL、reason | adapter / ledger → schema、纯规则；无 Agent/grant 用户授权模型 |
| [purchase-ledger.ts](/Users/irin/Desktop/2049/src/modules/purchases/purchase-ledger.ts:22) | IMPLEMENTED：SQLite 预占、去重、claim、状态、原凭据、结果与事件 | intent/quote、内部 approvalId、付款结果 → 持久记录、预算、事件 | App/任务/付款服务 → SQLite `BEGIN IMMEDIATE`；未形成完整委托审计 |
| [approved-payment.ts](/Users/irin/Desktop/2049/src/modules/purchases/approved-payment.ts:54) | IMPLEMENTED：执行内部批准、付款与交付分开记录 | 内部 approvalId + 可信配置 → 原交易/已校验数据 | 共用购买服务 → claim、绑定复核、signer、SDK、付费 HTTP、RPC、ledger |
| [solana-payment.ts](/Users/irin/Desktop/2049/src/modules/payment/solana-payment.ts:44)、[x402-client.ts](/Users/irin/Desktop/2049/src/modules/payment/x402-client.ts:15)、[payment-preflight.ts](/Users/irin/Desktop/2049/src/modules/payment/payment-preflight.ts:36) | IMPLEMENTED：x402 V2 exact、报价校验、模拟、签名、链确认；金额固定 | 已校验 requirement + 内部 signer → PaymentPayload / 确认状态 | 付款服务、独立 CLI → 官方 x402/SVM、Solana RPC |
| [paid-market-api.ts](/Users/irin/Desktop/2049/src/modules/paid-market-api/paid-market-api.ts:70)、[settlement-store.ts](/Users/irin/Desktop/2049/src/modules/paid-market-api/settlement-store.ts:24) | IMPLEMENTED：真实协议服务与持久结算去重；返回内容为 STUB / MOCK | SOL 请求、payment header、恢复标记 → 402 / 200 / 202 / 错误 | 付款 HTTP route → 官方 ResourceServer、Facilitator、SQLite、原交易对账 |
| [reconcile-transaction.ts](/Users/irin/Desktop/2049/src/modules/payment/reconcile-transaction.ts:18)、[read-market-snapshot.ts](/Users/irin/Desktop/2049/src/modules/resources/read-market-snapshot.ts:4) | IMPLEMENTED：核对原交易消息、签名与链结果；有界读取交付 | 原消息哈希、签名/memo 或 HTTP body → CONFIRMED/FAILED/UNKNOWN 或严格数据 | 付款恢复 / 测试 Paid API → RPC / 输出 schema |
| [task-runtime.ts](/Users/irin/Desktop/2049/src/modules/agent/task-runtime.ts:20)、`src/modules/agent/` 其余文件、`src/modules/resources/` 发现文件 | IMPLEMENTED：旧任务规划、唯一资源匹配、付费数据生成回答；本地规划为确定性 Demo | taskId / 文本 → 需求、购买结果、缓存回答 | `agent-task.ts`、`task-worker.ts` → planner、静态 registry、共用购买服务、无工具 analyst |
| [demo-store.ts](/Users/irin/Desktop/2049/src/modules/demo/demo-store.ts:35)、[trace.ts](/Users/irin/Desktop/2049/src/modules/demo/trace.ts:1)、[task-console.tsx](/Users/irin/Desktop/2049/src/app/task-console.tsx:48) | PARTIALLY IMPLEMENTED：旧任务事件持久化/展示组件存在，当前页面未挂载 TaskConsole | 任务/安全事件 → 任务历史、分析、旧 feed | 旧任务 route / worker → 单独 Demo DB、旧 purchase DB；UI 轮询，不是 SSE |
| [scripts/pay.ts](/Users/irin/Desktop/2049/scripts/pay.ts:15)、钱包初始化/账户/localnet 脚本 | IMPLEMENTED：开发测试设施，不是 Agent 产品权限入口 | 本机配置/显式命令 → 测试钱包准备、独立支付日志/验收 | npm 命令 → signer、RPC、测试 API；`pay.ts` 不经过 Authority Core |

**真实存在的 HTTP 路由：**

| 路由 | 当前能力 / 边界 |
|---|---|
| `GET /api/app/health` | 管理认证；触发启动恢复，返回 ready；ready 不等于外部付款环境就绪 |
| `GET /api/app/overview` | 管理认证；钱包、预算、购买列表、连接状态 |
| `PUT /api/app/settings` | 管理认证；仅 dailyLimit 或 paused；无 singleLimit/provider/expiry |
| `PUT /api/app/connection` | 管理认证；启用/撤销单个只读连接 |
| `POST /api/app/test-purchases` | 管理认证；仅 purchaseId；默认模拟，显式环境开关才真实 Devnet |
| `POST /api/app/lifecycle` | 管理认证；prepareQuit，停新付款并等待活动操作 |
| `GET /api/agent?operation=status\|quote` | Agent bearer；仅两个读操作；无购买 POST |
| `GET /api/paid/market-snapshot?asset=SOL` | 测试商家端；402、付款验证/结算、原凭据恢复 |
| `GET/POST /api/demo/tasks` | 旧任务查询/启动；本机/同源检查，不要求管理或 Agent token |
| `POST /api/demo/preflight` | 旧环境检查，包含真实模型调用；不能等同于免费离线检查 |
| `POST /api/discover` | 旧资源发现；可调用模型；没有产品管理/Agent 认证 |

**当前执行流：**

```text
产品 App：
Electron → IPC → 管理认证 → AppRuntime → 产品钥匙串钱包 + app-ledger.sqlite
  └─ 测试购买 → purchaseMarketSnapshot
       ├─ 默认 simulated → 本地合成报价 → policy/reserve → 合成 PAID + fixture
       └─ live_devnet → preflight → 固定 402 → adapter → policy/reserve
            → claim(approvalId) → 绑定/暂停/额度复核 → SDK 模拟/签名
            → 持久保存原 payload → PAYMENT-SIGNATURE
            → 测试 Paid API → 官方 Facilitator verify/settle → Solana Devnet
            → 回执 + 原消息链上核对 → PAID → 校验 JSON → COMPLETE

当前 Codex：
宿主配置 → stdio MCP → 读取并缓存连接文件 → bearer GET /api/agent
  ├─ status → 钱包/预算，paymentEnabled=false
  └─ quote → 真实 402 摘要，confirmation=NOT_IMPLEMENTED
  到此结束；没有进入 policy/reserve/付款的 MCP 工具。

历史任务：
CLI 或旧 tasks API/worker → 模型或本地 planner → 静态资源发现
  → purchaseMarketSnapshot（相同函数，但另一个 unmanaged ledger）
  → 付款/缓存 → 无工具模型使用数据回答
```

注意：源码注释“Shared App/MCP-facing purchase entry”不代表 MCP 已接入；只有调用点才是实现证据。`createResourceDiscoveryTool()` 也存在，但现有 `runTask()` 是在结构化规划后由代码调用发现流程，并非模型自由调用一组付费工具。

## 2. 今天具体能跑什么

| 问题 | 判断 | 代码事实与限制 |
|---|---|---|
| Agent 能发现后端吗？ | PARTIALLY IMPLEMENTED | `scripts/mcp.ts` 从预知的数据目录读 `{origin,token}`；宿主须先配置 stdio、用户启用连接。没有自动扫描/配对/网络发现 |
| 能认证吗？ | IMPLEMENTED，只读 bearer | `AgentConnection.authenticate()` 检查 loopback、无 Origin、常量时间 token；证明持有凭据，不能证明调用者确为 Codex 或真实用户同意 |
| 能读钱包和预算吗？ | IMPLEMENTED | Agent status → `AppRuntime.overview()`；余额查 Devnet RPC；失败明确 unavailable；没有授权规则的完整摘要 |
| 能读报价吗？ | IMPLEMENTED | `get_market_quote` → `readMarketQuote()` 获取真实 402；仅固定 SOL/0.01；报价不被保存为可供下一步引用的 quoteId |
| 能请求购买吗？ | 当前 Codex：MISSING | `server.ts` 只有两个读工具，Agent route 只有 GET。App 测试入口和旧任务 CLI 可以触发购买，不能算 Codex 产品付款 |
| 有 policy decision 吗？ | IMPLEMENTED，覆盖有限 | `evaluateSpendAuthority()` 校验 intent、有效期、unknown、暂停、日额度、单笔；没有 grant、主体、用户配置 API allowlist、operation 或授权到期 |
| 能真实付款吗？ | IMPLEMENTED，条件式 | App live_devnet 与旧 CLI 有实际签名/结算实现；需有效配置、钥匙串、余额及外部服务。正常 App 启动默认模拟 |
| x402 是否真的集成？ | IMPLEMENTED | 官方 client / HTTP client / SVM scheme / ResourceServer / HTTPFacilitatorClient 实际参与。不是仅把状态码写成 402 |
| 是否结算到 Solana？ | 有真实 Devnet 实现及历史验收；本轮未重验 | `receivePayment()` 独立核对原消息；[付款运行记录](/Users/irin/Desktop/2049/docs/demo/payment-runbook.md)记录旧 CLI 与 App M3 的真实交易及余额差。`loadPaymentConfig()` 拒绝主网 |
| 能拿到资源吗？ | IMPLEMENTED，内容为 fixture | 严格 JSON schema + 16 KiB 流式上限；固定 `2026-09-05` 历史 SOL 快照，不是第三方实时数据 |
| 有 receipt 吗？ | PARTIALLY IMPLEMENTED | 服务端保存完整结算回执；客户端保存交易 ID、购买条件、数据。没有产品级统一 receipt 查询工具/详情页；App 列表不显示交易链接 |
| 有 audit log 吗？ | PARTIALLY IMPLEMENTED | purchases.decision + purchase_events；旧 Demo 还有事件表。缺 agent/grant/policy version/逐条 rule results，缺授权修改和撤销审计；App 不展示 decision reason |
| 能撤销权限吗？ | 连接撤销 IMPLEMENTED；消费委托 MISSING | disable 删除文件并清空 token；re-enable 轮换，旧 MCP 缓存不自动换新。暂停能阻止 App 后端新付款；尚无可撤销消费 grant |
| 能在 Codex 原对话确认吗？ | MISSING | 仓库没有 elicitation/可信确认落地。[MCP 文档](/Users/irin/Desktop/2049/docs/architecture/mcp-integration.md)记录 9 月 20 日宿主开关限制，本轮未检查当前开关，不能断言今天仍关闭 |

可以诚实展示：App 管理流程、默认模拟购买、配置后的 MCP 两个读工具；也可以按明确测试授权单独验收真实 Devnet 购买实现。**不能诚实展示为已完成：用户设定委托 → Codex 请求 0.20 → 自动批准并付款 → Codex 得到资源 → 20 被拒绝且有可视证据。**

历史文档存在失同步：README/docs 索引仍写 MCP 未实现；计划和 MCP 文档已有只读验收；旧 demo-runbook 写首页为 TaskConsole，但当前 `page.tsx` 仅渲染 AppDashboard。当前构建也只有 `/` 页面，没有历史任务页面路由。代码存在、历史验收通过、当前入口可访问，必须分开说。

## 3. 产品意图与此次定位的差距

从文档与代码演变看，项目经历了三步：固定行情自动购买 Demo → 本地消费钱包与管理 App → 从行情规则中抽出 Authority Core。方向与“经济权限层”一致，但当前交付仍更接近“带预算的本机测试购买服务”。

| 目标约束 | 当前事实 | 与定位的差距 |
|---|---|---|
| 总预算 | App 可设每日共享额度 | 不是某次授权生命周期内累计上限；午夜可进入新窗口，不能直接叫“本次委托总额” |
| 单笔限制 | 固定 100000 最小单位，即 0.10；可作为纯函数 controls 传入 | 没有用户设置/持久化入口；超过单笔但未超日额是 REQUIRES_APPROVAL，不是硬拒绝 |
| Provider / domain / API | adapter、registry、endpoint 硬编码一个资源和 Provider | 是开发者约束，不是用户可配置的委托范围；通用 policy 本身不校验这些白名单 |
| 操作类型 | 固定 GET + SOL 输入 | 有实际收窄，但没有授权中的 operation 字段或规则 |
| 到期 | intent 有最长约 5 分钟有效期 | 这是报价/执行意图到期，不是“用户授权今晚失效” |
| 撤销 | 全局只读连接撤销与 App 暂停 | 没有针对消费 grant 的撤销和在途复核 |
| 读与付款能力分离 | 当前所有 MCP 工具只读，管理通道分开 | 没有可识别的 payment capability；不能直接把只读 token 升级为花钱权限 |
| 解释与审计 | 单个 reason code、金额前后值、状态事件 | 缺完整用户授权来源与规则快照，App 没展示原因 |
| 不把钱包交给 Agent | MCP 无私钥/任意签名工具，专用钱包在后端 | API 边界做对了；同一 macOS 用户可读文件/运行程序的恶意进程不在防御范围，不能宣传 OS 级沙箱或链上委托 |

`SpendIntent` 是已校验的消费事实，`AuthorityDecision` 是规则结果，`approvalId` 是内部一次执行凭据。**三者都不能代替一份“谁在什么时候授予这个 Agent 什么范围”的用户授权记录。**

## 4. 精确演示的阻断与最短路径

目标应明确标为：**Solana Devnet 测试 USDC，5.00 总额度，0.50 单笔硬上限，一个允许的演示 Provider/API，用户选定的今晚截止时间。** 0.20/20 是 API 的真实 x402 报价，不是模型传入的付款金额。

主要阻断：

1. 无消费 grant 的创建/持久化/身份绑定/到期/撤销链路。
2. 无 MCP 购买与购买查询工具。
3. 价格多处固定 0.01：`payment-config.ts`、`paid-market-api.ts`、`static-resource-registry.ts`、`selectPaymentQuote()`、`prepareSolanaPayment()`、preflight 和文案。只改一个常量不够。
4. 20 报价目前会在固定价格校验处抛错，根本到不了策略；这不能冒充“预算规则拒绝”。
5. 单笔固定 0.10；即使放开 0.20 报价，现有规则也会 REQUIRES_APPROVAL。
6. 查询报价与购买各自重新取报价，缺可引用、不可变的同一购买身份。
7. UI 不显示 Agent 请求、授权范围、决策依据、资源内容或完整 receipt。
8. 旧入口的独立规则/账本与模拟记录混用问题必须处理，否则产品承诺不可信。

**建议的范围调整：采用 App 中用户主动创建有限委托，随后 Agent 在委托内自动购买。** 这符合本次“用户先配置约束”的演示，比先实现每笔宿主对话确认更短。它与 `plan.md` 原先坚持 Codex 原对话确认的路线不同；这里明确提出调整建议，不把它当成已经实施，也不把启用只读连接或填写每日额度解释成付款同意。如果保留原计划的原对话确认要求，M4 的真实宿主确认验证仍然是前置阻断，不能偷偷用 App 弹窗替代。

最小方案保留单个活跃连接、一个消费钱包、一个 Provider、一种资产、一条支付轨道。新增一个可撤销、到期的 grant，不建设通用 IAM、工作流引擎、Provider 插件框架或新 Solana Program。

为了同时展示两种价格，给同一个测试 API 增加两个服务端定义的 offer，例如 basic=0.20、premium=20。Agent 只选 offer/resource ID；后端决定路径、请求参数、商家和报价绑定。两种报价都须通过协议与资源身份校验，再交给额度规则判断。保留原 0.01 URL/报价的恢复兼容，不改写旧订单。

实际流应为：

```text
用户在 App 创建受限 grant
→ 认证 Agent 请求固定 offer，附稳定 requestId 与用途摘要
→ 服务端取 402、验证并保存同一 purchaseId/报价
→ 在 SQLite 事务中读取 grant + 共享额度、形成决策和预占
→ APPROVED 才 claim、复核 grant/连接/到期/暂停/预算并签名
→ 官方 x402 支付 → 原交易确认 → 资源校验 → 持久回执
→ Agent 取结果，App 显示同一购买记录
```

20 拒绝不应要求钱包先有 20 的余额。应将“获取报价/验证网络和对端身份”与“已批准付款的余额和模拟预检”分开；政策拒绝路径不读取签名器、不执行转账。

## 5. 优先级

| 级别 | 范围 |
|---|---|
| **P0：本次演示必须有** | 可信有限 grant；关闭产品运行中的旧付款旁路；模拟与真实隔离；认证 MCP 请求/查询；0.20 与 20 的真实报价；金额与不可变报价绑定；原子预算和单笔硬上限；到期/撤销复核；批准和拒绝都落审计；最小 UI；实际宿主与 Devnet 验收 |
| **P1：显著增强提交** | 第三方 API 小额验证；持久 3–5 次交付恢复；在保留原产品路线时实现可信宿主确认；第二个连接验证共享预算；可导出的脱敏证据；开发环境之外的可安装包；更完整稳定错误码/外部响应上限 |
| **P2：演示前不要做** | 多链、多钱包、多资产、链上权限 Program、通用 policy DSL、Provider 市场/动态发现、Jev/其他支付轨道、远程账户体系、复杂 Agent 编排、实时行情、退款、动画和品牌装修 |

主网不是本次 Devnet 演示的 P0。若参赛规则另有主网要求，再核对要求并另取具体交易授权；本审计未研究或声称当前赛事规则。不要把后续 App 全路线 M0–M7 当成本次演示必须完成的范围。

## 6. P0 的顺序实施计划

以下文件名中标注“新建”的是建议，不是仓库现有能力。每步都形成可验证的纵向结果；前一步不会为了先接线而放开无授权付款。

### P0-1：用户能创建一份真实有效的有限消费委托

- **构建内容：** App 的“授权本次消费”表单，存总预算、单笔硬上限、固定 Provider/API、固定 operation、网络/mint/decimals、明确截止时间、主体/连接绑定和授权版本；默认无 grant。为演示只支持一个活跃 grant，不做多租户。
- **改现有：** `app-dashboard.tsx`、`electron/main.cjs` IPC allowlist、`app-runtime.ts`、`mcp/connection.ts`、`authority-policy.ts`、`purchase-ledger.ts`；产品运行时封闭 `api/demo/tasks`、`api/demo/preflight`、`api/discover`，阻止测试付款入口绕过新授权。
- **新建：** `src/modules/authority/spend-grant.ts`；`src/app/api/app/grant/route.ts`；明确编号的 SQLite 迁移（按仓库简洁实现，可由 ledger 执行，不能删库）。
- **输入：** 仅经管理认证的用户操作。金额整数字符串：总额 `5000000`、单笔 `500000`；选择受控 API/operation；后端验证 expiresAt，保存准确时间及时区展示。Agent 不得提交 grant 成功标志。
- **输出：** grantId/version/status/scope/expiry 安全摘要；对应审计事件。连接身份与用户授权为不同对象；旧只读 credential 保持只读或在显式授权时轮换为绑定 grant 的新 credential。
- **依赖：** 当前管理认证、连接、SQLite 和 Authority Core；不依赖链上购买。
- **完成判据：** 真实 App 管理操作可保存并读回；内存/隔离账本的 0.20 得 APPROVED、20 得 DENIED；无 grant、读权限、过期、错误 API/operation 均不可 claim；重启后记录存在但旧连接凭据失效。测试 signer 调用为 0。
- **必须保留：** App 现有共享日额度作为另一道上限；grant 总额按授权生命周期累计，不随午夜清零。预占同时计入这两个约束。金额使用 bigint 或校验整数字符串；已有 number 记录经兼容读取保留，避免全仓泛化迁移。

### P0-2：真实 Agent 请求可以到达策略，并展示 20 的拒绝

- **构建内容：** prepare/request/query 最小 MCP 接口，真实 HTTP 402 的 basic/premium 两个报价，后端创建并持久绑定 purchaseId；先贯通完整拒绝路径，批准路径此步停在可查询 reservation。
- **改现有：** `mcp/server.ts`、`scripts/mcp.ts`、`app-runtime.ts`、`purchase-market-snapshot.ts`、`market-quote.ts`、`market-spend-adapter.ts`、`static-resource-registry.ts`、`resource-schema.ts`、Paid API handler/route、`purchase-ledger.ts`。
- **新建：** `src/app/api/agent/purchases/route.ts`（或同等小型专用路由）；报价可继续存在 purchase 记录，不另建泛化报价服务。新增对应 Agent purchase 集成测试。
- **输入：** MCP `{requestId, resourceId/offerId, input, reason}`；连接主体从认证上下文派生，禁止 amount/payTo/URL/raw transaction/approved。
- **输出：** `{purchaseId, decision, ruleResults, paymentStatus, deliveryStatus}`；查询只取原结果，不另建购买。每个理由来自后端规则。
- **依赖：** P0-1。若 MCP 超时，也须能用相同 requestId/purchaseId 查询；不得让重试改为新 ID。
- **完成判据：** 通过 stdio 发起 premium 请求，服务端拿到 `20000000` 的合法 402，记录 DENIED 与预算/单笔规则失败；没有 signer、SDK 创建付款载荷或 settle 调用。重放不增加记录；换请求内容或越权读取另一连接购买被拒绝。0.20 的报价记录可查询。

### P0-3：0.20 在同一授权边界内完成一次真实支付

- **构建内容：** 将固定 0.01 支付边界改为“已保存且批准的该笔金额”，沿用官方 SDK、预占、claim、原载荷恢复；隔离模拟与真实记录及预算。
- **改现有：** `purchase-market-snapshot.ts`、`approved-payment.ts`、`solana-payment.ts`、`payment-preflight.ts`、`payment-config.ts`、`paid-market-api.ts`、`purchase-ledger.ts`、App 测试入口。不得仅删除金额检查。
- **新建：** 模式标识/隔离所需显式迁移；支付模式和价格兼容回归用例。可采用独立模拟账本，但已存在的混合历史记录须识别、保留，未知记录不能当模拟删除。
- **输入：** 内部 approvalId，由服务端回读 immutable intent/quote/grant；不是 Agent 提交的新金额。
- **输出：** Devnet 原交易确认、准确 `200000` 最小单位、校验资源、独立付款/交付状态。
- **依赖：** P0-1、P0-2；SDK 2.25.0 已有 `setSpendControls`、`registerPolicy`、creation hooks，仓库已使用前两者。扩展已批准金额和资产限制即可，无需自己实现协议库。SDK hooks 不能代替授权证明或 DB 原子预占。
- **完成判据：** 自动化验证 0.20 金额在客户端、服务端、SDK 限制、回执和账本一致；条件变化失败；模拟记录不能在 live 返回真实 PAID；同购买并发/重试只签名结算一次。具体 Devnet 授权后验证余额差，不能只看 HTTP 200。
- **恢复兼容：** 旧 0.01 订单仍按原 URL、报价、金额和凭据恢复，不被新价格或新 grant 改写。新增规则只约束新执行，已提交交易继续对账。

### P0-4：一屏看见请求、规则、付款和资源

- **构建内容：** App 复用购买账本的详情投影，MCP 查询返回同一份安全结果；批准/拒绝均可展开，永久保留当次规则快照。
- **改现有：** `purchase-ledger.ts` 的 list/events 投影、`app-runtime.ts`、overview 或详情 route、`app-dashboard.tsx`、preload IPC allowlist、MCP 查询。
- **新建：** 可选 `src/modules/purchases/purchase-view.ts`（只做安全投影）；需要详情时新增管理认证的 purchase detail route。不为此加 SSE/消息队列。
- **输入：** purchaseId；从持久事实读取，不用前端或模型补编理由。
- **输出：** Agent/连接标识、资源/用途、价格、grant/version、各规则实际值与上限、预算前后、decision、payment/delivery、transaction、资源摘要、事件时间；绝不返回原 payment payload 或内部 approvalId。
- **依赖：** P0-2、P0-3，审计事实已随每步写入。
- **完成判据：** 0.20 条目显示批准依据、Devnet 交易和数据；20 条目显示失败规则、付款未开始、实付 0；刷新可恢复，模式逐笔标注。资源同时返回实际宿主，证明不是仅 UI 声称交付。

### P0-5：把撤销、到期和失败边界验收到签名/提交处

- **构建内容：** 在 reserve、claim、实际签名前和 payload 提交前复核 grant/connection generation、到期、暂停和预算；明确已提交交易只能继续对账。状态查询/恢复不扩大付款权。
- **改现有：** `connection.ts`、grant 服务/route、`purchase-ledger.ts`、`approved-payment.ts`、`app-runtime.ts`、相关 tests。
- **新建：** `tests/integration/agent-authority.test.ts` 等少量边界测试；不建设通用测试平台。
- **输入：** 同一购买的重放、并发请求、授权撤销/过期、暂停、超时、重新启动。
- **输出：** 稳定拒绝码或原购买状态；已知/未知付款保留原 transaction/payload；没有新交易。
- **依赖：** P0-1 至 P0-4。前几步已实现各自检查，此步覆盖跨模块竞态和故障，而非到此才补安全。
- **完成判据：** 无凭据、只读 credential、旧 credential、撤销后、过期后、改收款方/资产/报价、重复 claim、同键异参、并发预算不足全部被挡；断网后 UNKNOWN 保留预算；重启后原交易恢复；暂停/撤销确认后不能开始新的签名提交。旧路由不能绕过产品规则。
- **取舍：** 保留当前“未知付款全局冻结”的保守策略即可。3–5 次自动交付恢复可放 P1，但 P0 必须有安全的原购买查询/恢复与明确 pending，绝不能以重新购买作为恢复。

### P0-6：在真实 Codex + App 上完成两案并固化证据

- **构建内容：** 当前版本演示脚本/操作说明和脱敏验收证据；纠正首页、MCP、模拟/真实、历史验收等文档失同步。
- **改现有：** README、plan.md、mcp-integration.md、demo runbook；仅据新验证结果更新状态。
- **新建：** `docs/demo/authority-demo-runbook.md`；有必要才加受控验收脚本。涉及付款脚本不能由普通测试自动执行。
- **输入：** 用户经 App 设置的 5/0.50/允许 API/今晚到期 grant；两个不同购买的稳定 ID。链上验收需具体 Devnet API、用途与金额授权，不从本审计推导授权。
- **输出：** 0.20 成功/20 拒绝的实际宿主记录、App 两条记录、真实 TX/余额差、重复查询无新增付款证据、录屏。
- **依赖：** 前五步及可用测试余额/Facilitator/RPC；不能用旧截图或模拟 MCP 测试替代。
- **完成判据：** 实际宿主请求并收到资源；20 在 policy 层拒绝且余额不变；同 ID 重试、关闭窗口、完整退出重启、撤销后旧宿主请求均按预期。相关测试、typecheck、lint、build 与 Electron 启动检查通过；安装包不是这一演示的前提。

## 7. 安全与架构审查

### S1 — P0：旧任务路由构成产品策略旁路风险

证据链：[旧 POST route](/Users/irin/Desktop/2049/src/app/api/demo/tasks/route.ts:37) 仅 `requireLocalRequest`，随后启动 worker 并传递 `process.env`；[worker](/Users/irin/Desktop/2049/scripts/task-worker.ts:13) 创建默认 `new PurchaseLedger()`；[默认 controls](/Users/irin/Desktop/2049/src/modules/purchases/purchase-ledger.ts:76) 是单笔 0.10/日额 1、paused=false；[产品钱包初始化](/Users/irin/Desktop/2049/src/modules/app/app-runtime.ts:41) 又把产品公钥与钱包选择标志写到进程环境。

因此在模型配置、可达的本机 Paid API 等前提满足时，旧 worker 可继承产品 signer 选择，却走另一份预算与暂停规则。本轮没有以真实资金执行该攻击，不声称当前环境必然已可被扣款；**入口认证缺失和规则隔离失效是已确认的代码事实。** Origin 防跨站不等于认证本地进程，原生 Agent HTTP 客户端可以自行填写 Origin。

最小修复：产品进程直接禁用旧任务/模型检查入口；隔离测试工具的 signer 选择；若保留产品入口，必须接入同一个受认证 AppRuntime/grant/ledger，不能仅补一个 token 后继续用旧账本。

### S2 — P0：模拟与真实状态混在同一账本，已复现误标

证据：[模拟分支](/Users/irin/Desktop/2049/src/modules/purchases/purchase-market-snapshot.ts:95) 调用 `finish()` 写 PAID 与 `simulated-${id}`；[重放分支](/Users/irin/Desktop/2049/src/modules/purchases/purchase-market-snapshot.ts:46) 以当前调用 mode 返回 simulated；[paymentBinding](/Users/irin/Desktop/2049/src/modules/purchases/approved-payment.ts:17) 不包括模式；App 列表也没有每条 mode。

本轮纯内存探针：先模拟 purchaseId=`audit-simulation-replay`，再 live_devnet 读取同一 ID，得到：

```json
{"status":"PAID","simulated":false,"transaction":"simulated-audit-simulation-replay","reused":true}
```

网络调用数为 0，账本 paid 为 `10000`。问题是模拟结果冒充真实状态、污染真实预算与审计，不是这次探针发生了转账。最小修复为模式持久化/账本隔离、执行绑定与查询一致性、旧模拟记录保守迁移、UI 逐笔标注。

### S3 — P0：不要把 connection token 当经济授权

现在 token 为 32 字节随机值，落盘 0600；重启撤销、重新启用轮换、MCP 会话缓存旧值，设计合理。缺 TTL、每 Agent 独立身份、payment scope；origin 仅表示后端地址，不是宿主身份。最短补充为一个连接 ID/generation + 明确 capability + 独立 grant。无须为演示上 OAuth 或完整 RBAC。

同一 macOS 登录用户下可读取描述文件或调用钥匙串的进程不在隔离边界内；文档已经承认这一点。对外声称应限于“Agent 通过受控 MCP 不获得私钥或任意签名接口”，不要扩张成“任意具有本机 shell 权限的恶意 Agent 都无法动钱包”。

### S4 — P0：授权撤销/到期必须贯穿等待与签名

现有 `claim()` / `assertCanSign()` 很好地覆盖暂停、报价到期、实时额度与退出。但没有 grant 可检查，也没有 connection/grant 绑定在 `SpendIntent` 中。以后在 HTTP 层认证一次，等网络请求结束再直接付款，会留下撤销与到期窗口。沿用现有最后签名前/保存载荷前的同步复核点，增加 grant/连接有效性，不另建调度系统。

### S5 — P0（限本次触及字段）：金额与预算语义要收紧

当前 amount/预算使用 `number` 安全整数校验，5 USDC 这类小额计算没有已证明的舍入错误；不能把它描述成已发生金额漏洞。但它不符合项目要求的 bigint/校验整数字符串内部约定，`committed + amount` 的总和也未独立验证 safe integer。新 grant、金额参数化及审计 DTO 应统一整数表示，并验证累计边界；不必借机开发多资产账本。

`REQUIRES_APPROVAL` 表示超出自动批准门槛，不能拿它充当单笔硬拒绝。“0.50 单笔硬上限”须明确 DENIED。20 同时超单笔和总额；现有 policy 先检查 daily budget，只会返回首个原因。UI 若显示两个拒绝原因，须由后端保存两个真实 rule results，不能自行推测。

### S6 — P0：UI 购买身份不能在超时/刷新后悄悄换新

[AppDashboard](/Users/irin/Desktop/2049/src/app/app-dashboard.tsx:28) 的 purchaseId 仅在组件状态中；刷新会新建，成功 HTTP 响应后也立即换号，且没有按购买状态分别处理。现有账本保证“同一 ID 一次执行”，不保证“重新生成 ID 仍算原购买”。未来 MCP/界面应持久保存 pending ID，并查询原购买直到确定终态；新购买须是新的明确请求。未知付款不能靠 UI 换号恢复。

### 已有安全基础应保留

- 管理与 Agent bearer 分离；renderer 不拿管理 token；固定 IPC 路径；无任意签名工具。
- 产品钥匙串固定项目，读取失败不换钱包，signer 必须匹配预期公钥。
- 付款先 `reserve → claim → 绑定复核`，amount/payee/network 不由模型指定。
- SQLite `BEGIN IMMEDIATE` + 唯一 task/approval；不是“查余额然后独立写入”。两个 DB 连接测试、同 ID 并发和重启用例已覆盖重要基础，但不等于新 grant 并发已验证。
- 买方持久原 payload；商家持久 UNKNOWN claim + 唯一 quote/message；UNKNOWN 不释放预算、不生成替代付款。
- RPC 证明原消息和交易签名；finalized 失败才释放；付款确认与交付完成分开。
- strict schema、金额/网络/mint/payee 校验、付费 JSON 流式大小限制、禁止模型选择任意 URL。

### P1：真实但不值得演示前做成大型工程的问题

- `managementError()` 返回原 Error.message；`/api/discover` 打印原异常，应换固定错误码/脱敏消息，特别是继续开放旧路由时。
- `solanaRpc()` 未统一 redirect/error、响应体上限和运行时 schema；余额查询是完整 `text()` 后才看长度。外部调用边界可逐个收紧，无须新 HTTP 框架。
- 签名载荷保存后、实际 HTTP 提交前崩溃，商家可能没有 claim；当前恢复会保守冻结，避免重复扣款，但不保证自动完成。UI 必须呈现 unresolved；不得通过删除记录解决。
- 买方恢复依赖自建 Paid API 的 `PAYMENT-RECOVERY` 行为和缓存。它是本仓库的恢复约定，不能宣传任意第三方 x402 API 都支持。
- `purchase_events` 是本地操作历史，不是防篡改审计日志。黑客松不需要加哈希链或链上日志，只需保存完整、可核验的决策事实。
- 大量状态仍是字符串，账本交付仍为 MarketSnapshot 类型。这是可维护性债务，不是需要立即做通用架构重写的理由。

## 8. 让评委 30 秒理解的最小 UI

沿用 AppDashboard；旁边放实际 Codex 对话。App 不内置新聊天或行情终端，不重新挂旧无认证 TaskConsole 充当产品入口。

**顶部一张授权卡：** “此 Agent 可花总计 5.00 test USDC / 单笔 ≤0.50 / 允许 Demo Market API / 仅购买快照 / 截止具体日期时间 / Solana Devnet”；下面是已花、预占、可用、暂停和撤销。

**下方两条可展开请求：**

| 可见阶段 | 0.20 请求 | 20 请求 |
|---|---|---|
| AGENT REQUEST | 请求 basic 快照；用途与购买 ID | 请求 premium 快照；用途与购买 ID |
| PRICE | 服务端真实 x402 报价 0.20 | 服务端真实 x402 报价 20.00 |
| POLICY EVALUATION | API/operation/expiry 通过；0.20≤0.50；额度足够 | 20>0.50，且超过可用总额度；显示真实失败规则 |
| APPROVED / DENIED | 绿色 APPROVED，注明 grant/version | 红色 DENIED，固定原因 |
| PAYMENT | 原交易已 confirmed；交易 ID/Explorer | 未签名、未提交；实付 0 |
| RESOURCE | 已校验 JSON 摘要；注明历史 fixture | 未购买，没有资源 |
| AUDIT / RECEIPT | 时间、金额、余额前后、依据和 TX | 时间、报价、失败依据、无 TX |

关键是**两案都用同一真实服务和同一权限边界**。拒绝不能靠前端隐藏按钮、Prompt 告诉模型不要买、伪造昂贵报价，或在 SDK 固定金额校验失败后写“政策拒绝”。如果所有规则只保留一个主拒绝原因，界面就只显示这个有证据的原因。

无需动画。沿用安全轮询即可；当前 30 秒 overview 间隔应在有进行中购买时缩短，或 mutation 后刷新。Electron 当前禁止新窗口；若增加交易外链，使用仅允许正确 Explorer 域名/Devnet 交易路径的主进程打开动作，不开放任意 `openExternal`。

## 9. 面向评委的产品叙事

以下是**完成上述演示后的建议话术**，不是对当前完成度的陈述。

**一句话：** 2049 让用户把有限的消费权限交给 AI Agent：能买什么、最多花多少、何时失效，由本地后端执行，Agent 不拿钱包私钥。

**20 秒解释：** x402 处理 Agent 怎样为 API 付款。2049 把用户允许的消费范围变成每笔请求必须通过的规则：预算、单笔上限、允许的 API 和到期时间。通过才签名付款，拒绝就不动钱；每次决定都能看到依据。

**60 秒演示：**

- 0–12 秒：在 App 展示并确认“5 总额、0.50 单笔、一个 API、今晚到期”的授权。
- 12–32 秒：Codex 请求 0.20 的快照；App 显示报价、规则通过、Devnet 原交易确认、资源交付，Codex 使用返回数据。
- 32–47 秒：Codex 请求 20 的资源；App 明确显示失败规则、无签名提交、实付 0；余额与消费不增加。
- 47–60 秒：重读第一笔返回同一 receipt、不再付款；展示撤销按钮与两条可追溯记录。若实际网络较慢，等待真实状态，或使用明确标注的真实验收录像，不能按秒数伪造成功。

**技术差异：** 不可变消费事实 + 可信用户 grant + 原子共享预算 + 一次执行权 + 原交易恢复，由同一本地后端约束所有产品入口；x402 继续负责协议与支付。

**为什么超出 x402 wrapper：** 项目已有的价值是跨请求的持久预算、幂等、暂停和 UNKNOWN 恢复；需要补成产品的价值是用户可配置并撤销的授权、主体绑定和决策解释。不要把官方 SDK 已提供的单笔/资产限制冒充独有技术。

**最难的技术部分：** 在并发、撤销、到期、暂停、超时和重启交错时，让“仍被授权”“已预占”“签名/提交开始”“链上已付”“资源交付”保持一致；既不能越权花钱，也不能因为没收到响应再付一次。

边界必须公开：当前方案为本机软件执行权限、Devnet 结算、固定演示数据；不是链上强制授权，也不是生产级防恶意本机进程的钱包。

## 10. 最终评估与下一步

**CURRENT STATE：约 45%。** 为避免凭感觉把支付底座误当完整产品，可按以下权重理解这一估计：

| 关键路径 | 权重 | 现有可复用程度折算 |
|---|---:|---:|
| 本地 App / 钱包 / 管理边界 | 15 | 12 |
| MCP 连接 / 只读查询 | 10 | 9 |
| 用户可配置有限委托 | 20 | 2 |
| 两种价格的可信报价 / 固定请求 | 10 | 4 |
| 原子 policy / 预算 / claim | 10 | 8 |
| 目标金额付款 / 恢复 | 10 | 7 |
| MCP 购买与结果闭环 | 10 | 0 |
| 决策 / 回执 UI | 10 | 2 |
| 本次精确 Demo 的实机验收 | 5 | 1 |
| 合计 | 100 | 45 |

这是实现基础的主观加权估计；精确目标演示的完整 E2E 验收次数目前没有本轮证据。已有旧验收只计入基础，不等于新流程成功。

**BIGGEST BLOCKER：没有一条把可信用户消费授权绑定到认证 Agent，并强制应用于购买执行的完整路径。** 不是缺一个新 SDK，也不只是多注册一个 MCP 工具。

**NEXT TASK：完成 P0-1——用户在 App 明确创建受限 grant，后端持久保存并用于原子批准/拒绝；无 grant、只读连接、错误 API 和过期请求都不能进入付款。** 同时封住产品中的旧任务旁路。先以不付款的隔离验收证明授权边界。

**THEN，随后五项严格顺序：**

1. P0-2：接 MCP 请求/查询和两种真实报价，先让 20 在 policy 层被拒绝且零签名。
2. P0-3：复用官方 x402 和原账本执行 0.20，隔离模拟数据，保持原付款恢复。
3. P0-4：App 与 Agent 读取同一份决策、交易、资源及审计结果。
4. P0-5：验证撤销、到期、并发、重放、暂停、超时和完整重启，确认没有旁路或二次付款。
5. P0-6：在真实 Codex + App 完成两案与重读演示，保存新证据并更新运行说明。

**黑客松就绪度：4/10。** 代码能构建、228 项自动化测试通过，支付与恢复底座明显超出纯概念 Demo；但当前外部 Agent 还不能购买，核心用户委托缺失，0.20/20 价格不通，目标 UI 不完整，并有已复现的模拟状态误标。完成上述一条纵向链路，比再加五个功能更能提高提交质量。

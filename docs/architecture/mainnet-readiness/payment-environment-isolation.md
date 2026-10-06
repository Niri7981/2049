# Payment Environment isolation — Mainnet P0 第一步

2026-10-05。本轮只实现环境模型和配置校验；`live_mainnet` 可以被解析、验证，不能启动产品运行时、加载 Demo 钱包配置、预占购买或执行签名付款。本页不构成实际付款授权。

## 已确认的完整 P0 范围

1. 环境隔离：统一执行模式、cluster、genesis、RPC、CAIP 网络、资产及生产/测试身份；矛盾配置拒绝运行。
2. 钱包和授权隔离：独立 Mainnet Keychain 钱包，无 Demo 私钥回退、Devnet 钱包/授权/每日额度继承或默认生产收款方。
3. 账本和整数金额：按环境、钱包和资产隔离核算；权威金额逐步使用 bigint/整数字符串；保留历史与进行中付款。
4. 通用 x402 merchant/resource：注册外部 HTTPS 资源，数据描述端点、方法、请求绑定、网络、资产、收款方、报价策略、响应校验和恢复能力。
5. 商家无关的链上恢复：尽早安全持久保存原交易身份/证据，商家消失时仍能对账；未知结果保留预占，不补签替代付款。
6. 三类结果：链上付款、商家结算/回执、资源交付分别建模；交付重试不付款，有限次数及耗尽状态持久保存。
7. 安全与真实展示：保留暂停/退出、重放/幂等保护、外部响应限制和稳定错误合同；准确呈现 Mainnet、Devnet、模拟、USDC、测试 USDC 与未知状态。
8. 验收：确定性、集成、崩溃/重启/重放/并发测试；安装版 App、实际 Codex 宿主；最后经具体授权完成一笔小额真实主网购买。

扩展现有支付流水线，继续复用官方 x402 SDK。核心只理解资源和付款事实及能力，不按供应商名称分支。You.com 或其他真实商家只能作为后续注册资源和验收对象。第 2–8 项及第 1 项以外的实现未在本轮开展。

## 当前模型

唯一解析入口为 `resolvePaymentEnvironment`，接受环境变量并返回冻结的 `PaymentEnvironment`；`validatePaymentEnvironment(unknown)` 校验同一结构。已有 `PurchaseExecutionModeSchema` 移到该模块，账本继续从旧路径重导出，未新增另一套执行模式。

| 字段 | 含义 |
| --- | --- |
| `mode` | `simulated` / `live_devnet` / `live_mainnet` |
| `cluster` | `devnet` / `localnet` / `mainnet-beta` |
| `genesisHash` | Devnet/Mainnet 固定完整 genesis；localnet 未配置时为 `null`，preflight 核对实际 validator |
| `rpcUrl` | 当前环境唯一 RPC；公共网络要求 HTTPS，localnet 限精确 loopback |
| `network` | CAIP-2 标识，公共网络严格固定到相应 genesis 的前 32 字符 |
| `asset` | 冻结的 `network`、`mint`、`tokenProgram`、`decimals`、`symbol`、`displayLabel`；无通用资产注册表 |
| `isProduction` | 只在 Mainnet 为 true；模拟和测试链为 false，不代表执行许可 |

Mainnet 固定原生 USDC、classic SPL Token、6 decimals；Devnet 固定测试 USDC。模拟仅在测试环境表示，标签为 `Simulated test USDC`。历史 localnet 测试设施仍使用 `live_devnet` 标识执行测试付款，但 cluster/network/genesis/生产身份明确标记本地链；这不扩大产品 App 的 Devnet 支持范围。

`PaymentConfig` 沿用网络配置及 buyer/merchant/facilitator 的现有接口，并包含完整环境。旧 `mint` 字段只是 `asset.mint` 的只读 getter；签名边界核对该投影。配置无秘密，环境解析无需任何钱包或收款方。

## 配置兼容与阻断

- App 默认 `simulated`。历史付款 CLI 调用 `loadPaymentConfig` 的默认参数明确保留 `live_devnet`；App 显式传 `simulated`。两者调用同一解析器；显式配置始终优先于调用者默认值。
- 新 `YOSH_EXECUTION_MODE`（兼容 `APP2049_EXECUTION_MODE`）与现有 `YOSH_ENABLE_DEVNET_PURCHASES` / `APP2049_ENABLE_DEVNET_PURCHASES` 同时存在时必须一致。开关 1 表示 `live_devnet`，0/空值表示 `simulated`，不能暗示 Mainnet。新旧前缀冲突不选择优先方。
- 现有 `SOLANA_CLUSTER`、各 cluster 的 RPC 和 localnet 网络/mint 配置继续兼容。可选 `SOLANA_RPC_URL`、`SOLANA_GENESIS_HASH`、`SOLANA_NETWORK`、`USDC_MINT` 由同一入口解析；与当前 cluster 的旧字段冲突时拒绝。可选值应省略，不能用空值静默选择默认。
- `live_mainnet` 必须匹配 `mainnet-beta`、Mainnet genesis/CAIP、Mainnet USDC；`live_devnet` 和 `simulated` 不能匹配生产链。资产网络、token program、decimals、symbol、显示标签和生产标志都要匹配。
- 已知官方 RPC 主机与 cluster 矛盾时立即拒绝。自定义 HTTPS RPC 的实际链身份不能通过 URL 推断；测试付款 preflight 仍查询并核对完整 genesis。
- 环境结构合法不等于允许执行。Mainnet 在读取 Demo 地址之前被 `loadPaymentConfig` 阻断；App 在打开账本之前阻断；购买入口、reserve、preflight、claim 之前及 SDK 签名入口均有阻断。模拟配置不能进入 preflight 的可付款就绪结果、claim 付款入口或签名入口。现有调用者可以显式缩小到策略/模拟操作，不能将模拟环境扩大为实付。
- App 钱包余额读取也从统一环境取得 RPC/资产，但只支持已有 Devnet 展示；未创建主网余额界面。
- 错误只返回稳定码和字段名，不回显 RPC 凭据或配置值；管理 API 映射为 503。

## SDK 与资料依据

核对锁定的 `@x402/core` / `@x402/svm` 2.25.0：继续使用官方 `ExactSvmScheme`、RPC override、`setSpendControls`、policy 过滤及现有签名前检查；直接复用 SDK 的 CAIP 和 USDC 常量。本轮只补 Yosh 的执行环境一致性与禁用策略，未重写协议或付款载荷。

Mainnet mint 对照 [Circle 的 Solana USDC 页面](https://www.circle.com/multi-chain-usdc/solana)；完整 genesis 对照 [Solana genesis 配置](https://github.com/solana-labs/solana/blob/master/sdk/src/genesis_config.rs)。这是静态配置依据，不是当前 RPC 就绪或付款证据。

## 验证与后续边界

Focused tests 覆盖三种环境、配置冲突、genesis/网络/资产错误、生产身份、冻结结构、localnet 兼容、统一余额 RPC、脱敏错误与禁用后无 fetch/claim/sign/记录副作用。现有购买模式隔离、原付款恢复、授权、App 和 MCP 回归继续保留。

账本 SQL schema 不变，`live_mainnet` reserve 提前拒绝，历史/进行中付款记录不改写。Mainnet 钱包、授权/每日额度迁移、账本 bigint 与 scope 迁移、外部商家注册、链上恢复改造、三类结果及有限交付重试、UI 改版、实际 Codex 主网验收与真实购买均留待后续明确授权。

2026-10-05 本轮实际验证：首轮相关回归 422 项通过；包含统一余额 RPC 的全套回归 86 文件 / 787 项通过；最后新增 reserve/投影阻断测试及启动防护调整后的针对性回归 6 文件 / 101 项通过。最终 typecheck、lint、`git diff --check`、后端 production build、原生 Release build、native backend launch configuration 测试通过。未执行真实付款或实际 Codex 购买验收。

20:44 安装验收：旧 App 正常退出，日志确认原后端 PID 28168 停止、3049 监听释放；现有安装脚本更新 `/Users/irin/Applications/Yosh.app` 后重新打开。安装包与本次构建目录逐文件一致、codesign strict 通过；实际 App 路径为安装位置，后端 PID 33322 的本轮生命周期日志确认 ready，并仅监听 `127.0.0.1:3049`。未认证 health 请求返回 401 / `UNAUTHORIZED`，界面显示原有 PIN 解锁入口；未输入 PIN 或触发钱包创建。客户端 `.next/static` 对签名入口、钥匙串标识与敏感配置字段的扫描无匹配。本轮只验证启动/身份/就绪，不据此宣称完整 App/MCP/Mainnet 端到端验收。

构建有两项非阻断 Turbopack 警告，位于本轮未修改的 `src/modules/mcp/codex-integration.ts:95`，涉及动态文件路径的宽范围 tracing；未为消除警告扩大本轮范围。

## 本轮文件清单

只列本步骤实际修改的 25 个文件，工作区此前已有的其他改动不属于本轮交付。

- 环境与付款：`src/modules/payment/payment-environment.ts`（新）、`payment-config.ts`、`payment-preflight.ts`、`solana-payment.ts`。
- App 后端：`src/modules/app/app-runtime.ts`、`yosh-configuration.ts`、`management-auth.ts`、`wallet-balance.ts`。
- 购买边界：`src/modules/purchases/purchase-ledger.ts`、`approved-payment.ts`、`purchase-market-snapshot.ts`、`request-market-purchase.ts`、`request-paid-resource-purchase.ts`。
- 单元测试：`tests/unit/payment-environment.test.ts`（新）、`payment-preflight.test.ts`、`solana-payment.test.ts`、`paid-market-api.test.ts`、`paid-resource-purchase.test.ts`、`e2e-evidence.test.ts`、`purchase-mode-isolation.test.ts`、`purchase-request.test.ts`。其中既有 fixture 仅补充经解析的环境字段。
- 集成 fixture：`tests/integration/mcp-purchase-intent-lifecycle.test.ts`。
- 文档/配置示例：本页（新）、`plan.md`、`.env.example`。

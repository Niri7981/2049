# Mainnet wallet and authority isolation — P0 step 2

2026-10-05。仅实现钱包、签名来源和授权边界。沿用第一步不可变 Payment Environment；`live_mainnet` 的 App 启动、付款配置、预占、预检和 SDK 执行阻断全部保留。没有创建本机真实 Mainnet 钱包或执行 Mainnet 付款。

## Keychain 身份与签名边界

| 环境 | service | account |
| --- | --- | --- |
| simulated / live_devnet（含旧 localnet 测试） | `com.2049.wallet.v1` | `consumer-wallet-v1` |
| live_mainnet | `com.yosh.wallet.mainnet.v1` | `consumer-wallet-mainnet-v1` |

既有 test 项身份、密钥和历史数据不迁移、不替换。`initializeEnvironmentWallet(environment)` 是显式后端 provisioning 入口；新 Mainnet 钱包独立生成随机种子，以原有 stdin Keychain 写入方式创建、读回并核对。App 启动仍拒绝 Mainnet，不自动 provisioning。缺失、拒绝访问或编码损坏不能触发替代签名器；仅 Keychain 的 item-not-found（44）在显式创建时视为不存在。创建竞争只接受能读回的有效赢家。

Mainnet 初始化及加载会在后端派生既有产品 test 钱包公钥，拒绝 Mainnet 与之相同的地址，包括意外复制到 Mainnet 项的旧密钥；test 项读取受阻也拒绝继续，不能把“无法验证”当作“独立”。两项都不存在时独立生成 Mainnet 项，不生成 test 项。私钥不搬运到新项；临时解码/生成字节继续清零，返回的签名器私钥不可导出。Keychain 权限不扩大，不使用 `-A`、ACL 修改或 `-U` 覆盖。

付款签名入口 `loadBuyerSigner` 在 Mainnet 要求独立的 `YOSH_MAINNET_WALLET_PUBLIC_KEY` 与请求的买方地址一致，再加载 Mainnet 固定项、派生真实地址并核对。配置公钥不是签名来源证明。环境模型与当前配置在加载前后再次核对，防止异步加载期间切换后返回旧钱包。既有 `initializeProductWallet` / `loadProductWalletSigner` 兼容入口在 Mainnet 拒绝调用，必须显式选择环境入口。

## 允许及拒绝的来源

| 来源 | simulated / live_devnet | live_mainnet |
| --- | --- | --- |
| 旧产品 test Keychain | 保持现有路径 | 拒绝作为 Mainnet signer |
| 独立 Mainnet 产品 Keychain | 不选择 | 唯一允许的 signer 来源，需真实公钥核对 |
| Demo Keychain service | 保留旧测试路径 | 拒绝 |
| `DEMO_BUYER_PRIVATE_KEY` | 保留旧测试路径 | 拒绝 |
| `DEMO_BUYER_KEYPAIR` 文件 | 保留旧测试路径 | 拒绝 |
| Demo 买方/商家公钥配置 | 保留 | 拒绝 |

Mainnet 配置出现上述 `DEMO_BUYER_*` 已有键或 `DEMO_MERCHANT_PUBLIC_KEY`（包括空值）即失败；product-wallet 开关不能隐藏旧来源，未设置该开关也不会让 Mainnet 进入 Demo fallback。Devnet 的三种 Demo secret 来源仍要求恰好配置一种。simulated 的钱包加载并不授权付款；实际签名/付款执行仍受模式阻断。

旧 `wallet:setup` CLI 同样先拒绝 Mainnet，之后才可能创建 Demo 记录、访问 Keychain 或写入 Devnet 配置；它不能充当 Mainnet provisioning。

## 临时授权保护与收款方边界

当前 `app_settings`、daily budget clock 和 SpendGrant 尚未按环境、钱包、资产持久化分区，本步不改变 schema、金额表示或历史记录。临时保护把现有存储视作测试授权：

- Mainnet 的 controls 只能为 `paused: true`、`dailyBudget: null`、`singleLimit: 0`；active grant 不存在，grant summary 为 null，不查询/过期处理旧 grant。
- Mainnet 拒绝打开现有授权 ledger，拒绝预算写入、解除暂停、生成/取得授权、预算汇总、执行权领取和签名前检查。已打开后切换 Mainnet 仍受这些检查约束。
- grant 的 mode / network / asset 或 purchase intent / quote 指向 Mainnet，即使省略或伪装 execution mode 也拒绝，发生在事务与历史重放前。`live_mainnet` 预占仍返回原 `MAINNET_EXECUTION_DISABLED`。
- App 创建 grant 在旋转连接凭据和读取 test recipient/resource defaults 前拒绝 Mainnet；额度与暂停管理同样先检查模式。
- 不删除或释放原付款预占。已提交/未知状态的记录、链上确认和交付记账入口保留；切回 Devnet 后旧额度与 grant 数据仍可读。

Mainnet 没有 Demo recipient/resource 或生产商家默认值。`loadPaymentConfig` 在读取 Demo 钱包/商家字段前拒绝 Mainnet；只有 test 模式能到达 App 的既有 test scope/default 地址。没有显式批准的 Mainnet recipient/resource binding 就没有可用购买路径；即使指定 Mainnet 钱包也不开放付款。后续通用资源阶段必须绑定显式批准的 recipient/resource，不能移除阻断后继续沿用 test 配置路径。

**后续依赖：** 在账本 scope 迁移完成、明确隔离环境/钱包/资产及新的授权存储前，不得解除 `MAINNET_AUTHORITY_UNAVAILABLE` 保护。当前 null authority 是“不提供 Mainnet 授权”，不是已创建独立的 Mainnet 预算或 grant。账本金额仍沿用既有表示，本步没有开始 bigint 或账本分区。

## 验证范围

新增及扩展 `product-wallet`、`product-keychain`、`wallet`、`spend-grant`、`app-management`、`payment-environment` 测试：固定项隔离、Devnet 地址保留、独立生成/重启复用、创建竞争、复制旧密钥拒绝、Demo/env/file fallback 拒绝、配置/真实 signer mismatch、异步环境切换、Keychain 缺失/拒绝/不可用、无继承授权、Devnet grant 的 Mainnet 重放、Mainnet scope 伪装、无收款方默认和未知付款预占保留。全部使用内存/临时数据或进程 mock，不访问真实 Keychain、不调用付费服务或付款。

本次验证：完整回归 87 个文件 / 819 项通过；最终 CLI 复用同一保护检查后，相关钱包回归 4 个文件 / 62 项再次通过。最终 `npm run typecheck`、`npm run lint`、安装脚本中的 `npm run build` 与原生 macOS Release build 均通过，`git diff --check` 无错误。后端保留既有 MCP 动态文件 tracing 的两条 Turbopack warning；Xcode 仍报告本机 CoreDevice/CoreSimulator 版本不兼容，但此次 macOS 构建成功，未进行 iOS simulator 验收。

21:44 本机交付：旧 Yosh 正常退出后 3049 监听已释放，现有安装脚本更新 `/Users/irin/Applications/Yosh.app`；安装包与最终构建目录逐文件一致、codesign strict 通过。重新打开安装版后实际 App PID 37337，生命周期日志在 21:44:30 确认后端 PID 37381 ready；仅监听 `127.0.0.1:3049`，未认证 health 返回 401 / `UNAUTHORIZED`。界面为既有 PIN 解锁入口，没有输入 PIN、创建真实钱包或发起付款。客户端 `.next/static` 对 Mainnet Keychain/签名入口、Mainnet 钱包配置及 Demo private-key 字段扫描无匹配。这里只完成安装、启动、身份与后端就绪验证，不据此宣称实际 Mainnet Keychain provisioning、实际 Codex 购买或完整 Mainnet 端到端验收。

## 本轮文件清单

| 分类 | 文件 |
| --- | --- |
| 钱包与 Keychain | `src/modules/payment/keychain.ts`、`src/modules/payment/wallet.ts`、`src/modules/app-wallet/product-wallet.ts` |
| App / 付款 / 授权保护 | `src/modules/app/app-runtime.ts`、`src/modules/purchases/approved-payment.ts`、`src/modules/purchases/purchase-ledger.ts` |
| 旧 CLI 环境一致性 | `scripts/pay.ts`、`scripts/wallet-accounts.ts`、`scripts/wallet-setup.ts` |
| 钱包测试 | `tests/unit/product-keychain.test.ts`、`tests/unit/product-wallet.test.ts`、`tests/unit/wallet.test.ts` |
| 授权 / App / 环境测试 | `tests/unit/spend-grant.test.ts`、`tests/unit/app-management.test.ts`、`tests/unit/payment-environment.test.ts` |
| 配置与文档 | `.env.example`、`plan.md`、`docs/architecture/mainnet-readiness/mainnet-wallet-authority-isolation.md` |

## 未触及范围

账本 scope/bigint 迁移、商家/资源接入、付款恢复重新设计、UI 重新设计和真实 Mainnet 执行均未开始。没有硬编码生产商家，没有修改 SDK、依赖或原生界面。

# Yosh 原生 App 钥匙串读取与签名审计

> 历史记录：以下命令、安装路径、标识和验收结果按当时实际情况保留。当前公开产品名称为 Yosh；旧安全与存储身份的规则见 [更名兼容边界](yosh-rename-compatibility.md)。历史结果不代表本轮启动已通过。

日期：2026-10-03。本次只修复重复读取，保留内部名称、bundle identifier、管理 HMAC、钱包所有权、Grant、MCP 和付款行为。

## 1. 已确认的原因

1. `NativeServiceRuntime.start()` 原来每次执行都会调用 `BackendLaunchConfiguration.managementToken()`。已成功加载凭据之后，如果后端启动失败、退出或用户重试，新的启动尝试会再读同一项目。现有 `startup` 能合并同时进行的启动，`readyConfiguration` 能复用成功就绪的配置，但失败后没有独立的凭据缓存。新增回归用例在修复前明确失败于“backend readiness retry must reuse the loaded credential”。
2. `allowsLaunch: false` 原来仍先读取安装凭据，再判断是否启动后端。SwiftUI 预览创建多个这样的 runtime；每个都有机会独立请求授权。现在无显式测试凭据的只读 runtime 在任何读取前返回 `unavailable`。
3. 仓库路径、Node 和后端构建验证原来发生在读取管理秘密之后。现在无效启动配置先失败，避免无法启动的 App 无谓请求钥匙串访问。
4. 安装脚本执行 `CODE_SIGNING_ALLOWED=NO`，然后 `codesign --force --sign -`。检查确认安装产物是 ad-hoc 签名、没有 TeamIdentifier；重建前后的指定要求（DR）使用不同的代码哈希。新版本不能满足旧版本的这个 DR，可能使 macOS 重新评估钥匙串访问。Apple 说明 ad-hoc DR 绑定特定代码版本。[TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)

一次启动也可能访问两个不同项目：原生 App 的管理凭据和后端的钱包。它们是不同访问请求。是否逐次要求密码还取决于系统中的项目策略、钥匙串锁定状态和此前授权选择；本次未修改这些策略，也未通过额外读取秘密或修改 ACL 来检查它们。“允许一次”本来只授权当次读取。[Apple 钥匙串访问说明](https://support.apple.com/zh-cn/guide/keychain-access/kyca1243/mac)

## 2. 所有读取路径

| 场景 / 调用路径 | 发起进程与实际读取进程 | Service / Account | 必要性、重复与本次处理 |
| --- | --- | --- | --- |
| 原生启动：`CardApplicationDelegate` / 管理客户端 → 共享 `NativeServiceRuntime.ready()` → `managementToken()` → `BackendManagementIdentity.loadOrCreate()` | 已安装 App；直接 `SecItemCopyMatching` | `com.twentyfortynine.backend-management.v1` / `local-installation` | 已有项目每 App 进程成功加载一次。后端失败、重试及退出重启后复用成功加载值。只缓存校验成功的值；失败可显式重试。 |
| 首次创建管理项目 | 同一 App；`SecItemAdd` 后 `SecItemCopyMatching` | 同上 | 首次未找到后的写入回读用于保存验证及创建竞态。保留；不会覆盖已有项目。 |
| 原生就绪轮询、占用端口身份校验、正常退出 | App → `ServiceConfiguration.request(.health / .shutdown)` | 无新的钥匙串读取 | 使用已加载管理凭据计算及验证 HMAC。后端读取既有子进程环境中的 token；没有后端管理钥匙串 helper。 |
| SwiftUI 预览 / `allowsLaunch: false` 诊断 runtime | 预览宿主或 native CLI fixture | 原来可能读取管理项目 | 无显式 fixture 凭据时现在直接失败，不读安装项目。有显式 fixture 凭据时仅使用该值。普通环境变量仍不能替换生产 App 管理身份。 |
| 之前开发验收中的临时管理秘密探针 | 独立临时 Swift helper | 管理项目 | 这些 helper 不属于仓库的常驻实现；本次未使用。安装验收读取 App 自己已有的 `backend-lifecycle` 日志，未新增秘密探针。 |
| 后端首次钱包初始化：overview、balance、paid-resource quote、已批准执行所需的钱包准备 → `AppRuntime.initializeWallet()` → `initializeProductWallet()` | Node 后端派生 `/usr/bin/security`；后者实际访问项目 | `com.2049.wallet.v1` / `consumer-wallet-v1` | 已有钱包读取一次并验证格式、公钥。`AppRuntime.wallet` 已合并并发请求，且只缓存公钥结果。新增测试确认缓存有效；无需增加私钥缓存。读取失败会清除失败 Promise，后续请求可重试，不生成替代钱包。 |
| 后端 health / 启动恢复：`backend.start()` → `recoverOnStartup()` | 无待恢复记录时不读钥匙串；有记录时进入上行钱包初始化 | 产品钱包项目 | 原交易恢复需要钱包身份核对；初始化与 overview 共用同一缓存。health 处理器本身没有直接秘密读取。重复 `start()` 也共用启动 Promise。恢复使用原付款载荷，不加载新的 signer 来重新签名。 |
| 首次创建产品钱包：`initializeProductWallet()` | Node → `/usr/bin/security -i` 写入，再 `find-generic-password … -w` 回读 | 产品钱包项目 | 缺失查询、首次写入回读或创建竞态后的赢家回读用于核对保存的原钱包。保留这些必要验证。无 `-A`、`-U` 或 ACL 修改。 |
| 已批准的新付款：`executeApprovedPayment()` → `loadBuyerSigner()` → `loadProductWalletSigner()` | Node → `/usr/bin/security find-generic-password … -w` | 产品钱包项目 | 新签名必须取得私钥并重新核对预期公钥；初始化仅保留公钥，拥有者此时没有缓存私钥。因此这不是可删除的就绪读取。保留，原有策略校验顺序不变。 |
| 旧 Demo signer：`loadBuyerSigner()` 非产品分支 → `readDemoKeychain()` | 旧 Demo 后端或 CLI → `/usr/bin/security` | `com.2049.day4.<仓库路径哈希前16位>` / 预期钱包公钥 | 显式旧配置的签名入口；不是原生产品钱包的默认路径。付款与 accounts CLI 会按原规则验证 signer。没有改动。 |
| 旧 `scripts/wallet-setup.ts` | 手动运行的旧 CLI → `/usr/bin/security` | 旧 Demo 项目 | 已有钱包时先读项目，再由 `loadBuyerSigner()` 重新读取并验证公钥；首次创建由 `createDemoKeychain()` 回读保存结果，末尾再验证 signer。这是旧手动设置流程，不由 App 启动、就绪或安装脚本调用，本次没有扩展修改这个流程。 |

钱包的 `security` helper 有 30 秒超时；拒绝/超时会返回脱敏错误，不会替换钱包。为保持私钥生命周期，本次没有把私钥复制进原生 App，或将钱包 signer 长期缓存。管理凭据本来就保留在就绪配置中并传给受控子进程；新增缓存与该 App 进程同寿命，不落盘。

## 3. 实际修复

- 增加 actor 私有的 `loadedManagementToken`，独立于后端进程和就绪状态，只保存通过现有规则验证的成功读取。
- 保留现有启动任务合并；密钥加载是 actor 中的同步操作，因此并发启动不会竞争读取。
- 无效路径、缺失构建以及无显式 fixture 身份的只读 runtime 均在读取之前失败。
- readiness、退出和诊断 fixture 使用已有 `ServiceConfiguration` 或显式测试身份，没有新增 `security` helper 或管理项目查询。
- 加入可计数的测试读取器，测试不用真实钥匙串；生产默认仍使用原有 Security API，普通 `APP2049_MANAGEMENT_TOKEN` 环境覆盖仍不作为生产身份来源。

## 4. 当前签名与剩余要求

实际安装路径：`/Users/irin/Applications/2049.app`；identifier：`com.twentyfortynine.macos`。

```
Signature=adhoc
TeamIdentifier=not set
旧 DR: designated => cdhash H"f5eb5afda2bb4af4ddbdf02b36e260b7d801ba27"
新 DR: designated => cdhash H"e5f827e911136792c8bf31779c93c2de094c5ca8"
security find-identity -v -p codesigning: 0 valid identities found
```

Xcode 的 Debug / Release 只有 `CODE_SIGN_STYLE=Automatic`，未配置开发团队或证书；本机安装脚本显式跳过 Xcode 签名并随后 ad-hoc 签名。当前没有可用的证书及对应私钥，无法安全建立跨构建稳定的身份，故保留现状并明确报告；没有生成证书、嵌入私钥、伪造 DR 或放宽访问策略。

后续需要已有、有效的 **Apple Development** 身份用于开发，或 **Developer ID Application** 身份用于分发，并让 Xcode / 安装脚本持续使用该身份、同一团队和现有 bundle identifier。不能继续让安装脚本强制以 `-` 重签名。切换签名渠道时要核对 DR 兼容性；首次切换及旧项目授权可能仍需系统确认。稳定签名不会覆盖“允许一次”、锁定或要求每次确认的项目策略。

## 5. 验证与实际安装

- 先增加计数回归用例：原代码在启动重试后读取计数变成两次，用例失败；修复后通过。
- `npm test -- tests/unit/app-management.test.ts tests/unit/management-hmac.test.ts tests/unit/product-wallet.test.ts tests/unit/wallet.test.ts tests/unit/member-management.test.ts`：5 文件、49 用例通过；钱包使用内存 fixture，未付款。
- `node tests/native/management-security.mjs`：管理凭据单次加载、并发就绪、失败重试、拒绝/无效值恢复、预览/诊断零读取、HMAC 请求与响应、篡改边界、超时/大小限制、正常退出、旧后端替换和单实例锁通过。测试后端使用随机测试 token，没有读取真实钱包。
- `node tests/native/management-client-smoke.mjs`、`bash tests/native/backend-launch-configuration.sh`：通过。
- `npm run typecheck`、`npm run lint`、`git diff --check`：通过。
- 正常退出旧 App 并确认 3049 端口关闭后，运行现有 `scripts/install-macos-app.sh`。后端 `npm run build` 和原生 macOS arm64 Release 构建成功，更新同一安装位置，`codesign --verify --strict` 通过，安装版与构建产物的可执行文件一致。
- 打开安装版：App PID 17281 → 后端 PID 17287；App 既有日志记录经过 HMAC 验证的 `Backend ready`。
- 正常退出更新版、确认后端停止后，未重建或重签名，重开同一安装版：App PID 17337 → 后端 PID 17347；再次记录 `Backend ready`。所有安装 bundle 文件的 SHA-256 均与重开前一致，后端父进程及 App 实际路径正确，启动未被授权等待阻塞。
- 未使用 Computer Use，因此不声称已观察系统弹窗数量或逐页确认真实钱包 UI；钱包加载通过针对现有安全边界的自动化测试验证，未做真实付款。

构建存在非阻断提示：Turbopack 对既有 Codex 路径检查的动态文件追踪警告；本机 Xcode 的 CoreDevice / Simulator 插件版本问题；无 AppIntents 依赖而跳过元数据提取。macOS Release 构建结果为成功，本次未扩展修复这些环境或打包问题。

同一构建每个新 App 进程仍必须加载一次管理凭据；成功后不再因就绪、诊断或后端重试重复取出它。在系统已持久允许同一身份、钥匙串可用时，重开不应人为产生新的授权需求。跨 ad-hoc 新构建的身份变化以及系统访问策略仍需上述稳定身份和用户的系统授权，不能通过应用缓存绕过。

## 6. 本次修改文件

1. `apps/macos/2049/2049App/Services/NativeServiceRuntime.swift`
2. `tests/native/ManagementTransportSecurity.swift`
3. `tests/native/management-security.mjs`
4. `tests/unit/app-management.test.ts`
5. `README.md`
6. `docs/architecture/keychain-access.md`

原有未提交的 UI / 标题对齐等改动保留。本次没有提交或推送。

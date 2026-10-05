# Yosh 更名兼容边界

公开产品名称为 **Yosh**。窗口、菜单、Connection 文案、桥线端点、图标、安装文件、新 MCP 条目和当前产品文档使用 Yosh；`2049` 不再是公开产品身份。更名不改变钱包、授权、预算、购买、签名或恢复语义。

## 安全与持久标识保留清单

| 标识 | 策略与原因 |
| --- | --- |
| `com.twentyfortynine.macos` | 保留 bundle identifier。显示名和可执行文件可叫 Yosh；不因为换品牌改变现有安装与代码签名身份。 |
| `com.twentyfortynine.backend-management.v1` / `local-installation` | 保留原管理 Keychain 项目，不创建替代管理身份。生产原生 App 仍从 Keychain 读取；环境变量不取代它。 |
| `com.twentyfortynine.yosh-app-lock.v1` / `local-app-lock` | 保留 App Lock 项目及现有 PIN，不重置或迁移锁凭据。 |
| `com.2049.wallet.v1` / `consumer-wallet-v1` | 保留产品钱包。拒绝访问或记录损坏必须报错，不生成新的钱包。 |
| `com.2049.day4.<仓库路径哈希>` | 保留旧 Demo signer 命名及校验，复用持久钱包记录中的 service；不改写旧付款身份。 |
| `2049-management-v1`、`2049-management-response-v1`、`x-2049-*` | 保留版本化管理 HMAC 的规范字节和请求／响应头。它们是私有协议，不是界面品牌；不能降低认证或添加 Bearer 降级来完成更名。 |
| `~/Library/Application Support/2049` | 继续作为同一安装的持久存储位置，不移动 SQLite、复制账本或选择新的空目录。App、后端与 MCP 使用同一个解析后的路径和所有权锁。 |
| `~/Library/Application Support/2049/native-app.lock` | 保留新旧安装共用的实例锁，避免两个不同显示名的 App 同时拥有后端。 |
| `2049 App test purchase` | 保留既有购买意图及 requestHash 的输入字节；只在内部请求绑定和历史记录中使用。 |
| 原数据库、schema、Member UUID、连接代次、Grant ID、购买/request ID、原 payload 与交易凭据 | 保留原值。更名不重建数据库、重置授权或生成替代购买；未知付款继续按原凭据恢复。 |
| `.data/day*`、`day4_*` 表、`day4:` memo、旧验收 request ID | 保留历史测试设施及恢复兼容，规则另见 [按职责命名](naming.md)。 |

这些标识可以长期作为实现细节保留，不要求为了 v1 的品牌统一迁移秘密或付款数据。实际存储路径在用户主动查看目录时仍忠实显示，不伪装成另一个目录。

## 环境变量与安装路径

新文档与新配置使用 `YOSH_*`；相同后缀的 `APP2049_*` 保留为旧配置别名，包括 `PORT`、`DATA_DIR`、`REPOSITORY_ROOT`、`NODE_PATH`、`CODEX_PATH`、`CARD_MEMBER_ID`、`MCP_PROVIDER`、`MANAGEMENT_TOKEN`、`ENABLE_DEVNET_PURCHASES`、`ENABLE_LEGACY_DEMO_TASKS`、`USE_PRODUCT_WALLET`。测试专用的原生启动开关使用 `YOSH_NATIVE_TEST_APP`。两个名称同时存在而值不一致时拒绝配置，不通过优先级猜测数据目录、认证或付款开关。真实付款仍默认关闭，启用环境开关不构成付款授权。

新 bundle 写入 `YoshRepositoryRoot` 和 `YoshNodeExecutable`；旧 `APP2049RepositoryRoot`、`APP2049NodeExecutable` 只用于兼容读取。源码项目为 `apps/macos/Yosh/Yosh.xcodeproj`、scheme `Yosh`、module `YoshApp`。现有 `/Users/irin/Desktop/2049` checkout 和实际 GitHub 仓库 URL 没有自动改名，绝对路径必须来自真实安装位置。

安装目标为 `~/Applications/Yosh.app`。替换前检查新旧名称的 App 都已正常退出，并等待受控后端安全停止；验证旧 bundle 的身份，保留失败回滚。成功安装和验证后才能移除旧 `2049.app` 安装副本，不能删除其他应用或强制结束付款服务。新的健康响应使用 `service: "Yosh"`；旧 `service: "2049"` 只在经过 HMAC、PID 与数据目录核对的旧后端接管流程中接受，不能作为新子进程就绪的证据。

## Codex MCP 条目迁移

新公开条目是 `yosh-codex-<持久 Member UUID 的完整 base64url 编码>`。旧 `2049-codex-<相同编码>` 采用一次迁移：核对原安装记录、Member UUID、命令、参数和环境，再用持久迁移记录恢复被中断的步骤。新旧配置发生冲突或用户修改旧条目时拒绝覆盖；不能按名字扫描后删除用户配置。

迁移保留同一 Member 和购买归属。只移除确认由本功能创建且未被修改的旧条目，不清理用户自行创建的 `2049`、`2049-research` 或历史隔离验收条目。配置保存／迁移只证明 Yosh 已准备路径；Codex 重新加载后，真实握手与宿主响应才证明 Connected。断开仍先撤销凭据及授权，再处理受控配置，不让旧入口保留有效访问。

## 历史资料与验证

带日期的审计、实际旧命令、安装路径、哈希、交易与验收 ID 保留为明确标注的历史记录。旧正反面图片已放入 [历史设计素材](../design/references/legacy/README.md)，不作为 Yosh 当前界面或发布素材；历史 BOUND 名称只在历史证据中出现。

验收应覆盖新旧环境别名及冲突拒绝、Keychain fixture 复用、HMAC 请求／响应、旧后端接管、单实例与正常退出、原账本重启恢复、MCP 配置所有权／迁移中断／冲突，以及当前 Yosh 原生构建和安装身份。自动化使用隔离数据库与测试凭据；不能用历史验收或构建成功代替本轮已安装 App 的后端就绪证据。

## 2026-10-05 本轮实现与验证

- 公开 App、Connection 文案/端点/辅助功能、MCP 服务说明、安装提示、Electron 和 README 已使用 Yosh；原生源码/项目/target/scheme/module、Skills 和 npm 根包同步更名。界面布局和已完成动效保留。
- 环境别名和 bundle 路径 hints 有显式冲突校验；生产管理身份仍使用原 Keychain。后端新健康身份为 Yosh，旧身份仅允许经认证接管。默认存储原地复用。
- 85 个测试文件、749 个用例通过；后续慢启动迁移修正的 4 文件/22 用例通过。后者包含真实 Codex CLI 的五步迁移和真实 app-server 的握手、心跳及只读工具调用；没有模型 turn 或付款。typecheck、lint、后端 build 和 macOS arm64 Release build 通过。
- 原生配置、管理 smoke/security、拒绝伪造监听者、正常停服、隔离测试进程异常退出后接管、单实例锁、Connection/Tab/Detail 动效及滚动保持、原生 PIN fixture 通过。详情渲染测试首次并行运行出现标记读取失败，单独复跑全组通过，未修改动效实现来掩盖失败。
- 使用现有安装脚本更新 Yosh.app；严格签名校验通过，安装目录全部文件哈希与本轮构建一致，旧名称安装副本不存在。实际 App PID 25233，路径为 `/Users/irin/Applications/Yosh.app/Contents/MacOS/Yosh`；2026-10-05 18:37:19 的生命周期日志确认经过 HMAC 验证的后端 PID 25398 就绪，端口只监听 loopback，后端父进程为该 App。
- 实际安装版重复启动后仍只有上述单一 App/后端实例；未认证的管理 health 请求返回 401。其他项目的独立服务未被停止或接管。
- 原钱包公钥哈希一致且 reused=true；三个原 Keychain 项目的属性哈希一致。启动后只读事务比较显示原两个成员、八个 Grant、十四笔购买及对应事件、设置和 schema 的行数/内容哈希一致。预算时钟 last_seen 有正常运行更新；没有新库或账本副本。
- 用户现有受控 Codex 条目已按原 Member UUID 迁移到 yosh-codex 名称，读回确认 canonical 环境、旧条目消失、迁移 journal 清除、没有重复受控入口；无关条目未修改。一次迁移在最终读回前触及原 12 秒期限，journal 成功恢复；迁移总期限按五次调用改为 20 秒，并补充慢宿主回归，普通 Connect 仍为 12 秒。
- 最终扫描逐行记录在 `/tmp/yosh-product-rename-final-scan.md` 与同名 JSON；所有残留已分类为私有兼容、历史证据或普通 bound/第三方依赖词，无未解释的产品名称。原始旧设计图只保留在 legacy 资料目录。

**实机限制：**没有使用 Computer Use。原 PIN 项目和验证实现保留，原生解锁 fixture 通过，但实际用户 PIN 解锁仍需用户确认。最终安装版曾等待系统 `SecItemCopyMatching` 访问原管理 Keychain 项目（进程采样确认），随后已正常取得身份并启动后端；没有绕过确认、重置 PIN、替换管理秘密或强制结束 App。真实 Codex 宿主连接用例使用隔离配置和同一持久成员验证；用户当前宿主仍须通过正常 Connect/重新加载完成真实连接，不能把迁移配置读回当成 Connected。

没有提交、推送、对外发布或主网工作。

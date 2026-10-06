# P0 step 4: merchant-independent original-payment recovery

更新日期：2026-10-06。

本步实现买方独立核对原授权 Solana 付款。商家超时、崩溃、消失或回执不可用时，本地后端查询原交易；未知付款不会重新签名、提交替代交易或生成新购买。`live_mainnet` 的付款及恢复入口仍禁用。本步没有实际 Mainnet 付款。

## 官方 SDK 与补充边界

继续由锁定的 `@x402/svm` 2.25.0 与 `@x402/core` 构造付款载荷和协议头。SDK 的客户端创建买方部分签名交易，通常由 facilitator 补齐 fee payer 的签名；客户端没有提供 Yosh 所需的持久购买证据、原交易独立对账及原子账本状态转换，因此这些约束由现有本地购买模块维护。

原始 wire 的首个签名槽可能全为零，不能将它当成最终交易 ID。后端按 required signer 的公钥定位并验证买方 Ed25519 签名，保存 signer index、公钥及签名。Fee payer 补签可以改变完整 wire 的哈希，但不能改变买方已签署的 message、买方签名、收款事实或 blockhash。链上交易必须保留这些原始事实并具有有效的完整签名。

## 不可变付款证据

`original_payments` 按 purchase ID 保存一份后端专用证据。它绑定：

- purchase/request ID、不可变 monetary scope 及其 scope ID、钱包身份、execution binding、quote fingerprint；
- payer 公钥、recipient 公钥、network、genesis hash、mint、token program、精度及十进制原子金额；
- 买方和收款方的标准 ATA、fee payer、买方签名及 signer index；
- 原始 message hash、原始 wire hash、完整付款 payload hash；
- 从实际已签 message 解码的 memo、recent blockhash，以及可取得的本地 `lastValidBlockHeight`；
- `recordedAt`、独立的首次 submission-attempt 时间/状态，以及已识别的原交易签名。

`recordedAt` 表示证据写入时间。对新付款它紧邻签名后写入；对历史载荷的补充记录，它是本次验证时间，不能声称是历史签名时间。

`createSignedPaymentIdentity` 验证实际已签 wire 中唯一的 classic SPL `TransferChecked`，核对 mint、原子金额、精度、买方 authority、标准源/目标 ATA 与 fee payer，拒绝额外不支持的指令、地址查找表和非法签名。允许锁定 SDK 的有限 Compute Budget 指令及一个 memo。报价有显式 memo 时仍须一致；报价没有 memo 时，保存 SDK 实际生成的随机 memo。

`validateSignedPaymentIdentity` 在账本写入和读取时重新证明证据属于保存的原 payload，不依赖当前商家配置或 RPC。SQL trigger 禁止改写已保存 payload、原证据、首次 submission-attempt 时间及已确定的原交易签名。原始载荷和签名证据不通过通用 App/Agent 查询接口返回，私钥不进入这些记录。

SDK wire 不携带 `lastValidBlockHeight`。新付款在 checked signer 的 `transaction.lifetimeConstraint` 回调中捕获 SDK 从本地配置 RPC 得到的 blockhash/height，并核对其 blockhash 与实际已签 message 一致。商家报价内的 lifetime hints 不作为这个来源；历史载荷没有可靠 height 时省略它。即使 blockhash 已过期，也不能据此推断原付款从未上链。

## 提交与恢复状态

新签名的 payload 与证据在同一个账本事务内保存。首次 HTTP 发送前，以事务 CAS 将 `SIGNED_NOT_SUBMITTED` 改为 `SUBMISSION_ATTEMPTED`，保存时间；暂停、退出、授权和不可变绑定检查在此再次执行。标记与首次 fetch 调用之间没有异步间隙。标记后的异常一律按可能已提交处理。

| 原付款状态 | 含义与账本行为 |
|---|---|
| `SIGNED_NOT_SUBMITTED` | 已保存原签名，首次发送尚未获准；普通恢复保留预占，不能与初始执行者竞态释放。 |
| `NOT_SUBMITTED` | 初始执行者的失败处理或独占服务启动确认没有发送；购买记为 FAILED，释放预占。无 payload 的 PAYING 也由独占启动清理。 |
| `SUBMISSION_ATTEMPTED` | 首次发送已开始或可能开始，仍预占。 |
| `OUTCOME_UNKNOWN` | RPC、HTTP 或历史查询不足以确定原交易结果，购买为 PAYMENT_UNKNOWN，继续预占。 |
| `CONFIRMED` | RPC 在 confirmed/finalized commitment 证明精确原交易成功；购买记为 PAID。 |
| `FINALIZED_FAILED` | RPC 在 finalized commitment 证明精确原交易失败；购买记为 FAILED，释放预占。 |

商家或历史返回的 signature 先同步写入 `original_payment_signatures`，它仅是查找线索，不是付款成功证据。部分签名 wire 已包含有效完整交易签名时可以直接保存该原签名；否则只能在精确 identity 核对后确定 canonical transaction ID。即使精确交易的 `meta` 暂时不可用，已识别的 signature 仍保存，付款结果继续 UNKNOWN。

## 独立链上核对

`reconcileApprovedPayment` 读取保存的证据并调用 `reconcileStoredOriginalPayment`。它不加载 signer，也不联系商家或发送交易。恢复使用证据中的原 recipient；当前商家地址变更不会使另一个交易成为原付款。

1. 重新验证证据及原 payload，核对当前钱包公钥、network、mint/精度与存储事实；RPC `getGenesisHash` 必须匹配保存及配置的 genesis。
2. 有原签名或观察到的 signature 时，先直接查询 `getTransaction`。回执 signature 在任何后续 RPC 等待前保存；它仍须通过 exact-message 验证。
3. 无可用直接结果时，对买方地址读取最多 100 条签名历史，以实际 memo 缩小候选，最多核对三个候选交易。
4. 对候选解码原 message，验证所有 required signatures、同一买方签名/公钥/index、同一 message hash、blockhash、memo、fee payer 及完整授权转账事实。金额和 recipient 恰好相同不足以证明是原交易。
5. confirmed 的匹配成功可记为已付。confirmed 失败必须再读取 finalized；匹配的 finalized 失败才能释放，finalized 成功则记为已付。结果缺失、无 `meta`、格式非法、签名/事实不符或 RPC 异常均保持 UNKNOWN。

买方 RPC 只执行读取，单次请求超时 15 秒、禁止重定向、响应上限 256 KiB，并对结果做运行时 schema 校验。RPC/history 缺失不是未提交证明。受限历史窗口、pruned history、memo 缺失或候选上限可能无法找到原交易；这种情况继续预占，不宣称恢复成功。没有固定 genesis 的 localnet 历史不能证明链连续性，保守保持 UNKNOWN；已固定 genesis 的测试链与 Devnet 可核对。

## 付款证据与会计

新链上成功产生 V3 payment evidence：`source: 'buyer_rpc'`、精确原证据 hash、scope ID、message hash、payer、transaction 和 confirmation status。`settlementConfirmed: false` 表示没有借此证明商家结算回执；它不妨碍买方已付事实成立。完成购买仍需独立的交付校验。

状态与付款证据在同一个账本事务内转换，重复成功核对不重复消费或改写交易。PAYING/PAYMENT_UNKNOWN 持续占用原 scope 的预算与 Grant 承诺；PAID 转为该 scope 的已付，跨日归属沿用原账本规则；已付但未交付保持 PAID。只有确定未提交或精确原交易 finalized 失败可以释放预占。旧 `confirmPayment`/`failConfirmed` 对已有原证据的行拒绝操作，防止绕过新证明路径。

同一 request ID 的重放、不同连接和重启保留原 purchase、payload 与交易事实。未知付款只进入链上检查；现有 PAID 交付路径才可以用原凭据取回结果，不能以缺失商家响应生成替代付款。

## 007 迁移与历史兼容

`007_original_payment_evidence` 是 BEGIN IMMEDIATE 内的增量迁移，新增原证据、signature observations 表和不可变 trigger，失败回滚并拒绝启动。它不重写原 purchases、SpendGrants、预占、PAID、PAYMENT_UNKNOWN、request/purchase ID、原 payload 或历史交易证据。

历史 signed payload 没有可信的首次发送标记，不能将缺少新表记录解读为未提交。恢复先验证原保存 wire 并补充证据，进入 `OUTCOME_UNKNOWN`；无法验证的旧载荷继续冻结。历史 `recordedAt` 仅表示本次记录时间，缺失的发送时间、lifetime height 不伪造。旧 V1/V2 已付款证据保留兼容，新买方核对使用 V3。

## 验证与本步范围

确定性 fixture 覆盖提交前失败、保存 payload 但未发送、signature 后商家响应丢失、成功/最终失败/持续未知、RPC 不可用或未找到、错误交易和付款事实、重复恢复、重启、证据篡改、会计转换及无第二次签名/付款。测试使用临时数据库与生成的测试 signer，不执行真实 Mainnet 付款。全量 regression、typecheck、lint、后端/原生构建及安装版验收结果以本轮交付报告为准。

本步未开始通用商家接入、交付重试次数/调度重设计、UI 改造或 Mainnet 执行。原 authority、monetary scope/bigint、Keychain 隔离和 Mainnet blocker 保留。

## 本步文件清单

以下 20 个文件是本步变更；工作区中此前钱包隔离和 ledger scope/bigint 的其他修改不计入本清单。

| 文件 | 本步职责 |
|---|---|
| `src/modules/payment/original-payment-evidence.ts`（新增） | 原签名 message、实际转账与持久 identity 校验。 |
| `src/modules/payment/reconcile-transaction.ts` | 买方只读链上核对，保留原 merchant 测试兼容入口。 |
| `src/modules/payment/solana-payment.ts` | 从 SDK 签名边界捕获本地 lifetime。 |
| `src/modules/purchases/original-payment-record.ts`（新增） | 购买、scope 与原签名证据/状态 schema。 |
| `src/modules/purchases/original-payment-migration.ts`（新增） | 007 增量迁移和不可变约束。 |
| `src/modules/purchases/purchase-ledger.ts` | 原证据持久化、首次发送 CAS、原付款会计转换和 V3 proof。 |
| `src/modules/purchases/approved-payment.ts` | 首次发送前保存证据，商家无关恢复，PAID 后保留原交付路径。 |
| `src/modules/e2e/evidence.ts` | 兼容并验证 V3 buyer RPC 证据，继续限制公开字段。 |
| `tests/helpers/signed-payment-fixture.ts`（新增） | 临时真实签名 fixture，不使用真实钱包。 |
| `tests/unit/original-payment-evidence.test.ts`（新增） | 签名/identity、RPC 结果和错误边界。 |
| `tests/unit/original-payment-recovery.test.ts`（新增） | 实际 reconciler 的购买、预占、重启、并发和不重付测试。 |
| `tests/unit/reconcile-transaction.test.ts` | 旧 merchant 核对兼容回归。 |
| `tests/unit/solana-payment.test.ts` | SDK simulation、签名和 lifetime 捕获回归。 |
| `tests/unit/e2e-evidence.test.ts` | V3 buyer RPC、篡改拒绝及安全公开字段。 |
| `tests/unit/approved-payment.test.ts` | 原付款会计与保留的交付语义。 |
| `tests/unit/approved-offer-payment.test.ts` | 已授权 offer 的新证据与发送边界。 |
| `tests/unit/approved-resource-payment.test.ts` | 现有固定测试 resource 的执行回归。 |
| `tests/unit/purchase-mode-isolation.test.ts` | 已签 payload 不可删除、缺少 proof 时拒绝重放。 |
| `docs/architecture/mainnet-readiness/original-payment-recovery.md`（新增） | 边界、迁移、保守限制及当前证据。 |
| `plan.md` | 记录本次仅授权 P0 step 4。 |

## 本轮实际验收（2026-10-06）

- 全量 regression：90 个 Vitest test files、903 项测试通过。最后的 SDK schema 类型收窄后，E2E evidence 的 23 项回归再次通过；typecheck、lint 通过。
- `scripts/install-macos-app.sh` 的 backend production build 与原生 macOS Release build 均通过，已更新 `/Users/irin/Applications/Yosh.app`；安装包与构建产物一致，codesign strict 校验通过。
- 旧 App 正常请求停服，旧后端安全退出。新版实际进程位于安装路径，生命周期日志确认新后端 ready；仅监听 `127.0.0.1:3049`，无认证 overview 请求返回 401。App 正常进入既有 PIN 入口；没有读取或输入 PIN。
- 真实账本的受限副本验证 007 增量迁移前后 13 张原业务表内容一致；安装版实际账本为 14 笔购买（含 3 笔历史 PAID）、8 个 SpendGrant，007 已应用，integrity_check 为 ok、foreign_key_check 无错误。没有为历史购买伪造新原证据；Mainnet 购买为零。
- 本轮没有真实 Devnet/Mainnet 付款，没有新增 merchant 接入、UI 或交付重试模型，也没有提交/推送代码。

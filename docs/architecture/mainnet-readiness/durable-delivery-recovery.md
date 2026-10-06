# P0 step 6: durable delivery recovery

更新日期：2026-10-06。

本步仅实现原付款已确定成功后的持久交付恢复。付款恢复继续查询原交易，交付恢复只读取原资源或缓存；`live_mainnet` 执行及恢复仍禁用，没有真实 Mainnet 付款，没有 UI 改造或商家名称分支。

## 官方 SDK 与本地职责

继续复用锁定的 `@x402/core` / `@x402/svm` 2.25.0。核对了官方 `onPaymentResponse` / failure hooks：它们可以提示当前进程的 transport 重试，但没有提供 Yosh 的跨重启预算、SQLite 原子领取、原付款证明或不同资源的安全恢复合同。因此不启用自动重新创建付款的 transport；恢复凭据仍由官方 HTTP adapter 编码，持久次数和状态位于原账本旁的交付表。

## 三种独立事实

购买 `status` 和原 payment evidence 继续表示付款结果。新增 `purchase_delivery` 独立保存 receipt outcome 与 delivery outcome，通用购买响应和记录列表返回安全的状态、次数、期限与稳定错误码，不返回原签名载荷或原始回执。

| 维度 | 状态与含义 |
|---|---|
| Payment | 原有 PAYING / PAYMENT_UNKNOWN / PAID / FAILED；只有原付款证明能改变资金结果。 |
| Receipt | UNAVAILABLE、UNVERIFIED、CONFIRMED、FAILED、INVALID。付款未证实时的合法回执只记 UNVERIFIED；CONFIRMED 必须绑定已付原交易。后续缺失回执不擦除已确认事实。 |
| Delivery | NOT_PAID、PENDING、DELIVERING、COMPLETE、EXHAUSTED、UNSUPPORTED。DELIVERING 只表示已领取的交付操作，不表示新付款。 |

`PAID + UNAVAILABLE + PENDING` 是合法状态，并继续消费原 daily authority / SpendGrant。PAID 后，正确资源的有效交付可以在没有回执时完成；若响应带有非法、矛盾或失败回执，则拒绝该次交付。回执或交付失败不退还已付金额，不改写原 payment proof、confirmed day 或 grant commitment。

## 持久领取与四次重试

原付款 HTTP 响应的首次交付处理与后续重试分别领取。首次响应不消耗 retry budget；交付重试最多 **4 次**。每次在 BEGIN IMMEDIATE 中确认原付款的有效证明与不可变绑定，CAS 将 PENDING 改为 DELIVERING，保存随机 claim token、kind、timestamp，并在网络调用前增加 retry count。并发调用或另一 SQLite handle 无法取得第二个执行权。

失败时保存稳定错误码，清除当前 claim，并根据次数转为 PENDING 或 EXHAUSTED。不支持的能力转为 UNSUPPORTED。首次恢复可立即运行，失败后的等待为 1、2、4 秒；`next_attempt_at` 保存在数据库，早到的重复调用不消耗次数。已 COMPLETE / EXHAUSTED / UNSUPPORTED 的记录不再进入自动交付队列。

只有持有数据目录独占权的后端，在启动且未接受请求时，才能回收崩溃留下的 claim；已消耗次数保留，第四次中断直接 EXHAUSTED，旧 token 无法完成新执行者的操作。打开数据库 handle 或普通查询不会回收 claim，也不会重置次数。领取后、发送前崩溃也消费该次机会，这是有界重试的保守选择。

App 后端每秒检查到期的 PAID 交付，串行执行并使用数据库中的等待时间；原 PAYMENT_UNKNOWN 不进入这个队列。暂停新付款或撤销/过期 grant 不影响已经付费的交付恢复。退出时停止安排下一次操作并等待已领取操作结束，重启继续原次数和状态。

## 声明式恢复能力

能力由后端批准的资源事实声明，保存到 SpendIntent，并纳入新 HTTP approval binding 和不可变交付快照。不能由 Agent、商家名称、任意 challenge extension 或响应中的指示临时扩大能力。

| Capability | 行为 |
|---|---|
| `none` / 未声明 | 不发送恢复 HTTP，不重新购买；保存 PAID + UNSUPPORTED。 |
| `idempotent_replay` | 使用同一 method/URL/headers/body 和原 PAYMENT-SIGNATURE；资源必须声明原凭据的幂等重放合同，不注入 Demo recovery header。 |
| `cached_replay` | 使用原请求和原凭据，附加批准的 cache-only header name/value。测试设施明确声明 PAYMENT-RECOVERY: 1；该标记不是所有商家的默认。 |
| `payment_identifier` | 对批准的同 origin、同访问类别 GET cache endpoint，以声明的 query/header 传递原 transaction 或 purchase UUID；不发送付款凭据。支持哪种 identifier 必须由该资源合同决定。 |

请求仍有超时、JSON 字节上限与重定向拒绝；cache URL 不能更换 origin、弱化 HTTPS 或覆盖已有 query selector，header 不能覆盖付款、认证、Host、method override 等控制字段。恢复响应使用现有资源 output schema，通用外部资源沿用本步之前的有界 JSON object 校验；这不承诺所有资源都采用相同输出格式或支持恢复。

## 不可能创建替代付款的边界

`delivery-recovery.ts` 不导入钱包、signer、交易构造器或 settlement API。它只能发送原保存 payload 的官方编码，或查询批准的 cache endpoint。重放前重新验证原签名 wire 的 payer、recipient、mint、金额及实际 message；不可改写 bytes 或换一个 transfer。即使资源重复提交相同签名交易，也不能变成另一笔新转账。

数据库 claim 必须有确定 PAID 的有效原证明，PAYMENT_UNKNOWN 没有交付执行权。交付完成需当前 claim token 与同一原 transaction；状态、data 和 claim 清理在一个事务内写入。重试没有预算预占、SpendGrant 消费、付款 claim 或支付状态写入，也不新建 purchase/request ID。

## 009 增量迁移

`009_durable_delivery_recovery` 新增 side table 和不可变 capability / 单调 retry count / payment→delivery 初始化约束；不改写 purchases、原 payload/proof、原交易证据、monetary scopes、预算或 SpendGrants。旧非 JSON proof 原样保留，但不能被解析为新回执或付款证明。

已有交付 data 保留为 COMPLETE。历史已付款但未交付的、明确注册的 Devnet 测试资源保留其已存在的 cache-only 合同，开始持久四次恢复预算；旧系统没有记录历史 retry count，因此不伪造旧次数，此预算只限制迁移后的恢复。未知/外部资源未声明能力时为 UNSUPPORTED；旧 execution mode 不可证明可用 Devnet 恢复时也不开放恢复。进行中和未知付款保留 NOT_PAID 交付状态及原预占。

迁移使用事务，失败回滚并拒绝启动；有效购买/资金证据缺失时不会开启交付重试，PAID 状态及原历史记录仍保留。

## 本步文件清单

| 文件 | 职责 |
|---|---|
| `src/modules/purchases/delivery-state.ts`（新增） | 交付/回执状态、四次预算及历史测试能力分类。 |
| `src/modules/purchases/delivery-migration.ts`（新增） | 009 增量表和不可变约束。 |
| `src/modules/purchases/delivery-recovery.ts`（新增） | 回执观察、原响应交付和无签名的能力驱动恢复。 |
| `src/modules/resources/delivery-capability.ts`（新增） | 能力校验和显式测试缓存合同。 |
| `src/modules/resources/http-resource.ts` | 能力 DTO 与安全 request/header 限制。 |
| `src/modules/authority/spend-intent.ts` | 保存批准的恢复能力。 |
| `src/modules/payment/resource-challenge.ts` | 能力纳入新批准绑定并在报价前校验。 |
| `src/modules/resources/market-spend-adapter.ts` | 通用及测试 intent 声明能力。 |
| `src/modules/purchases/purchase-ledger.ts` | 领取、失败/完成、重启回收和独立状态输出。 |
| `src/modules/purchases/approved-payment.ts` | 付款核对与交付恢复分开，保留 Mainnet blocker。 |
| `src/modules/purchases/request-paid-resource-purchase.ts` | 声明测试合同并输出独立状态。 |
| `src/modules/purchases/request-market-purchase.ts` | 历史入口输出独立状态。 |
| `src/modules/app/app-runtime.ts` | 独占启动回收、到期自动恢复和安全退出。 |
| `tests/unit/durable-delivery.test.ts`（新增） | 付款/回执/交付、并发、重启、耗尽、能力、会计及不重付回归。 |
| `docs/architecture/mainnet-readiness/durable-delivery-recovery.md`（新增） | 本步约束、兼容与验证记录。 |
| `plan.md` | 本步已授权范围。 |

## 验证与剩余范围

自动化使用临时数据库、临时 signer 和确定性 transfer/cache fixture，没有真实付款。全量 regression、typecheck、lint、backend build、native Release build 和实际安装版启动以本轮交付报告为准。

本轮验证：92 个测试文件、985 项测试通过，typecheck、lint、backend production build 和 native macOS Release build 通过。真实账本副本应用 009 后，15 张既有表内容摘要完全一致，保留 14 笔购买（6 DENIED、5 EXPIRED、3 PAID）和 8 个 SpendGrant，完整性正常、无 foreign-key 错误。旧 App 已正常退出并安全停服，安装版已更新到 `/Users/irin/Applications/Yosh.app`，与构建产物一致且签名验证通过。重新打开时等待系统钥匙串确认；在完成确认并取得本轮 backend-ready 证据前，不宣称安装版后端已就绪。

Mainnet 执行入口仍禁用、暂停且无可用授权；生产资源的具体能力合同和真实原付款/交付验收尚待后续授权。没有新增商家适配器、资源注册 UI、交付格式目录或 UI 状态设计。原账本 bigint/scope、签名器隔离、幂等与独立链上付款恢复不扩大范围。

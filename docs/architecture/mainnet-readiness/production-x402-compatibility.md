# P0 step 5: production x402 compatibility hardening

更新日期：2026-10-06。

本步加固现有通用 x402 流水线，使资源、请求和付款事实可以表达外部 HTTPS API；不新增商家适配器或付款栈。`live_mainnet` 仍禁止实际签名、提交和付款恢复。测试使用确定性 fixture，没有真实 Mainnet 付款。

## 官方 SDK 与本地边界

继续使用锁定的 `@x402/core` / `@x402/svm` 2.25.0：官方 HTTP adapter 解码 challenge、编码 payment signature、解码 settlement response，`x402Client` 的策略和 spend controls 限定唯一授权 requirement，`ExactSvmScheme` 构造并模拟交易。官方客户端已保留 resource metadata 和 challenge extensions；本步将完整 challenge 传给该能力，不再只重建 resource URL 和 accepts。

SDK 的 settlement header 解码返回 JSON，但不能替代 Yosh 的运行时 schema、购买绑定和原交易证明。本地只补充这些校验以及不可变账本约束，不另写协议编码或结算设施。

## 声明式资源与精确请求

`X402Resource` 明确包含 resource/provider ID、完整规范化 URL、HTTP method、有限 headers、可选 body、访问类别、Solana CAIP network、mint、精度、必填 recipient 和可选原子金额。recipient 来自后端批准的资源描述，并与 challenge 一致；没有 Demo 地址或生产商家默认值。

生产访问类别只允许外部 HTTPS；拒绝 URL 凭据、fragment、非规范化形式、直接 IP/loopback 和本机名称。测试 HTTP 只能显式声明 `test_loopback`，生产环境拒绝该类别。这不是任意 Agent URL 接口；资源事实由后端声明。此处不实现 DNS pinning，也不宣称解决所有 DNS rebinding 情况。

请求支持 GET、HEAD、POST、PUT、PATCH、DELETE；GET/HEAD 不允许 body。headers 只允许 `accept` 与 `content-type`，拒绝控制字符；body 最多 16 KiB。challenge 获取、首次付款 HTTP 请求和现有已付交付恢复使用同一 URL、method、headers、body，禁止重定向并设置超时。URL 的 origin、path 和 query 必须精确匹配；相对 challenge URL 仅在显式 loopback 测试中兼容。

SpendIntent 保存 `httpRequest` 与完整 `x402Challenge`，两者必须同时存在。request hash 包括完整请求；execution binding 包括网络/genesis、资产事实、买方、完整请求与 challenge。显示名称和模拟模式开关不改写已付 Devnet 的金融身份，执行许可仍由不可变 monetary scope 与执行 blocker 决定。签名前再次验证绑定；通用执行路径使用已批准 recipient，不读取 Demo merchant fallback。

## Challenge、memo 与扩展

本步支持 x402 V2 的单一 `exact` Solana requirement。拒绝不支持的版本/scheme、多个 payment alternatives、错误 network/mint/recipient、非规范十进制或越界金额、非法 fee payer，以及超过 300 秒或非整数的 timeout。Mainnet 配置必须匹配固定 CAIP genesis 标识、生产 USDC mint 和 6 位精度；`solana:mainnet` 等自由别名不是有效替代。

memo 可缺失，也可为任意有效的非空 UTF-8 字符串，最多 256 字节；不要求 `day4:` 前缀。缺失时由官方 SDK 生成 memo，账本继续从实际已签 message 保存 `actualMemo`，恢复查询使用实际值。

保留 challenge 的 resource metadata、extensions 与 requirement 的普通 extra metadata；若 Bazaar metadata 声明 HTTP method，必须与批准请求一致。扩展作为 JSON 事实保存和转交官方客户端，不由扩展授予付款权限。本步不新增未知扩展的交互式 hooks。签名构造时移除远端 blockhash/lifetime/RPC routing hints，使用已配置 RPC；原 challenge 仍原样保存在批准记录和证据绑定中。

## 严格回执与原交易证据

settlement header 有大小限制，解码后验证 success 的类型、Solana network、规范 payer/64-byte transaction signature、可选十进制原子 amount 和允许的 JSON extensions/extra；非法或未知字段拒绝。成功交付还必须匹配原购买 network、payer、已确认 transaction 和可选 amount。官方回执可能没有 amount，不能因此编造金额证据；精确转账金额仍由原交易链上验证证明。

格式不完整的回执若包含合法 transaction signature，可以在任何后续 RPC 等待前保存为查询线索；它不能单独将购买记为 PAID，也不能释放预占。未知付款继续核对原交易，不重新签名或生成替代付款。已付交付路径仍使用原付款凭据；本步未改变重试次数、调度或进度模型。

## 008 增量迁移与兼容

`008_http_purchase_bindings` 在 BEGIN IMMEDIATE 中新增 trigger，禁止改写新 HTTP-bound purchase 的 intent JSON 或 quote。迁移不重写任何历史行；失败回滚并拒绝启动。历史没有 `httpRequest` 的批准保留原 binding、payload、request/purchase ID、scope、SpendGrant、预占、PAID 和未知状态，不补造外部资源或 Mainnet 身份。

既有 Devnet market/paid-resource registry 保留显式测试用途与回归覆盖；原测试请求也可保存完整 challenge。测试服务仍可生成自己的 `day4:` memo，但通用客户端和原交易恢复不再以它为接受条件。

## 验证与剩余边界

测试覆盖外部 HTTPS、origin/path/query/method/body/header 绑定、Mainnet network/mint/recipient、缺失与任意 memo、challenge extensions、非法/不支持的 challenge、严格回执、无 Demo recipient fallback、同一执行入口、实际 memo、不可变记录和重启。全量回归、typecheck、lint、后端/原生 Release 构建及安装版启动结果以交付报告为准。

本轮实际验证：91 个测试文件、957 项测试通过，typecheck、lint、后端 production build 和原生 macOS Release build 通过。真实账本副本应用 008 后，15 张既有表的逐行内容摘要完全一致。安装版已按安全退出流程更新到 `/Users/irin/Applications/Yosh.app`，安装产物与构建一致且签名验证通过；重新启动日志确认后端就绪，监听仅为 `127.0.0.1:3049`，未认证管理请求返回 401。真实库已应用 008，完整性正常、无 foreign-key 错误，保留 14 笔购买（6 DENIED、5 EXPIRED、3 PAID）及 8 个 SpendGrant，Mainnet 购买为零。

Mainnet 执行开关和配置入口仍关闭，Mainnet 暂停且无可用 daily authority/SpendGrant。本步没有开放生产资源注册管理 UI/MCP，未新增商家集成、交付 schema 目录、扩展交互流程、交付重试设计或 UI 改造。实际生产资源验收及 Mainnet 执行需要后续具体授权和相应阶段完成。

## 本步文件清单

| 文件 | 本步职责 |
|---|---|
| `src/modules/resources/http-resource.ts`（新增） | 声明式请求、资源和 challenge DTO/schema。 |
| `src/modules/payment/resource-challenge.ts`（新增） | 精确请求获取、环境/报价校验和绑定。 |
| `src/modules/payment/x402-client.ts` | 官方解码后的 schema、严格回执与 signature hint。 |
| `src/modules/payment/solana-payment.ts` | 通用 memo、完整 challenge、SDK metadata/extension 保留。 |
| `src/modules/authority/spend-intent.ts` | 请求与完整 challenge 的成对字段。 |
| `src/modules/resources/market-spend-adapter.ts` | 声明式通用 SpendIntent factory。 |
| `src/modules/purchases/paid-resource-quote.ts` | 既有测试资源复用通用报价校验。 |
| `src/modules/purchases/request-paid-resource-purchase.ts` | 保存完整批准请求与 challenge。 |
| `src/modules/purchases/request-market-purchase.ts` | 删除测试 memo 前缀接受条件。 |
| `src/modules/purchases/approved-payment.ts` | 精确请求执行、recipient 绑定与回执校验。 |
| `src/modules/purchases/purchase-ledger.ts` | challenge/resource/extension 证据绑定和 008 迁移接入。 |
| `src/modules/purchases/http-binding-migration.ts`（新增） | 增量不可变约束。 |
| `src/modules/e2e/evidence.ts` | 测试证据兼容任意 memo，并校验完整 challenge。 |
| `tests/unit/production-x402.test.ts`（新增） | 通用生产事实与既有执行器的确定性回归。 |
| `tests/unit/solana-payment.test.ts` | memo 和官方 SDK metadata/extensions 回归。 |
| `docs/architecture/mainnet-readiness/production-x402-compatibility.md`（新增） | 本步边界、兼容和文件清单。 |
| `plan.md` | 记录本步已授权范围。 |

# Day 4 独立支付：运行与验收

## 当前状态

2026-09-09：支付代码、本地 Solana 真实交易验收、CLI 入口验收已完成。

**Devnet 最终验收尚未完成。** 本机没有配置项目专用的买方签名与买卖双方公钥，也没有确认买方已有 Circle 测试 USDC；公共 `api.devnet.solana.com` 在本次检查中连接超时。不得把 localnet 成功记作 Devnet 成功。

这个阶段仍不把钱包连接到 Agent，不实现 Day 5 的消费策略。市场 JSON 是标注 `is_demo_snapshot: true` 的示例数据。

## 已验证结果

- 132 项自动测试通过，TypeScript、ESLint、Next.js 生产构建通过。
- 未付款返回标准 x402 V2 `402` 和 `PAYMENT-REQUIRED`。
- 签名之前模拟完整交易；固定金额 10,000 最小单位（0.01 测试 USDC）。
- 通过官方 x402 SDK 构建交易，经本机测试 Facilitator HTTP `/verify`、`/settle`，在真实 local validator 确认。
- 第一笔买方余额 1 → 0.99，商家 0 → 0.01；手续费由独立 sponsor 支付，买方 SOL 余额为 0 仍可付款。
- API 返回 200、结算凭证和市场数据。并发重放和重开 SQLite 后重放不再结算。
- CLI 独立完成第二笔付款；CLI 重跑读取 CONFIRMED，不再生成交易。

本地测试证据（只能在对应 localnet 账本查询，不能在 Devnet Explorer 查询）：

- 本地网络：`solana:E3mc3j6LPd3AQadeh4xoW8zEJ5uyxLUu`
- 第一笔交易：`2KANF5KXFEN3RBULP4Vongh1zcGTb4YJXZf5BsTzEGtumvWUzTgkf86mrHZ7wJG8SPXFrYyc9Lr5TF3TMkJuRRKw`
- CLI 交易：`3w1j9rqYtPhKJucfqan74SRaPqnn8n4XEvPS61vyUsQPpP3oqTwxXnJGdPfaEYaBuAnwLKHEg1LGiDjA7vrGrxNS`
- 时间：`2026-09-09T03:12:21.564Z`

原始运行结果在未上传的 `.data/day4-localnet-result.json`；每次烟雾测试会更新它。

## 最短本地验收步骤

需要 Node.js 24+、Solana CLI/test-validator。执行 `npm ci`。

终端一：

```bash
npm run day4:localnet
```

终端二：

```bash
npm run day4:smoke
```

如果本地 8899 端口已有 validator，不要再启动第二个。`day4:localnet` 不带 `--reset`，避免清除已有账本。`day4:smoke` 不读取个人钱包；测试密钥只在进程内生成。它临时启动本机 HTTP Facilitator/API、建测试 mint/ATA、铸造测试代币、实际支付和验证，随后关闭 HTTP 测试服务。测试用 SQLite 和 CLI 日志留在系统临时目录，私钥不写文件。

独立 CLI 的签名付款日志包含签名载荷，写入权限为 0600，不得上传或分享。

## Devnet 最终验收步骤

1. 在 `.env.local` 配置 `SOLANA_CLUSTER=devnet`、可访问的 Devnet RPC、专用买方/商家公钥。Facilitator 默认 `https://x402.org/facilitator`。
2. 给买方标准 ATA 准备至少 0.01 Circle Devnet USDC，给商家创建相同 mint 的标准 ATA。商家不需要签名私钥。
3. 买方签名使用**已存在的项目专用测试钱包**：`DEMO_BUYER_KEYPAIR` 仅填写本机路径，或在执行 CLI 的进程环境中注入 `DEMO_BUYER_PRIVATE_KEY`（base58 或 64-byte JSON）。不在聊天、文档、Git 中粘贴私钥。
4. `npm run day4:preflight`。检查真实 genesis、经典 SPL Token/6 位精度、双方标准 ATA、余额、Facilitator 支持的网络及手续费付款方余额；失败会非零退出。
5. `npm run dev` 启动本机 API；另一个终端运行 `npm run day4:pay`。
6. 必须同时得到 `CONFIRMED`、可在 Devnet Explorer 查询的 TX、准确的买卖余额变化，以及 HTTP 200 市场数据，才能标记 Devnet 验收完成。

重复运行 `day4:pay` 会继续原付款或直接显示已完成。只有前笔已确认，且显式使用 `npm run day4:pay -- --new-payment`，才产生下一笔购买。CLI 使用跨进程 SQLite 锁，避免同时运行时各自生成付款。

官方网络和测试币说明：[x402 Network and Token Support](https://docs.x402.org/core-concepts/network-and-token-support)；默认 Facilitator 支持情况以运行时 `/supported` 为准。

## 自己指定钱包的 localnet 初始化

这是可选开发工具，自动验收无需它。向环境提供 `DEMO_BUYER_KEYPAIR` 和 `DEMO_MERCHANT_PUBLIC_KEY`，再执行 `npm run day4:localnet:init`。脚本验证本地链与买方地址，空投 2 个测试 SOL，创建一个新的 6 位测试 mint 和双方 ATA，给买方铸造 1 个测试 USDC，输出公开配置。不创建钱包密钥文件，不 reset 账本。

它仅准备账户和资金，不启动长期运行的 Facilitator。完整本机验收直接使用 `day4:smoke`，其中临时 Facilitator 仅监听本机且随测试退出。

## 支付边界与异常

- 报价由服务端生成，完整条件与有效期存 SQLite；27 字节 memo 含 128-bit 随机标识，并被签入链上交易。较长 UUID memo 曾超过 SDK 默认 20k 计算额度，本地模拟发现后已修复。
- SDK 对 localnet 自定义 CAIP 标识没有直接 RPC 分支：构建交易时只使用内部 Devnet SDK 分支并显式绑定 loopback RPC；线上载荷仍保留 localnet 网络值，真实 genesis 由 preflight 核验。这不等同于在 Devnet 发送交易。
- 服务端验证真实签名并要求 payer 为指定买方；旧 `demo-signature` 无效。
- 交易 message hash 和 quote ID 唯一约束防重复结算；缓存重取还核对完整原始交易的 hash，防止换签名取数据。
- 发送结算前先持久化 UNKNOWN；超时不生成新付款。SDK 对 `settlement_pending` 最多以相同 payload 核对一次，API 重放不会重新进入结算。
- `202` 表示结果尚未确定，不是成功或确定失败；有 TX 时保留到日志。使用该 TX 查询原链的 confirmed/finalized 状态，不能删除 UNKNOWN 日志来重新支付。自动对账/恢复交付留待后续阶段，此版本需要人工核对。
- 已确认同一付款可以从 SQLite 取回原响应。不要清理 `.data` 里的付款数据库或日志后继续使用原付款。
- 这是本地 Demo 服务，尚未加入公开互联网部署所需的访问控制、报价配额或数据保留清理策略。

## 每个修改文件的重点

| 文件 | 重点 |
|---|---|
| `.env.example` | 公开配置项、Devnet/localnet、CLI 签名来源、数据库位置；不含秘密。 |
| `.gitignore` | 排除本地账本、签名载荷、SQLite、个人 daily summary。 |
| `package.json` | 新增 preflight/pay/smoke/localnet 命令，显式 Kit/tsx 依赖，TypeScript 使用 SDK 支持的 5.9。 |
| `package-lock.json` | 锁定可通过 `npm ci` 重现的依赖版本。 |
| `README.md` | 当前真实完成状态、最短启动和付款步骤。 |
| `src/modules/payment/day4-config.ts` | 固定测试网络、mint、金额和地址检查，禁用 mainnet。 |
| `src/modules/payment/day4-preflight.ts` | 查询真实链、ATA、余额、代付方及 Facilitator 支持，失败即停止。 |
| `src/modules/payment/day4-wallet.ts` | 仅 CLI 的买方签名边界；校验公钥、隐藏解析错误、清零临时密钥字节。 |
| `src/modules/payment/day4-payment.ts` | 报价核对、签名前模拟、SDK 签名和独立 RPC 确认。 |
| `src/modules/paid-market-api/paid-market-api.ts` | 标准 402 报价、真实验证与结算、成功后提供数据、重放缓存。 |
| `src/modules/paid-market-api/settlement-store.ts` | SQLite 报价/状态存储、交易和报价唯一领取、重启后的防双付。 |
| `src/app/api/paid/market-snapshot/route.ts` | Next.js 动态接口，限制一个 SOL 参数，转交支付处理器。 |
| `scripts/day4-preflight.mjs` | 面向开发者的只读检查入口与非零失败码。 |
| `scripts/day4-localnet-init.sh` | 可选的自备买方钱包初始化；商家只需公钥，所有交易指定付费钱包。 |
| `scripts/day4-pay.ts` | 独立 CLI，保存并恢复原付款、跨进程锁、输出确认交易。 |
| `scripts/day4-localnet-smoke.ts` | 临时钱包、真实链/HTTP/CLI 支付及余额和重放验收。 |
| `tests/unit/day4-preflight.test.ts` | 网络伪装、mint/ATA不符、余额不足、Facilitator 错配等拒绝用例。 |
| `tests/unit/day4-payment.test.ts` | 报价被改、模拟失败、无效 RPC 状态不签名/不报成功。 |
| `tests/unit/day4-wallet.test.ts` | 签名输入格式、公钥匹配和错误信息不泄密。 |
| `tests/unit/paid-market-api.test.ts` | 真实结算边界、报价绑定、并发/重启幂等、UNKNOWN 状态。 |
| `docs/demo/day-4-runbook.md` | 本文件：操作步骤、实际验收证据、剩余阻断和逐文件说明。 |

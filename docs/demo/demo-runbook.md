# 本机网页演示：运行与验收

> 历史阶段说明中的 Day 编号和原交易 ID 保留用于追溯；文件名、代码入口和命令已更新为功能名称。
Day 7 接入原计划的三块界面、执行记录、环境检查和备用视频。沿用 Day 5 的消费规则、购买账本以及 Day 6 的真实模型回答与只读恢复。动态联网搜索 API、写入 SQLite 资源目录再购买，是之后的工作；本日仍使用固定 SOL 资源。

## 启动与演示

要求 Node.js 24.5+，沿用 `.env.local` 中已完成的模型、Devnet 账户和专用钥匙串钱包配置。不要把密钥填进任务框。

```bash
npm run build
npm run demo
```

打开 <http://127.0.0.1:3000>，点击“检查演示环境”，再使用标准任务：

> 根据价格、成交量和 RSI 分析 SOL 市场情况

1. 左侧展示任务、价格、已消费金额和剩余预算。
2. 中间依次出现模型规划、资源发现、402 报价、策略批准、签名、提交、链上确认、数据校验和分析完成。
3. 右侧显示回答、此次消费与原交易链接。
4. 执行中刷新，保留原任务继续观察；完成后点击“重新读取原任务”，此次新增付款为 0。
5. “新建另一个任务”使用新的任务编号；新的 SOL 分析可以购买一次。不要用新建任务替代未知付款的恢复。

首页记住上次任务，也支持 `/?taskId=<原任务编号>` 恢复指定记录。后台同一时间只运行一个网页任务；同编号不能改任务内容。浏览器关闭或刷新不取消后台执行。进程中断后页面会暂停，恢复时仍受原购买账本约束。

开发修改使用 `npm run demo:dev`；生产演示使用 `demo`，避免开发工具出现在演示页面。

## 文件链路与 review 重点

```text
src/app/page.tsx → src/app/task-console.tsx
  → POST /api/demo/tasks
  → local-request.ts（本机、同源、请求体上限）
  → demo-store.ts（原任务锁定、启动令牌、事件持久化）
  → scripts/task-worker.ts（固定后台入口）
  → task-runtime.ts（模型判断、资源、报价、消费规则）
  → approved-payment.ts（专用钱包签名、提交、原交易确认）
  → 模型使用已校验数据回答
  → demo-store.ts（只保存可展示结果）
  → GET /api/demo/tasks → 执行记录和回答
```

| 文件 | 重点关键字 | 主要职责 |
| --- | --- | --- |
| `src/app/task-console.tsx` | `TaskConsole`、`run`、`newTask` | 输入、每 1.5 秒读取记录、刷新恢复、结果复用；没有签名代码 |
| `src/app/api/demo/tasks/route.ts` | `GET`、`POST`、`spawn` | 启动固定 worker，返回安全记录与真实账本预算 |
| `src/modules/demo/local-request.ts` | `requireLocalRequest`、`smallJson` | 校验真实 Host 与 Origin；兼容 Next 的 localhost 归一化；最多 8192 字节 |
| `src/modules/demo/demo-store.ts` | `start`、`owns`、`recoverDeadRuns`、`finish` | SQLite 排他启动；旧进程不能覆盖新尝试；先提交事件再写 console |
| `src/modules/demo/trace.ts` | `executionEvent`、`traceTitles` | 稳定事件编号、顺序、actor、状态及固定标题 |
| `scripts/task-worker.ts` | `trace`、`display` | 复用原 runtime；只提取回答、交易 ID、金额和快照摘要 |
| `src/modules/agent/task-runtime.ts` | `trace`、`result` | 在真实阶段写记录，不用模拟进度；单独标注未知/失败付款 |
| `src/modules/purchases/approved-payment.ts` | `receivePayment`、`recoverApprovedPayment` | 原交易得到链上证据后才写确认事件，JSON 校验后才写数据事件 |
| `src/modules/purchases/purchase-ledger.ts` | `summary` | 从原账本计算已付款、预占、剩余日预算和未解决付款 |
| `src/modules/demo/preflight.ts` | `runDemoPreflight` | 模型、链路、报价、余额、账本、交易浏览器及历史模式检查 |
| `tests/unit/task-console.test.ts` | `local wallet boundary`、`durable execution` | 跨站、重复提交、重启、旧令牌、脱敏及 Console/网页事件一致性 |

UI 使用持久化轮询，不引入 SSE。每个事件拥有单任务递增 `sequence` 和稳定 `eventId`。Console 和页面都消费提交后的同一份 `DemoEvent`。事件命名比 Day 1 的概念目录更精简，合并尚无独立可信观测点的子阶段，不伪造服务端或模型内部过程。

## 环境检查与当前边界

```bash
npm run demo:preflight
```

该命令不付款，但会消耗一次真实模型调用。模型 API 的美元额度与页面展示的 Devnet 测试 USDC 预算是两套独立费用。

- 支付环境检查 Devnet、mint、买卖账户、Facilitator、RPC、402 报价，并要求买方至少有十次演示所需的 0.10 测试 USDC。
- 购买账本不能有未解决付款，剩余日预算至少为 0.10。
- 固定快照时间仍为 **2026-09-05 08:00 UTC**。使用原计划允许的历史 fixture 降级模式，页面和回答明确说明不是实时行情；没有伪造更新时间。实时行情的两小时新鲜度门槛未通过，也不适用于本历史演示模式。
- 2026-09-10 实测模型、付款环境、账本与展示字段检查通过；**Solana Explorer 在线请求返回 HTTP 429，严格的现场 preflight 尚未全绿**。保留失败提示及非零退出码，不把限流改成“通过”。链上确认仍由 RPC 和原交易消息校验提供，不依赖 Explorer 网页。
- 若 Explorer 不可访问，可先展示本地记录、原交易编号与备用视频；正式需要点击 Explorer 的演示，应在服务恢复后重跑 preflight。
- 展示字段自检只是代码层面的快速检查；完整验收另检查公开响应、客户端构建及录屏画面。它不等于对任意未知 secret 的全面检测。

服务只绑定本机。没有多人账号、远程部署或通用网站付款入口。任务文字和回答会保存在本机 SQLite；不要把 API 密钥或私人资料当演示输入。

## 2026-09-10 实际验收

- 网页标准任务：`web-0a26bf11-3942-4e75-b76b-73c6b59a086f`。
- 22:55:07 开始，22:55:20 确认原交易并校验数据，22:55:35 保存真实模型回答。
- 此次只购买一次 **0.01 测试 USDC**，买方余额从 0.88 变为 0.87。账本当天累计 0.10 → 0.11，日预算剩余 0.89。
- 执行期间刷新成功恢复；之后多次复用，同一任务只有一个 `SIGNED` 事件、一条购买记录及同一个交易 ID，新增付款为 0。
- 知识任务 `web-70f4c454-af94-46e4-828e-b390bd030a83`：“解释 Solana 是什么”，返回 `NO_PURCHASE`，没有签名或购买。
- 实际跨站 POST 返回 403。桌面 1360px 为三栏、手机 390px 为单栏，均无横向溢出。
- TypeScript、ESLint、199 项测试和生产构建通过；生产页面重读原任务成功。扫描 12 个客户端构建文件与公开响应，未出现已配置模型密钥或原交易签名载荷。视频关键画面已人工查看。

[查看原 Devnet 交易](https://explorer.solana.com/tx/2p4sKZkWm97u7SoxbKR9uhFSVnKpgF2GYqjWvcZLrjgy7QGh8kRWvAViKUwPekp6Lp9KUZkKC7XkyuPpZmN6gT9F?cluster=devnet)

本机证据保存在忽略目录 `.data/day7/`：

- `public-task.json`、`no-purchase.json`：公开任务响应；不包含支付载荷或启动令牌。
- `preflight.json`：实际环境检查结果，包含 Explorer 失败提示。
- `public-check.json`：客户端构建、公开响应及生产复用检查结果。
- `overview.png`、`payment-trace.png`、`result.png`：实际网页画面。
- `day7-demo.mp4`：约 20 秒的原任务复用回看视频，展示真实保存的付款记录和回答；不是又进行一次新购买的录像。

数据库、运行记录和视频均未纳入 Git；购买凭证仍保留在原受限账本中。

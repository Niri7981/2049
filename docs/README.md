# 文档索引

当前产品范围、实施阶段和验收证据以根目录的 [`plan.md`](../plan.md) 为准；开发与资金安全约束以 [`AGENTS.md`](../AGENTS.md) 为准。本文只负责导航。历史文档中的旧范围和旧状态不覆盖这两份文件。

## 当前产品与架构

- [macOS App 壳与本地服务生命周期](architecture/macos-app-shell.md)：App 壳、进程与本地服务边界。
- [Authority Core（阶段一）](architecture/authority-core.md)：当前通用消费意图、授权决策与预算预占模型。
- [MCP 接入](architecture/mcp-integration.md)：当前 MCP 工具、权限边界、验证状态与限制。
- [按职责命名与历史数据兼容](architecture/naming.md)：代码重命名与旧数据标识兼容。
- [原生 macOS UI 设计参考](design/README.md)：Agent Card 视觉参考；产品约束以 [`2049-ui` Skill](../.codex/skills/2049-ui/SKILL.md) 为准。

当前进度和验收结果请直接查阅 [`plan.md`](../plan.md)。上面的架构文档补充模块细节，不单独代表最新验收状态。

## V0 测试网 Demo：历史架构设计

以下文档保留早期固定行情 Demo 的设计背景和安全约束，不作为新 App 的现行产品规格。遇到冲突时，以 `plan.md`、`AGENTS.md` 和当前实现为准。

### 产品范围与总体结构

- [Product Definition](architecture/product-definition.md)
- [V0 Scope](architecture/v0-scope.md)
- [Architecture Overview](architecture/overview.md)

### 角色、流程与状态

- [System Actors](architecture/system-actors.md)
- [Happy Path](architecture/happy-path.md)
- [State Machine](architecture/state-machine.md)
- [Execution Trace](architecture/execution-trace.md)

### Resource 与购买合同

- [Resource Schema](architecture/resource-schema.md)
- [PurchaseRequest Schema](architecture/purchase-request-schema.md)：旧 V0 请求记录；当前通用消费意图见 Authority Core。
- [Paid Market Data](architecture/paid-market-data.md)：固定行情 Demo 的 API 数据合同。

### 授权、钱包与支付

- [Spending Policy](architecture/spending-policy.md)：旧 V0 策略设计；当前授权决策名称和边界以 Authority Core 与实施计划为准。
- [Wallet Architecture](architecture/wallet-architecture.md)
- [x402 Payment Flow](architecture/x402-flow.md)
- [Risks and Fallbacks](architecture/risks-and-fallbacks.md)

## 验证与演示资料

### 隔离验收

- [Bound Devnet E2E validation](demo/bound-e2e-validation.md)：隔离数据目录下的验收准备与只读证据检查。

### 历史演示与运行手册

这些手册记录旧网页 Demo、CLI 购买和独立支付流程，保留供测试设施追溯使用，不代表新 App 的默认运行方式。部分步骤会调用真实模型或执行 Devnet 付款；执行前须按实施计划核对当前环境和授权范围。

- [网页 Demo 运行与验收](demo/demo-runbook.md)
- [完整任务运行与验收](demo/task-acceptance-runbook.md)
- [受规则约束的自动购买](demo/purchase-runbook.md)
- [独立支付运行与验收](demo/payment-runbook.md)
- [标准 Demo 输入](demo/demo-input.md) · [标准 Demo 输出](demo/demo-output.md)
- [资源发现开发计划（历史设计）](demo/discovery-plan.md)

## 设计素材

- [2049 UI 设计参考](design/README.md)：说明卡片图片与 Phantom 录屏的使用边界，并链接素材。

## 历史审计

- [2026-09-21 仓库审计与黑客松交付分析](hackathon-audit-2026-09-21.md)：以文档中注明的提交和日期为基线的审计快照；后续状态请查阅 `plan.md`。

本机可能另有被 Git 忽略的 `docs/daily-summary.md` 和 `.DS_Store`。它们不是共享项目文档或当前状态来源。

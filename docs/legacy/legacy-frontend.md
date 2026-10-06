# 旧前端保留边界

当前权威客户端是 `apps/macos/Yosh/` 中的原生 macOS SwiftUI App。

暂时保留的旧客户端文件为 `src/app/page.tsx`、`src/app/app-dashboard.tsx`、`src/app/layout.tsx` 和 `src/app/globals.css`。原生客户端尚未覆盖旧界面的全部管理功能；Electron 仍负责本地服务生命周期、认证和 IPC。

`src/app/api/`、`src/modules/`、`scripts/` 和 `tests/` 属于受保护的后端与验证代码。`electron/main.cjs` 和 `electron/preload.cjs` 必须保留，直到原生运行时具备等效的服务管理能力。

第一阶段仅移除了未被运行时代码、package 脚本或测试导入的 `src/app/discovery-demo.tsx` 与 `src/app/task-console.tsx`。

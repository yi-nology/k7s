# k7s 架构文档

## 系统概述

k7s 是一个 Kubernetes 可视化监控桌面应用，采用 Tauri 2 + Rust + React 技术栈。

## 架构层次

```
┌─────────────────────────────────────┐
│           React Frontend            │
│  (TypeScript, Zustand, Vitest)      │
├─────────────────────────────────────┤
│          Provider Layer             │
│  (HttpProvider, TauriProvider,      │
│   MockProvider)                     │
├─────────────────────────────────────┤
│           Tauri IPC                 │
├─────────────────────────────────────┤
│          Rust Backend               │
│  (kube-rs, axum, MCP)              │
├─────────────────────────────────────┤
│        Kubernetes API               │
└─────────────────────────────────────┘
```

## 模块边界

### 前端模块

- `src/components/` - UI 组件
- `src/hooks/` - 自定义 Hooks
- `src/lib/` - 工具函数
- `src/providers/` - 数据提供者
- `src/store.ts` - 状态管理

### 后端模块

- `src-tauri/src/kube/` - Kubernetes 操作（client、watcher、drain、helm、镜像同步等）
- `src-tauri/src/commands/` - Tauri 命令（桌面端的 invoke 入口）
- `src-tauri/src/ai/` - AI 助手（agent loop、LLM、sandbox、permission、memory、IM hooks 等）
- `src-tauri/src/core/` - 跨 shell 的共享状态（CoreState、prefs、events、shell 公共逻辑）
- `src-tauri/src/web/` - HTTP 服务器（k7s-web，axum + SSE + 鉴权）
- `src-tauri/src/mcp/` - MCP 服务器（k7s-mcp / k7s-web 的 `/mcp`，向 AI 客户端暴露工具）

## 数据流

```
User Action
    ↓
React Component
    ↓
Provider (HttpProvider/TauriProvider/MockProvider)
    ↓
Tauri IPC / HTTP Request（Web 模式带 Bearer token）
    ↓
Rust Command Handler（commands/ 或 web/handlers）
    ↓
kube-rs Client / AI Agent Loop / MCP Tools
    ↓
Kubernetes API / LLM Provider
    ↓
Response → UI Update
```

### 多入口

三个二进制共用 `k7s_lib`，业务逻辑只有一份：

- `k7s`（Tauri 桌面端）— `commands/` 经 Tauri IPC 暴露。
- `k7s-web`（axum）— `web/` 经 HTTP 暴露，`/api/invoke/*` 与 `/hooks/*`
  需 Bearer token（loopback 自动生成并经 `GET /api/web-token` 发布给同源
  SPA；非 loopback 需设 `K7S_WEB_TOKEN`）。
- `k7s-mcp`（stdio）— `mcp/` 经 MCP 协议暴露给 AI 客户端。

### AI 路径

`ai/agent.rs` 的 ReAct 循环 → `tools/` 注册的工具 → `permission`/`sandbox`
双重门禁 → kube 操作或 LLM 调用。桌面端默认 `ReadConfirmWrite`（写操作需
确认）；**Web 模式强制 `ReadOnly`**（写操作一律拒绝），即使配置为 FullAuto。

## 构建目标

1. **桌面应用**：`pnpm tauri:build`
2. **Web 服务器**：`cargo build --features web --bin k7s-web`
3. **MCP 服务器**：`cargo build --features mcp --bin k7s-mcp`

## 测试策略

- 前端：Vitest + React Testing Library
- 后端：cargo test + 18 个 live verification examples
- CI：GitHub Actions 运行完整测试套件

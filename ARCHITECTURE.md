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

- `src-tauri/src/kube/` - Kubernetes 操作
- `src-tauri/src/commands/` - Tauri 命令
- `src-tauri/src/web/` - HTTP 服务器
- `src-tauri/src/mcp/` - MCP 服务器

## 数据流

```
User Action
    ↓
React Component
    ↓
Provider (HttpProvider/TauriProvider)
    ↓
Tauri IPC / HTTP Request
    ↓
Rust Command Handler
    ↓
kube-rs Client
    ↓
Kubernetes API
    ↓
Response → UI Update
```

## 构建目标

1. **桌面应用**：`pnpm tauri:build`
2. **Web 服务器**：`cargo build --features web --bin k7s-web`
3. **MCP 服务器**：`cargo build --features mcp --bin k7s-mcp`

## 测试策略

- 前端：Vitest + React Testing Library
- 后端：cargo test + 18 个 live verification examples
- CI：GitHub Actions 运行完整测试套件

# k7s 架构文档

## 系统概述

k7s 是一个 Kubernetes 可视化监控工具，Tauri 2 + Rust + React 技术栈，单一 monorepo（Cargo workspace + pnpm frontend）。

## 架构层次

```
┌─────────────────────────────────────────────┐
│              React Frontend                 │
│  (frontend/, TypeScript, Zustand, Vitest)   │
├─────────────────────────────────────────────┤
│              Provider Layer                 │
│  (HttpProvider / TauriProvider /            │
│   MockProvider，wire format 完全一致)        │
├─────────────────────────────────────────────┤
│      Tauri IPC   或   HTTP + Bearer         │
├─────────────────────────────────────────────┤
│  k7s-commands (#[tauri::command])           │
│  k7s-server web /api/invoke/{cmd} 动态路由    │
├─────────────────────────────────────────────┤
│   CommandRegistry（k7s-core::core::commands）│
├─────────────────────────────────────────────┤
│      Rust Core（k7s-core: kube + ai）        │
├─────────────────────────────────────────────┤
│         Kubernetes API / LLM Provider        │
└─────────────────────────────────────────────┘
```

## Crate 职责

| Crate | 职责 |
|---|---|
| `k7s-deps` | 依赖伞仓：统一 ~30 个共享依赖版本，业务代码经 `k7s_deps::` 引用 |
| `k7s-core` | 全部业务逻辑：`kube/`（client、watcher、mappers、helm、镜像、SBOM…）、`ai/`（agent loop、LLM、tools、memory、sandbox…）、`core/`（CoreState、prefs、EventSink、**CommandRegistry**）。不含任何传输类型 |
| `k7s-commands` | 唯一的 Tauri 命令面：每命令一个 `_impl(Arc<CoreState>, args)` 业务函数 + `#[tauri::command]` 薄包装；`registry.rs` 把非 AI 命令注册进 CommandRegistry；`register_commands!()` 宏在三个 shell 展开完整 generate_handler 列表 |
| `k7s-server` | 两个传输：`web/`（axum，`POST /api/invoke/{cmd}` 查表分发 + AI 专属 handler + SSE + 密码门）、`mcp/`（rmcp 工具，业务直调 core）；bin：`k7s-web`、`k7s-mcp` |
| `k7s-desktop` / `k7s-ios` / `k7s-android` | 薄壳：Tauri builder、平台插件（window-state/dialog/keychain）、`register_commands!()`。平台命令面差异全部用 `#[cfg(target_os)]` 表达在 k7s-commands 内 |

## 数据流

```
User Action
    ↓
React Component
    ↓
Provider（Tauri invoke / httpInvoke，参数 camelCase）
    ↓
Tauri command 薄包装 ──或── web 动态路由（registry 查表）
    ↓（同一条路）
*_impl(state, args)
    ↓
k7s-core（kube / ai）
    ↓
K8s API / LLM
    ↓
响应 → {ok, data|error} → UI
推送 → EventSink（Tauri emit / SSE broadcast）→ UI 更新
```

### 命令接缝（CommandRegistry）

`k7s-core/src/core/commands.rs` 的 `CommandRegistry` 是 Tauri 与 Web 的共用命令表：name → `Fn(Arc<CoreState>, Value) -> Future<AppResult<Value>>`。`k7s-commands/src/registry.rs` 注册全部非 AI 命令（AI 保持 web 专属 handler：ReadOnly 强制、SSE 流、审批流）。新增命令：

1. `k7s-commands/src/commands/<域>.rs` 写 `xxx_impl` + `#[tauri::command]` 包装（自动生成 Args 结构，camelCase wire）
2. `registry.rs` 加一行 `r.register("xxx", ...)`
3. `lib.rs` 的 `register_commands!` 宏列表加一项

Tauri、Web 两个传输即刻同时可用。

## 多入口

- `k7s`（Tauri 桌面端）— crates/k7s-desktop，命令经 Tauri IPC。
- `k7s-web`（axum）— crates/k7s-server，`/api/invoke/*` 与 `/hooks/*` 需 Bearer token（loopback 自动生成经 `GET /api/web-token` 发布）或会话 cookie（argon2 密码门）。**Web 模式强制 AI ReadOnly**。
- `k7s-mcp`（stdio）— 同 crate，向 AI 客户端暴露工具。
- `k7s-ios` / `k7s-android` — 移动薄壳，命令面经 cfg 裁剪（iOS 无 AI/Helm/SBOM 等；Android 无 CLI 依赖的镜像操作）。

## AI 路径

`k7s-core/ai/agent.rs` ReAct 循环 → `tools/` → `permission`/`sandbox` 双重门禁 → kube 操作或 LLM 调用。桌面默认 `ReadConfirmWrite`；Web 强制 `ReadOnly`。

## 测试策略

- Rust：`cargo test --workspace`（k7s-core 377+ 单测、k7s-commands、k7s-server web_api 集成测试含注册表分发用例）
- 前端：Vitest + React Testing Library（`pnpm test`）
- E2E：Playwright（`frontend/e2e/`）
- CI：`.github/workflows/ci.yml`（fmt/clippy/test + 前端 typecheck/lint/test/build）

## 构建目标

```bash
cargo build -p k7s                                                  # 桌面
cargo build -p k7s-server --features k7s-server/web --bin k7s-web   # Web 服务
cargo build -p k7s-server --features k7s-server/mcp --bin k7s-mcp   # MCP
```

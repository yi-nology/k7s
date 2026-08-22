# k7s — Lens-style Kubernetes Visual Monitor

Tauri 2 + Rust + React 的 Kubernetes 可视化监控工具。单一 monorepo，一份业务实现，三个平台薄壳（Desktop / iOS / Android）+ 两个额外传输（Web / MCP）。

## 仓库布局

```
k7/
├── Cargo.toml            # Cargo workspace（单一 lock，统一依赖版本）
├── crates/
│   ├── k7s-deps/         # 共享依赖伞仓（统一 ~30 个关键依赖版本）
│   ├── k7s-core/         # 业务核心：kube/（K8s 全部管道）、ai/（agent loop）、core/（共享状态 + CommandRegistry）
│   ├── k7s-commands/     # 全部 #[tauri::command]（唯一命令面，平台差异用 cfg 表达）
│   ├── k7s-server/       # axum Web 壳 + MCP 服务器（k7s-web / k7s-mcp 两个 bin）
│   ├── k7s-desktop/      # 桌面薄壳（窗口、插件、平台专属命令）
│   ├── k7s-ios/          # iPadOS 薄壳
│   └── k7s-android/      # Android 薄壳
├── frontend/             # React 19 + Vite 前端（三壳共用同一构建产物）
├── deploy/               # Docker / docker-compose / 安装脚本
└── docs/                 # 架构文档、开发指南、测试计划
```

## 架构速览

```
React Frontend (frontend/)
    ↓ Provider 抽象（TauriProvider / HttpProvider / MockProvider）
Tauri IPC  或  HTTP POST /api/invoke/{cmd}
    ↓
k7s-commands（#[tauri::command] 薄包装）  或  k7s-server 动态路由
    ↓ 两者共用
CommandRegistry（k7s-core，name → handler(Arc<CoreState>, JSON)）
    ↓
k7s-core 业务实现（kube / ai）
    ↓
Kubernetes API / LLM
```

新增一个命令只需：`k7s-commands` 写 `_impl` + `#[tauri::command]` 包装 → `registry.rs` 注册一行 → Tauri / Web 两个传输同时可用。MCP 工具直接调用 core 业务函数。

## 常用命令

```bash
# Rust 全仓
cargo test --workspace                  # 单测 + 集成测试
cargo check -p k7s-server --features web,mcp
cargo clippy --workspace --all-targets

# 前端（frontend/ 目录）
pnpm install
pnpm dev                                # Vite dev server (1420)
pnpm test -- --run
pnpm build

# 桌面应用
cd frontend && pnpm build && cd .. && cp -r frontend/dist dist
cargo build -p k7s                      # 或 pnpm tauri:build

# Web 服务器（单二进制，内嵌前端）
cargo build -p k7s-server --features k7s-server/web --bin k7s-web

# MCP 服务器（stdio）
cargo build -p k7s-server --features k7s-server/mcp --bin k7s-mcp

# 移动端
cd crates/k7s-ios && make simulator    # 或 crates/k7s-android && make debug
```

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 架构与数据流
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — 开发指南
- [docs/TEST_PLAN.md](docs/TEST_PLAN.md) — 测试计划
- [deploy/DOCKER.md](deploy/DOCKER.md) — Docker 部署

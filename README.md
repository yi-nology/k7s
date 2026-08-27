# k7s — Lens-style Kubernetes Visual Monitor

Tauri 2 + Rust + React 的 Kubernetes 可视化监控工具。

## 仓库模型：独立仓 + 本地 monorepo 聚合

**每个 crate 都是独立 GitHub 仓**（`yi-nology/k7s-*`），manifest 独立可构建（git 依赖互相引用）：

| 仓库 | 职责 |
|---|---|
| [k7s-deps](https://github.com/yi-nology/k7s-deps) | 依赖伞仓（统一 ~30 个关键依赖版本） |
| [k7s-core](https://github.com/yi-nology/k7s-core) | 业务核心：kube/（K8s 管道）、ai/（agent loop）、core/（共享状态 + CommandRegistry） |
| [k7s-commands](https://github.com/yi-nology/k7s-commands) | 全部 `#[tauri::command]`（唯一命令面，平台差异用 cfg 表达） |
| [k7s-server](https://github.com/yi-nology/k7s-server) | axum Web 壳 + MCP 服务器（k7s-web / k7s-mcp） |
| [k7s-desktop](https://github.com/yi-nology/k7s-desktop) | 桌面薄壳 |
| [k7s-ios](https://github.com/yi-nology/k7s-ios) / [k7s-android](https://github.com/yi-nology/k7s-android) | 移动薄壳 |
| [k7s-frontend](https://github.com/yi-nology/k7s-frontend) | React 19 + Vite 前端 |
| [k7s](https://github.com/yi-nology/k7s) | 文档、发布工作流、部署资产 |

**本地开发**：把各仓 clone 为同级目录（或直接使用本目录），根 `Cargo.toml` 的 `[patch]` 把所有 git 依赖重定向到本地同级 checkout——单一 target/、单一 Cargo.lock、改一处全仓生效，且与各独立仓完全兼容：

```
k7/                      # 本地聚合根（此目录）
├── Cargo.toml           # workspace + [patch] → crates/*
├── crates/k7s-*         # 各独立仓的本地 checkout（subtree 组装，历史保留）
├── frontend/            # k7s-frontend checkout
├── deploy/  docs/
└── Makefile             # make dist / make test
```

## 架构速览

```
React Frontend (k7s-frontend)
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

新增一个命令：`k7s-commands` 写 `xxx_impl` + `#[tauri::command]` 包装 → `registry.rs` 注册 → `register_commands!` 宏列表加一项；Tauri/Web 两个传输同时可用。

## 常用命令

```bash
# 前端（frontend/）
pnpm install && pnpm dev        # Vite dev server (1420)
pnpm test -- --run && pnpm build

# 本地聚合根（k7/）
make dist                       # 构建前端并分发到各 ./dist
make test                       # CI 同款全量验证
cargo test --workspace

# 独立仓内（任一 crates/k7s-*）
cargo test                      # git 依赖自动解析同级仓

# 发布
# k7s 仓的 .github/workflows/release-desktop.yml / release-docker.yml
```

## 安全模型

- **k7s-web / MCP（`/mcp`）**：除 `/health`、`/api/health`、`/api/auth/*` 外全部要求
  `Authorization: Bearer <K7S_WEB_TOKEN>`（或有效的密码会话 Cookie）。loopback 部署自动生成
  token（SPA 从 `GET /api/web-token` 自取）；非 loopback 必须显式设置 `K7S_WEB_TOKEN`
  （Docker 部署通过 compose 环境变量透传）。跨网暴露请置于 TLS 反代之后——服务本身是明文 HTTP。
- **登录限速**：密码错误 5 次/60 秒后返回 429。
- **AI/MCP 默认只读**：web 端 agent 强制 ReadOnly；cron 定时任务 headless 执行，写操作审批一律拒绝。
- **Secret 脱敏**：AI describe 与选中上下文默认将 Secret 的 `data`/`stringData` 打码
  （`include_secrets: true` 显式开启）。
- **审计日志**：危险操作（delete/apply/drain/node shell/helm 等）记录到 `<data_dir>/audit.log`（JSONL）。

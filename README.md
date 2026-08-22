# k7s — 文档与发布仓

k7s 是一个 Tauri 2 + Rust + React 的 Kubernetes 可视化监控工具。本仓持有跨仓文档、发布工作流和部署资产；代码在各独立仓：

| 仓库 | 职责 |
|---|---|
| [k7s-deps](https://github.com/yi-nology/k7s-deps) | 依赖伞仓（统一 ~30 个关键依赖版本） |
| [k7s-core](https://github.com/yi-nology/k7s-core) | 业务核心：kube/（K8s 管道）、ai/（agent loop）、core/（共享状态 + CommandRegistry） |
| [k7s-commands](https://github.com/yi-nology/k7s-commands) | 全部 `#[tauri::command]`（唯一命令面，平台差异用 cfg 表达） |
| [k7s-server](https://github.com/yi-nology/k7s-server) | axum Web 壳 + MCP 服务器（k7s-web / k7s-mcp） |
| [k7s-desktop](https://github.com/yi-nology/k7s-desktop) | 桌面薄壳 |
| [k7s-ios](https://github.com/yi-nology/k7s-ios) / [k7s-android](https://github.com/yi-nology/k7s-android) | 移动薄壳 |
| [k7s-frontend](https://github.com/yi-nology/k7s-frontend) | React 19 + Vite 前端 |

本地开发推荐把各仓 clone 成同级目录，并放置一份聚合根 `Cargo.toml`（`[patch]` 把 git 依赖重定向到同级 checkout），即可单 target、单 lock 联合开发——见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 发布

- `release-desktop.yml`：tag `v*` 触发，多平台桌面构建 + k7s-web 静态二进制
- `release-docker.yml`：多架构 Docker 镜像推送 ghcr.io

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 架构与数据流
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — 开发指南
- [docs/TEST_PLAN.md](docs/TEST_PLAN.md) — 测试计划
- [deploy/DOCKER.md](deploy/DOCKER.md) — Docker 部署

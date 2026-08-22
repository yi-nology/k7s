# k7s — Lens-style Kubernetes 可视化监控

Tauri 2 + Rust + React 构建的 Kubernetes 桌面/Web 双形态监控与运维工具：实时资源表格、服务拓扑、可观测性、安全审计、内置 AI 助手与 MCP 服务器。

![概览仪表盘](docs/screenshots/k7s-overview.png)

![工作负载表格](docs/screenshots/k7s-workloads.png)

![资源详情](docs/screenshots/k7s-detail.png)

![服务拓扑](docs/screenshots/k7s-topology.png)

![AI 助手](docs/screenshots/k7s-ai.png)

## 特性

- **实时监控** — 全资源类型监听推送（表格零刷新）、节点/Pod 指标、事件流、集群健康横幅
- **资源运维** — YAML 行内编辑（dry-run diff）、扩缩容、滚动回滚、排空节点、Pod 终端、日志流、端口转发
- **网络诊断** — Ingress→Service→Pod 服务拓扑图、Ingress 路由树、NetworkPolicy 连通性模拟
- **可观测性** — 多实例 Prometheus/Grafana/AlertManager/Loki 统一入口、PromQL 即时查询与保存
- **安全** — RBAC 权限矩阵与越权审计、镜像/集群 SBOM、漏洞扫描（trivy/grype）
- **镜像管理** — 多 registry、气隙导入/导出/同步
- **Helm 市场** — 仓库管理、图表搜索、版本部署
- **AI 助手** — ReAct Agent + 集群四层记忆 + 定时任务；桌面端写操作确认，Web 端强制只读
- **MCP 服务器** — 96 个工具接入任意 AI 客户端（stdio + Streamable HTTP）
- **跨平台** — macOS / Windows / Linux(x64+ARM64) 桌面版；单二进制 musl 静态 Web 版（含麒麟兼容包）；iPadOS / Android 移动版
- **中英双语 / 深浅主题**

## 快速开始

### 桌面版

从 [Releases](https://github.com/yi-nology/k7s/releases/latest) 下载安装包，启动即读 `~/.kube/config`。

### Web 服务器版（单文件，零依赖）

```bash
curl -LO https://github.com/yi-nology/k7s/releases/latest/download/k7s-web-linux-x86_64-static
chmod +x k7s-web-linux-x86_64-static
./k7s-web-linux-x86_64-static            # http://127.0.0.1:7180
```

### Docker

```bash
docker run -d -p 7180:8080 \
  -v ~/.kube/config:/home/k7s/.kube/config:ro \
  ghcr.io/yi-nology/k7s:latest
```

📖 完整使用说明见 **[docs/USAGE.md](docs/USAGE.md)**（安装、多集群、各项功能、快捷键、Web 认证、MCP 接入、FAQ）。

## 仓库模型

每个组件是独立 GitHub 仓（独立 CI，git 依赖互相引用）：

| 仓库 | 职责 |
|---|---|
| [k7s-deps](https://github.com/yi-nology/k7s-deps) | 依赖伞仓（统一 ~30 个关键依赖版本） |
| [k7s-core](https://github.com/yi-nology/k7s-core) | 业务核心：kube/（K8s 管道）、ai/（agent loop）、core/（共享状态 + CommandRegistry） |
| [k7s-commands](https://github.com/yi-nology/k7s-commands) | 全部 `#[tauri::command]`（唯一命令面，平台差异用 cfg 表达） |
| [k7s-server](https://github.com/yi-nology/k7s-server) | axum Web 壳 + MCP 服务器（k7s-web / k7s-mcp） |
| [k7s-desktop](https://github.com/yi-nology/k7s-desktop) | 桌面薄壳 |
| [k7s-ios](https://github.com/yi-nology/k7s-ios) / [k7s-android](https://github.com/yi-nology/k7s-android) | 移动薄壳 |
| [k7s-frontend](https://github.com/yi-nology/k7s-frontend) | React 19 + Vite 前端 |
| **k7s**（本仓） | 文档、发布工作流、部署资产 |

## 架构

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

详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 本地开发

```bash
git clone git@github.com:yi-nology/k7s-frontend.git
git clone git@github.com:yi-nology/k7s-desktop.git   # 及其余各仓，同级目录
cd k7s-frontend && pnpm install && pnpm build && cd ..
cd k7s-desktop && cp -r ../k7s-frontend/dist dist && cargo run
```

## 文档

- [使用说明](docs/USAGE.md) — 安装、功能导览、快捷键、FAQ
- [架构文档](docs/ARCHITECTURE.md) — 分层与数据流
- [开发指南](docs/DEVELOPMENT.md) / [测试计划](docs/TEST_PLAN.md)
- [Docker 部署](deploy/DOCKER.md)
- [更新日志](CHANGELOG.md)

## License

MIT

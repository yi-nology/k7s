# k7s

> 桌面级 Kubernetes 监控器，具有 Linear / Vercel 美学 — **并且**内置 stdio + HTTP MCP server（79 个工具），让任意 AI 客户端都能以相同方式驱动真实集群。

![k7s — pods table (dark)](docs/screenshots/01-pods-table.png)

> `k7s` —— 因为 1337 语里 `t` 就是 `7`。

**语言 / Languages**: [English](README.md) · [简体中文](README.zh-CN.md)

一个深色、类 Lens 风格的 Kubernetes 可视化监控器，使用 **Tauri 2 + Rust + React** 构建，提供三种可互换的运行模式：原生**桌面应用**（`k7s`）、单二进制**网页服务器**（`k7s-web`）、以及 **MCP server**（`k7s-mcp`），将完整功能暴露给 AI 客户端。

支持 **macOS** 和 **Linux**（桌面端），通过 `k7s-web` 可在**任意浏览器**中运行（包括 **Windows 7**），并提供**多架构 Docker 镜像**。灵感来自 [k9s](https://k9scli.io/) 和参考项目 [lyuke/k7s](https://github.com/lyuke/k7s)。

---

## 目录

- [🚀 快速开始](#-快速开始)
- [🤔 为什么选择 k7s（与 Lens / KubePi / Headlamp 对比）](#-为什么选择-k7s与-lens--kubepi--headlamp-对比)
- [✨ 功能](#-功能)
- [🤖 MCP server — 79 个工具](#-mcp-server--79-个工具)
- [🖼 三种运行方式](#-三种运行方式)
- [📸 截图](#-截图)
- [🧱 技术栈](#-技术栈)
- [📁 项目结构](#-项目结构)
- [🎨 设计语言](#-设计语言)
- [🚀 开发](#-开发)
- [📦 构建发布包](#-构建发布包)
- [🐳 Docker / 服务器部署](#-docker--服务器部署)
- [🪟 Windows 7 / 网页服务器模式](#-windows-7--网页服务器模式)
- [🧪 测试](#-测试)
- [🧩 扩展 k7s](#-扩展-k7s)
- [🗺 路线图](#-路线图)
- [📄 许可证](#-许可证)
- [👤 作者](#-作者)

---

## 🚀 快速开始

**macOS (Apple Silicon) / Linux — 一行命令：**

```bash
curl -fsSL https://raw.githubusercontent.com/zy84338719/k7s/main/install.sh | bash
```

脚本自动检测操作系统和架构，下载最新版本并安装：
- **macOS**（Apple Silicon）：挂载 `.dmg` 并将 `k7s.app` 复制到 `/Applications`
- **Linux (deb)**：通过 dpkg 安装 `.deb` 包（Debian/Ubuntu）
- **Linux (rpm)**：通过 dnf/yum 安装 `.rpm` 包（Fedora/RHEL/CentOS）
- **Linux (回退)**：安装 AppImage 到 `~/.local/bin/`
- 支持 **amd64** 和 **arm64** 架构

**或者拉取 Docker 镜像：**

```bash
docker run -d --name k7s -p 8080:8080 \
  -v ~/.kube/config:/home/k7s/.kube/config:ro \
  ghcr.io/zy84338719/k7s:latest
# → 打开 http://localhost:8080
```

**Windows / macOS Intel：** 从 [GitHub Releases](https://github.com/zy84338719/k7s/releases) 下载对应安装包。Windows 7 用户请参阅 [Windows 7 / 网页服务器模式](#-windows-7--网页服务器模式)。

---

## 🤔 为什么选择 k7s（与 Lens / KubePi / Headlamp 对比）

k7s、[Lens](https://k8slens.dev/)、[KubePi](https://github.com/1Panel-dev/KubePi) 和 [Headlamp](https://headlamp.dev/) 都是 Kubernetes 仪表盘，但它们面向不同的用户群体。选择不在于*功能清单的对齐*，而在于**谁在操作**以及**是否有 AI 参与**。以下是诚实的功能级对比，供你参考。

> 图例：✅ 内置 · ◐ 部分支持 / 通过扩展 · — 不可用

### 功能矩阵

| 功能 | **k7s** | **Lens** | **KubePi** | **Headlamp** |
|---|:---:|:---:|:---:|:---:|
| **🤖 AI / MCP server** | | | | |
| MCP server (stdio + HTTP) | ✅ **79 个工具** | — | — | — |
| AI 集群诊断 (`diagnose_cluster`, `suggest_fix`) | ✅ | — | — | — |
| 集群健康评分 (0–100, 字母等级) | ✅ | — | — | — |
| **🧭 浏览与操作** | | | | |
| 多集群切换 | ✅ | ✅ | ✅ | ✅ |
| 虚拟滚动表格（大集群） | ✅ | ✅ | ◐ | ◐ |
| CRD 发现（Lens 风格分组） | ✅ | ✅ | ◐ | ✅ |
| 批量操作（删除/扩缩容/重启） | ✅ | ◐ | ◐ | ◐ |
| Node drain（PDB 感知，进度条） | ✅ | ✅ | ◐ | — |
| 命令面板 (⌘K) | ✅ | ✅ | — | — |
| Pod shell (kubectl exec, xterm.js) | ✅ | ✅ | ✅ | ✅ |
| Node shell（特权调试 Pod） | ✅ | ✅ | — | — |
| Port-forward 管理器（Pod + Service） | ✅ | ✅ | ◐ | ◐ |
| **📜 日志、YAML 与文件** | | | | |
| 流式日志（follow、since 窗口、搜索） | ✅ | ✅ | ✅ | ✅ |
| YAML 编辑器 + 服务端 dry-run diff | ✅ | ◐ | ◐ | ◐ |
| Pod 文件浏览器（读/写/上传/下载） | ✅ | ◐ | ✅ | — |
| 资源 diff（并排对比） | ✅ | — | — | — |
| Ingress 可视化编辑器 | ✅ | — | — | — |
| **📦 Helm** | | | | |
| Helm release 视图 | ✅ | ✅ | ✅ | ✅ |
| Chart 市场（仓库 CRUD + 搜索） | ✅ | ◐ | ✅ | ◐ |
| 安装 / 升级 / 回滚（带实时日志） | ✅ | ✅ | ✅ | ◐ |
| **🖼 可观测性** | | | | |
| Prometheus PromQL 探索器 | ✅ | ✅ | ◐ | — |
| AlertManager 告警 / 静默 / 规则 | ✅ | ◐ | — | — |
| Grafana 仪表盘嵌入 + 搜索 | ✅ | ◐ | — | — |
| Loki / K8s 审计日志搜索 | ✅ | — | — | — |
| Node-exporter 实时指标 | ✅ | ◐ | — | — |
| 服务拓扑图 (d3) | ✅ | ◐ | — | — |
| **🔐 安全与供应链** | | | | |
| RBAC 安全审计 | ✅ | — | ◐ | — |
| SBOM 生成 (CycloneDX / SPDX) | ✅ | — | — | — |
| 镜像漏洞扫描 | ✅ | — | ◐ | — |
| 私有 OCI 仓库浏览器 | ✅ | ◐ | ✅ | — |
| **离线**镜像传输 (skopeo / node import) | ✅ | — | — | — |
| **🧩 可扩展性** | | | | |
| 插件 API（侧边栏 / Tab / 卡片 / 操作） | ✅ | ✅ | — | ✅ |
| 内置插件示例（GPU 监控等） | ✅ | ◐ | — | ◐ |
| **🌐 用户体验与国际化** | | | | |
| 深色 / 浅色 / 跟随系统主题 | ✅ | ✅ | ◐ | ◐ |
| 多语言（英文 / 中文） | ✅ | ◐ | ✅ | ◐ |
| Mock/演示模式（无需集群） | ✅ | ◐ | — | — |
| **👥 团队 / 多租户** | | | | |
| SSO (OIDC / SAML / LDAP) | — (kubeconfig) | ◐ | ✅ | ✅ |
| 内置 RBAC + 审计日志 | — | — | ✅ | ◐ |

### 架构概览

| | **k7s** | **Lens** | **KubePi** | **Headlamp** |
|---|---|---|---|---|
| **形态** | ~9 MB 原生二进制 (Tauri 2) | Electron 应用 (~300 MB) | Web 应用 (Go + Vue) | Web 应用 (Go + React) |
| **部署** | 安装包 / Docker / 源码 | 桌面安装包 | `docker run` | `docker run` / 集群内插件 |
| **主要用户** | 单个 SRE / 平台工程师 | 单个开发者 / SRE | 团队共享一个仪表盘 | 团队 / 平台 |
| **本地数据** | 直接读取 `~/.kube/config` | 读取 `~/.kube/config` | 指向集群的 kubeconfig | OIDC 或 kubeconfig |
| **认证模型** | 你的 kubeconfig（RBAC、exec 插件） | kubeconfig / OIDC | OIDC / SAML / LDAP / MFA / RBAC | OIDC |
| **打包体积** | ~9 MB | ~300 MB | 数百 MB | ~50 MB |
| **遥测** | 无 | 崩溃报告 | 登录 + 操作日志写入数据库 | 无 |
| **平台** | macOS, Linux, **任意浏览器 (含 Windows 7)**, Docker | macOS, Linux, Windows | 任意浏览器 | 任意浏览器 |

### 如何选择

- **选择 k7s**：如果你想要一个**快速、原生、单二进制**的 K8s 监控器，具有**一流的 AI 控制**（79 个 MCP 工具、集群诊断）、**深度可观测性**（Prometheus + Grafana + AlertManager + Loki 集成）和**供应链工具**（SBOM、离线镜像传输）——且不需要团队共享的 Web 登录。
- **选择 Lens**：如果你想要**最成熟的桌面 K8s IDE**，拥有**最大的扩展市场**，且不介意 Electron 应用的体积。
- **选择 KubePi**：如果你需要**SSO + RBAC + 审计日志**用于**团队共享安装**，并内置 Helm 市场和镜像仓库管理。
- **选择 Headlamp**：如果你想要一个**简洁、插件友好的 Web 仪表盘**，具有强大的 **OIDC** 支持，也可以作为集群内插件运行。

### k7s 与 KubePi 的重叠之处

两者互相靠拢，现在共享四个面向运维的面板 —— **Helm 市场**（仓库 CRUD + chart 搜索 + 安装/升级/回滚带实时日志）、**Pod 文件**（通过 exec 的 `tar` 浏览/读/写/上传/下载）、**镜像仓库**（OCI Distribution v2, Harbor/GHCR/ECR/Docker Hub）和 **YAML 模板**（表单 → 预览 → 应用）。

**k7s 领先的地方**：**MCP server**（独有）、**离线镜像传输**、**SBOM 生成**、**Prometheus/Grafana/AlertManager/Loki 可观测性**、**服务拓扑图**、**资源 diff**、**Ingress 编辑器**、**Node shell** 和**插件系统** —— KubePi 均未提供。

**KubePi 领先的地方**：**多租户 SSO**（OIDC/SAML/LDAP/MFA）、**内置 RBAC 精细到 namespace**、以及**操作审计日志** —— k7s 在设计上是单用户工具。

---

## ⚡ 快速安装

**macOS (Apple Silicon) / Linux — 一行命令：**

```bash
curl -fsSL https://raw.githubusercontent.com/zy84338719/k7s/main/install.sh | bash
```

脚本自动检测操作系统和架构，下载最新版本并安装：
- **macOS**（Apple Silicon）：挂载 `.dmg` 并将 `k7s.app` 复制到 `/Applications`
- **Linux (deb)**：通过 dpkg 安装 `.deb` 包（Debian/Ubuntu）
- **Linux (rpm)**：通过 dnf/yum 安装 `.rpm` 包（Fedora/RHEL/CentOS）
- **Linux (回退)**：安装 AppImage 到 `~/.local/bin/`
- 支持 **amd64** 和 **arm64** 架构

**Windows / macOS Intel：** 从 [GitHub Releases](https://github.com/zy84338719/k7s/releases) 下载对应安装包。

---

## ✨ 功能

### 核心 Shell
- **多集群** —— kubeconfig 上下文切换，支持即时导入
- **CRD 发现** —— 自定义（CRD 支撑的）kind 自动按 API group 折叠，风格对齐 Lens
- **虚拟滚动表格** —— 行数超过 200 时自动开启；过滤、排序、指标叠加、色调着色在完整数据集上依然可用
- **命令面板**（⌘K）—— 模糊搜索 kind、对象或应用命令
- **设置** —— 日志缓冲上限、轮询间隔、默认 namespace、shell 命令、node-shell 镜像、主题、语言 —— 全部持久化，大多数立即生效
- **主题** —— dark / light / 跟随系统；选择「system」时标题栏、滚动条与控件也跟随系统
- **i18n** —— 英文与简体中文，可在顶栏或 Settings 里切换；与其它偏好一起持久化；`<html lang>` 实时同步

### 资源浏览
- **Live 资源表** —— 覆盖所有常见内置资源：Pods、Deployments、ReplicaSets、StatefulSets、DaemonSets、Jobs、CronJobs、Services、Ingresses、IngressClasses、ConfigMaps、Secrets、ServiceAccounts、PersistentVolumes、PersistentVolumeClaims、StorageClasses、Nodes、Namespaces、Events、Helm Releases

### 详情面板
- **多 Tab 视图** —— Logs、Shell、Node Shell、Properties、Metrics、YAML、Events
- **操作** —— 上下文菜单支持多选，删除前会列出受影响对象名；支持删除、扩缩容、port-forward、restart、cordon / uncordon / drain、view-pods 跳转

### 可观测性（集群组）
- **指标查询** —— Prometheus PromQL 探索器
- **告警** —— AlertManager 告警 / 静默 / 规则
- **Grafana** —— 仪表盘嵌入 + 搜索

### 安全（访问控制组）
- **审计日志** —— K8s 审计日志搜索
- **SBOM** —— 软件物料清单生成 (CycloneDX / SPDX)

### 镜像（镜像组）
- **镜像仓库** —— 私有 OCI 仓库浏览器
- **镜像传输** —— 离线镜像传输 (skopeo / node import)

### 网络（网络组）
- **Endpoints** —— 端点浏览器
- **服务拓扑** —— d3 服务拓扑图
- **Ingress 路由** —— Ingress 可视化编辑器

### 工具（配置组）
- **模板** —— YAML 模板（表单 → 预览 → 应用）

### Helm（Helm 组）
- **Helm 市场** —— 仓库 CRUD、chart 搜索、安装 / 升级 / 回滚

### 集群（集群组）
- **Diff** —— 资源并排对比
- **插件** —— 插件管理器

### 跨领域
- **Node drain** —— 进度条带在导航时不被销毁；遇到 PDB 阻塞时会显式提示
- **Port forward** —— 支持 Service 或 Pod，活动转发显示在底部条带上，点击即可复制 `localhost:<port>`，错误会高亮
- **MCP server**（`k7s-mcp`）—— 通过 stdio [Model Context Protocol](https://modelcontextprotocol.io/) 把同一套 K8s 能力暴露给 AI 客户端（Claude Desktop、Cursor、Claude Code 等），79 个工具，覆盖读、写、port-forward 与 shell 会话

---

## 🤖 MCP server — 79 个工具

k7s 提供两种 MCP 传输方式，让你可以通过 AI 客户端（如 Claude Desktop、Cursor、Claude Code）控制真实 K8s 集群。

### 选择传输方式

| | 本地 stdio | 远程 / HTTP |
|---|---|---|
| **二进制** | `k7s-mcp` | `k7s-web` 的 `/mcp` |
| **协议** | MCP stdio | Streamable HTTP |
| **适用场景** | 本机 AI 客户端 | 远程 AI 客户端 / 多客户端共享 |

### 1. 本地 stdio —— `k7s-mcp`

```json
{
  "mcpServers": {
    "k7s": {
      "command": "k7s-mcp"
    }
  }
}
```

### 2. 远程 / HTTP —— `k7s-web` 的 `/mcp`

```bash
k7s-web --addr 0.0.0.0:8080
```

然后在 AI 客户端配置中：

```json
{
  "mcpServers": {
    "k7s": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

### 工具一览（约 79 个）

覆盖：资源浏览、详情查看、YAML 编辑、日志流、Shell 会话、Node Shell、Helm 操作、镜像仓库、SBOM、安全审计、Prometheus 查询、Grafana 仪表盘、AlertManager、Loki 日志等。

### 快速冒烟测试

```bash
# 本机 stdio
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | k7s-mcp

# 远程 HTTP
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

### 安全注意事项

⚠️ **k7s-web 没有内置认证**。绑定到 `0.0.0.0` 时，任何能访问该端口的客户端都有完整的集群控制权。建议：
- 仅绑定 `127.0.0.1`（默认）
- 如需远程访问，使用反向代理 + 认证
- Docker compose 默认绑定 `127.0.0.1`

---

## 🖼 三种运行方式

### 1. 桌面应用 (`k7s`)

```bash
pnpm tauri:dev    # 开发模式
pnpm tauri:build  # 构建安装包
```

### 2. 网页服务器 (`k7s-web`)

```bash
# 构建前端
pnpm build

# 启动服务器
k7s-web --addr 127.0.0.1:8080 --static dist
```

### 3. MCP server (`k7s-mcp`)

```bash
# 直接运行
k7s-mcp

# 或通过 Docker
docker run -d --name k7s-mcp \
  -v ~/.kube/config:/home/k7s/.kube/config:ro \
  ghcr.io/zy84338719/k7s:latest \
  k7s-mcp
```

---

## 📸 截图

### 资源表

深色、虚拟滚动的资源表，覆盖 Pods、Deployments、Services、CRD 等所有常见资源；行级状态色、每列指标与顶栏的实时 filter 全部就位。

![Pods table](docs/screenshots/01-pods-table.png)

### 详情面板 —— Logs · Properties · YAML · Shell

同一行，四种视角。Logs 实时流式输出并支持 `since` 窗口；Properties 平铺整个 Pod spec；YAML 用 CodeMirror 直接就地编辑；Shell 走 xterm.js 起一个真实的 `kubectl exec` 会话。

| Logs | Properties |
| --- | --- |
| ![Logs](docs/screenshots/02-logs.png) | ![Properties](docs/screenshots/03-properties.png) |

| YAML | Shell |
| --- | --- |
| ![YAML](docs/screenshots/04-yaml.png) | ![Shell](docs/screenshots/05-shell.png) |

### 指标

基于 Plotly 的 Node / Pod 指标图：CPU、内存、网络、Load，以及文件系统用量；数据通过 port-forward 的 metrics 端点实时刷新。

![Metrics](docs/screenshots/06-metrics.png)

---

## 🧱 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | [Tauri 2](https://tauri.app)（Rust + WebView） |
| K8s 客户端 | [kube-rs](https://github.com/kube-rs/kube) |
| 渲染层 | React 19 + TypeScript + Vite |
| 状态管理 | [Zustand](https://github.com/pmndrs/zustand) |
| 样式 | 纯 CSS + design tokens（`tokens.css`） |
| 终端 | [xterm.js](https://xtermjs.org/) + portable-pty |
| 图表 | [Plotly](https://plotly.com/javascript/)（basic-dist-min） |
| YAML 编辑器 | [CodeMirror 6](https://codemirror.net/) |
| K8s 类型 | k8s-openapi |
| 测试 | Vitest + jsdom（前端）；Cargo（Rust） |

---

## 📁 项目结构

```
k7s/
├── src/                       # React 渲染层
│   ├── components/
│   │   ├── sidebar/           # 集群切换、导航、watch 底栏
│   │   ├── topbar/            # 面包屑、⌘K 搜索、namespace、语言
│   │   ├── statusbar/         # 连接状态、API 延迟、节点数、CPU/MEM
│   │   ├── table/             # 虚拟滚动资源表 + 上下文菜单
│   │   ├── detail/            # 多 Tab 详情面板（Logs、Shell、Properties…）
│   │   ├── forwards/          # 活动 port-forward 条带
│   │   ├── palette/           # ⌘K 命令面板
│   │   ├── settings/          # 设置弹窗（含 MCP 面板）
│   │   └── actions/           # 共享的操作菜单（详情面板的「…」 + 表格右键）
│   ├── lib/
│   │   ├── kinds.tsx          # 资源 kind 注册表 + 导航元数据
│   │   ├── i18n/              # 英文/中文词典
│   │   └── ...                # 工具函数
│   ├── store.ts               # Zustand 全局状态
│   └── providers/             # 数据层抽象
├── src-tauri/                 # Rust 后端
│   ├── src/
│   │   ├── commands/          # Tauri IPC 命令
│   │   ├── kube/              # K8s 操作（watch、exec、logs、port-forward…）
│   │   ├── mcp/               # MCP server 实现
│   │   └── web/               # HTTP 服务器（k7s-web）
│   └── Cargo.toml
└── package.json
```

---

## 🎨 设计语言

k7s 的设计对齐 Linear / Vercel 的美学：
- 深色主题为主，浅色主题为辅
- 极简的边框和阴影
- 高对比度的文字和图标
- 流畅的动画和过渡效果
- 清晰的视觉层次

---

## 🚀 开发

### macOS / Linux（推荐平台）

```bash
# 安装依赖
pnpm install

# 启动开发服务器（前端 + 后端）
pnpm tauri:dev

# 仅前端（无后端，使用 mock 数据）
pnpm dev
```

### 常用脚本

```bash
pnpm dev          # 启动 Vite 开发服务器
pnpm tauri:dev    # 启动 Tauri 桌面应用
pnpm build        # 构建前端
pnpm tauri:build  # 构建桌面安装包
pnpm test         # 运行测试
pnpm lint         # 运行 ESLint
pnpm typecheck    # TypeScript 类型检查
```

### Demo / mock 模式

无需真实集群，使用内置 mock 数据：

```bash
pnpm dev
# 打开 http://localhost:1420
```

### Windows（仅供开发）

Windows 支持通过 `k7s-web` 提供，详见 [Windows 7 / 网页服务器模式](#-windows-7--网页服务器模式)。

---

## 📦 构建发布包

```bash
# 构建桌面安装包（macOS / Linux）
pnpm tauri:build

# 构建 Docker 镜像
docker build -t k7s:latest .
```

---

## 🐳 Docker / 服务器部署

### Docker Compose（推荐）

```bash
docker compose up -d
```

默认配置：
- 绑定 `127.0.0.1:8080`（仅本地访问）
- 挂载 `~/.kube/config`（只读）
- 持久化数据到 `k7s-data` 卷

### 自定义配置

```bash
# 允许外部访问（⚠️ 确保有认证）
K7S_PORT_BIND=0.0.0.0 docker compose up -d

# 自定义端口
K7S_PORT=9090 docker compose up -d
```

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `K7S_PORT` | `8080` | 容器内端口 |
| `K7S_PORT_BIND` | `127.0.0.1` | 主机绑定地址 |
| `KUBECONFIG` | `~/.kube/config` | kubeconfig 路径 |
| `RUST_LOG` | `info` | 日志级别 |

---

## 🪟 Windows 7 / 网页服务器模式

Windows 7 及以上版本可以通过 `k7s-web` 使用 k7s：

```bash
# 构建前端
pnpm build

# 启动服务器（绑定到 localhost）
k7s-web --addr 127.0.0.1:8080 --static dist

# 或允许外部访问（⚠️ 确保有认证）
k7s-web --addr 0.0.0.0:8080 --static dist
```

然后在浏览器中打开 `http://localhost:8080`。

---

## 🧪 测试

```bash
# 运行所有测试
pnpm test

# 运行测试并监听变化
pnpm test:watch

# 运行 Rust 测试
cd src-tauri && cargo test
```

### 测试覆盖率

- **前端**：1253 个测试，覆盖所有组件和工具函数
- **Rust**：246 个测试，覆盖 K8s 操作、MCP server、数据解析

---

## 🧩 扩展 k7s

k7s 支持通过插件扩展功能：

```typescript
// 示例：GPU 监控插件
import { definePlugin } from './types';

export const gpuMonitorPlugin = definePlugin({
  id: 'gpu-monitor',
  name: 'GPU Monitor',
  description: 'NVIDIA GPU metrics for nodes',
  tabs: [{
    id: 'gpu-metrics',
    label: 'GPU Metrics',
    component: GpuMetricsTab,
  }],
});
```

详见 [插件 API 文档](docs/plugins.md)。

---

## 🗺 路线图

- [x] MCP server（79 个工具）
- [x] SBOM 生成
- [x] 离线镜像传输
- [x] 安全审计
- [ ] Web 认证（token/bearer）
- [ ] 更多插件示例
- [ ] 性能优化（大集群）

---

## 📄 许可证

MIT License

---

## 👤 作者

**Murphy Yi** — [GitHub](https://github.com/zy84338719)

---

> 💡 **提示**：k7s 仍在积极开发中。如有问题或建议，欢迎提交 [Issue](https://github.com/zy84338719/k7s/issues) 或 [PR](https://github.com/zy84338719/k7s/pulls)。

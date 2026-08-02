# k7s

> 桌面级 Kubernetes 监控器，设计对齐 Linear / Vercel。同时附带 stdio 与 HTTP MCP server，让任意 AI 客户端都能驱动真实集群。

![k7s — pods table (dark)](docs/screenshots/01-pods-table.png)

> `k7s` —— 因为 1337 语里 `t` 就是 `7`。

**语言 / Languages**: [English](README.md) · [简体中文](README.zh-CN.md)

一个深色、类 Lens 风格的 Kubernetes 可视化监控器，面向桌面端，使用 **Tauri 2 + Rust + React** 构建，并附带 stdio **MCP server**（`k7s-mcp`），让 AI 客户端能以同样的方式驱动真实集群。

主推平台为 **macOS** 和 **Linux**（Windows 仅供开发）。灵感来自 [k9s](https://k9scli.io/) 与参考项目 [lyuke/k7s](https://github.com/lyuke/k7s)。

---

## 🤔 为什么选 k7s（与 KubePi / Lens / Headlamp 的差异）

[k7s](https://github.com/) 与 [KubePi](https://github.com/1Panel-dev/KubePi) 都是 K8s 仪表盘，且在互相靠拢 —— 双方都内置了 Helm 市场、镜像仓库面板、Pod 文件浏览器、基于 YAML 模板的资源创建器。但它们**不是**同一个产品，差别在于「谁握着鼠标」：

| 维度 | **k7s** | **KubePi** |
|---|---|---|
| 形态 | 单个约 9 MB 的原生桌面应用（Tauri 2） | Web 应用（Go + Iris + Vue 2），跑在 Docker 镜像里 |
| 部署 | `pnpm tauri:build` → `.dmg` / `.appimage`；或 `k7s-web` 单二进制 | `docker run 1panel/kubepi` 部署到服务器 |
| 主要用户 | 单个 SRE / 平台工程师，装在自己笔记本上 | 团队 / 公司通过 SSO + RBAC 共享一个仪表盘 |
| 本地数据 | 直接读取本机 `~/.kube/config`，无需服务端 | 读取你给集群指向的 kubeconfig |
| AI 集成 | **内置** stdio + HTTP MCP server；约 30 个工具，可被 Claude / Cursor / Claude Code 直接调用 | 无 |
| 认证 | 取决于你本机 kubeconfig（KUBECONFIG、exec 插件） | OIDC、SAML2、LDAP、MFA、可下沉到 namespace 的 RBAC |
| Demo 模式 | `pnpm dev` —— 自带 mock 数据的完整 UI，无需集群 | 需要真实集群 |
| 体积 | 约 9 MB 的二进制 | 数百 MB 的容器 |
| 审计 / 日志 | 无 | 登录与操作日志写入内嵌数据库 |

**选 k7s** 的场景：你想要一个快速、原生、单二进制的 K8s 监控器，并希望把 AI 控制当作一等公民来用，而不需要为整个团队维护一个多租户 Web 仪表盘。

**选 KubePi** 的场景：你在 Web 登录背后为团队共享一套安装，需要 SSO + RBAC + 审计。

### 与 KubePi 的功能对齐

k7s 故意保持「少量高质量原语 + 高速 UI」的克制路线，下面这四个面板让它在「面向运维的功能面」上接近 KubePi，但依然守住单二进制、单用户的承诺：

- **Helm 市场** —— 仓库 CRUD、跨缓存 `index.yaml` 的 chart 搜索、安装 / 升级 / 卸载 / 回滚（带实时日志流）、Release 历史。
- **Pod 文件** —— 通过 `tar over kubectl exec` 在运行中的容器里浏览、读、写、下载、上传文件。
- **镜像仓库** —— 私有 OCI 仓库管理（Harbor、GHCR、ECR、Docker Hub），通过 OCI Distribution v2 规范浏览 repo / tag，带 bearer 鉴权挑战。
- **YAML 模板** —— 选模板（Deployment + Service、Ingress、ConfigMap），填表，预览渲染后的 YAML，作为多文档包应用。

以上四项都能在侧边栏的 **Tools** 分组里打开。

---

## ✨ 功能

- **多集群** —— kubeconfig 上下文切换，支持即时导入
- **Live 资源表** —— 覆盖所有常见内置资源：Pods、Deployments、ReplicaSets、StatefulSets、DaemonSets、Jobs、CronJobs、Services、Ingresses、IngressClasses、ConfigMaps、Secrets、ServiceAccounts、PersistentVolumes、PersistentVolumeClaims、StorageClasses、Nodes、Namespaces、Events、Helm Releases
- **CRD 发现** —— 自定义（CRD 支撑的）kind 自动按 API group 折叠，风格对齐 Lens
- **虚拟滚动表格** —— 行数超过 200 时自动开启；过滤、排序、指标叠加、色调着色在完整数据集上依然可用
- **详情面板** —— 每个对象多 Tab 视图：Logs、Shell、Node Shell、Properties、Metrics、YAML、Events
- **操作** —— 上下文菜单支持多选，删除前会列出受影响对象名；支持删除、扩缩容、port-forward、restart、cordon / uncordon / drain、view-pods 跳转
- **Port forward** —— 支持 Service 或 Pod，活动转发显示在底部条带上，点击即可复制 `localhost:<port>`，错误会高亮
- **Node drain** —— 进度条带在导航时不被销毁；遇到 PDB 阻塞时会显式提示
- **命令面板**（⌘K）—— 模糊搜索 kind、对象或应用命令
- **设置** —— 日志缓冲上限、轮询间隔、默认 namespace、shell 命令、node-shell 镜像、主题、语言 —— 全部持久化，大多数立即生效
- **主题** —— dark / light / 跟随系统；选择「system」时标题栏、滚动条与控件也跟随系统
- **i18n** —— 英文与简体中文，可在顶栏或 Settings 里切换；与其它偏好一起持久化；`<html lang>` 实时同步
- **按集群隔离的偏好** —— 上次的导航项、namespace、主题、语言、导入过的 kubeconfig、是否显示时间戳 —— 全部在下次启动时恢复
- **MCP server**（`k7s-mcp`）—— 通过 stdio [Model Context Protocol](https://modelcontextprotocol.io/) 把同一套 K8s 能力暴露给 AI 客户端（Claude Desktop、Cursor、Claude Code 等），约 30 个工具，覆盖读、写、port-forward 与 shell 会话

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

## 📁 目录结构

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
│   │   ├── theme.ts           # 调色板解析 + token 桥接
│   │   ├── settings.ts        # 用户设置 + 校验
│   │   ├── i18n/              # 字典 + translate()（en / zh）
│   │   ├── actions.ts         # 操作模型 + 批量执行
│   │   ├── kinds.ts           # kind 注册表 + 各 kind 的 Tab
│   │   ├── palette.ts         # ⌘K 排序
│   │   ├── logview.ts         # 日志环形缓冲 + since 窗口
│   │   ├── selection.ts       # 多选管理
│   │   ├── filter.ts          # 解析器 + 名字选择器
│   │   ├── fuzzy.ts           # 子序列匹配
│   │   ├── sort.ts            # 列排序
│   │   ├── virtual.ts         # 行的窗口化
│   │   ├── drain.ts           # 节点 drain 进度
│   │   ├── diff.ts            # YAML diff hunks
│   │   ├── format.ts          # 时间 / 字节 / 数字格式化
│   │   └── tone.ts            # 状态 → 颜色
│   ├── hooks/                 # useBootstrap、useTheme、useI18n、useTerminal…
│   ├── providers/             # 数据层（Tauri / Mock / Http）
│   ├── store.ts               # Zustand store
│   ├── styles/                # tokens.css + global.css
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/                 # Rust 后端
│   ├── src/
│   │   ├── main.rs            # 入口
│   │   ├── lib.rs             # Tauri builder + command 注册
│   │   ├── commands.rs        # #[tauri::command] 处理函数
│   │   ├── error.rs           # 对 Tauri 友好的错误类型
│   │   ├── core/              # 与集群无关的业务逻辑
│   │   ├── kube/              # kube 客户端、watcher、日志、exec、drain、port-forward 等
│   │   ├── web/               # axum 服务（k7s-web 二进制；--features web）
│   │   ├── mcp/               # MCP server（k7s-mcp 二进制；--features mcp）
│   │   └── bin/               # k7s-web、k7s-mcp 入口
│   ├── capabilities/          # Tauri 2 capability 白名单
│   ├── icons/
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── design/                    # 设计交付：K8s Monitor.dc.html + 设计 README（v2）
├── dev/                       # 截图、内部脚本
├── docs/                      # 截图与文档
├── public/                    # 静态资源
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 🎨 设计语言

整体走 **Linear / Vercel** 路线：

- **近黑底色**带冷蓝调（基底 `#0B0D10`，每层提升 `0.06` 亮度）。
- **发丝级边框**（1px，8–14% 透明），没有粗重分隔线。
- **克制的强调色** —— 品牌色青绿 `#4EC9B0` 只用于 focus / 选中 / active 状态。
- **状态驱动色调** —— Running 绿、Pending 琥珀、Failed 红、终态中性灰。颜色按调色板单独调过，浅色模式同样清晰。
- **两套调色板** —— 深色为主、浅色为辅，都通过 `src/styles/tokens.css` 的 token 化方式管理，可在 Settings 或顶栏切换。
- **i18n 内建** —— 所有可见字符串都走 `translate()`，英文 + 简体中文双字典，缺失 key 回退英文。

详细规范、独立交互稿 `design/K8s Monitor.dc.html` 与原始设计交付说明见 [`design/README.md`](design/README.md)。

---

## 🚀 开发

### macOS / Linux（推荐平台）

前置依赖：

- **Node.js ≥ 18**（已在 24 上验证）
- **Rust stable**（1.77+）
- **macOS**：`xcode-select --install`
- **Linux**：`webkit2gtk-4.1`、`libsoup-3.0`、`libayatana-appindicator3`、`librsvg2`、`openssl-dev`
  - Debian / Ubuntu：`sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev`
  - Fedora：`sudo dnf install webkit2gtk4.1-devel libsoup3-devel libappindicator-gtk3-devel librsvg2-devel openssl-devel`

```bash
pnpm install     # 或 npm install
pnpm tauri:dev   # 或 npm run tauri:dev
```

这会启动 Vite（`http://localhost:1420`），并拉起 Tauri 外壳。

### 常用脚本

```bash
pnpm dev               # 仅 Vite（配合 mock provider 在浏览器里独立开发）
pnpm tauri:dev         # Tauri + Vite
pnpm tauri:build       # 完整 release 包
pnpm typecheck         # tsc --noEmit
pnpm test              # vitest run
pnpm test:watch        # vitest
pnpm dev:shots         # 重新生成设计对比截图
```

### Demo / mock 模式

在 `.env.development.local` 设置 `VITE_DEMO=1`，即可让 `MockProvider` 提供预置数据，从而在没有 Tauri、没有集群的情况下通过 `pnpm dev` 体验完整 UI。Provider 在构建期根据运行环境（Tauri webview / 浏览器）自动选择，详见 `src/providers/index.ts`。

### Windows（仅供开发）

切到 GNU 工具链后，`cargo check` 在 Windows 上已验证可用：

```powershell
rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal
rustup default stable-x86_64-pc-windows-gnu
winget install --id BrechtSanders.WinLibs.POSIX.UCRT -e --source winget
```

---

## 📦 打 release 包

```bash
# 桌面端
pnpm tauri:build

# 浏览器单二进制
pnpm build                            # 产出 dist/
cargo build --release --manifest-path src-tauri/Cargo.toml \
  --features web --bin k7s-web

# MCP stdio 二进制
cargo build --release --manifest-path src-tauri/Cargo.toml \
  --features mcp --bin k7s-mcp
```

`pnpm tauri:build` 在 `src-tauri/target/release/bundle/` 下产出各平台安装包。

---

## 🛠 新增资源视图

在 `src/lib/kinds.ts` 中给 `KindDef` 加上你的 kind（label、列定义、可用的 Tab、操作），然后 sidebar、表格、详情面板、命令面板会一并接入。无需改任何其它文件。

---

## 🌍 新增语言

在 `src/lib/i18n/` 下新增一个字典文件（参考 `en.ts`），在 `i18n/index.ts` 注册即可。所有可见字符串都走 `translate()`，缺 key 会回退到英文。

---

## 🧪 测试

```bash
pnpm test              # 前端单元测试
pnpm typecheck         # TypeScript 严格模式
cd src-tauri && cargo test   # Rust 单元测试
```

更多测试计划见 [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md)，最近的回归报告见 [`dev/TEST_REPORT.md`](dev/TEST_REPORT.md)。

---

## 🌍 服务端部署（单二进制）

`k7s-web` 是同一个仓库的另一种形态 —— 一个 axum HTTP 服务，前端用预构建的 `dist/`，把同一套命令面通过 `/api/*` 与 SSE 暴露出来，浏览器打开就能用。

```bash
# 1. 构建前端（输出到仓库根的 dist/）
pnpm build

# 2. 编译 k7s-web release
cargo build --release --manifest-path src-tauri/Cargo.toml \
  --features web --bin k7s-web
# → 产出 src-tauri/target/release/k7s-web（约 8.3 MB）

# 3. 把两个产物拷到目标机器
#   ./k7s-web
#   ../dist/

# 4. 启动
./k7s-web --addr 0.0.0.0:8080
```

打开 `http://127.0.0.1:8080/` 即可。`/api/*` 走 SSE 流式传输实时事件。

### 启动参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--addr` | `0.0.0.0:8080` | 监听地址 |
| `--kubeconfig` | `KUBECONFIG` 环境变量 → `~/.kube/config` | kubeconfig 路径 |
| `--context` | kubeconfig 中当前 context | 指定 context |
| `--static-dir` | 与二进制同级的 `dist/` | 前端静态文件目录 |
| `--no-mcp` | 开启 | 关闭内嵌的 `/mcp` 路由 |

### 一个二进制，两种模式

桌面端（`k7s`）通过 Tauri 直接调用 Rust；浏览器模式（`k7s-web`）在 axum 之上把同一份命令面通过 JSON-over-HTTP 重放。两条路径共享同一份 `commands.rs` 业务逻辑。

### 上线前检查

- `dist/` 与 `k7s-web` 放在同一目录
- 防火墙放行 `--addr` 指定的端口
- 容器场景推荐把端口绑到 127.0.0.1，前面再放一层反向代理
- kubeconfig 走 secret 挂载，不要打进镜像

---

## 🤖 MCP 服务

k7s 附带一个 MCP server，名为 **`k7s-mcp`**，暴露约 30 个工具，覆盖读、写、port-forward、shell 会话。AI 客户端（Claude Desktop、Cursor、Claude Code 等）可以借此直接操作真实集群。

### 选择传输方式

| 场景 | 推荐 | 启动方式 |
|---|---|---|
| AI 客户端跑在 k7s 同一台机器上 | stdio（最简单） | `k7s-mcp` |
| AI 客户端远程连 k7s | HTTP（Streamable HTTP） | `k7s-web`，路径 `/mcp` |

### 1. 本地 stdio —— `k7s-mcp`

```bash
cargo build --release --manifest-path src-tauri/Cargo.toml \
  --features mcp --bin k7s-mcp
# → src-tauri/target/release/k7s-mcp（约 7 MB）
```

在 Claude Desktop / Cursor 的 MCP 配置里加入：

```json
{
  "mcpServers": {
    "k7s": {
      "command": "/abs/path/to/k7s-mcp",
      "args": []
    }
  }
}
```

### 2. 远程 / HTTP —— `k7s-web` 的 `/mcp`

```bash
cargo build --release --manifest-path src-tauri/Cargo.toml \
  --features web --bin k7s-web
# → src-tauri/target/release/k7s-web（约 10 MB）
./k7s-web --addr 0.0.0.0:8080
# → 看到 "k7s-web (server) listening on http://0.0.0.0:8080 (MCP: /mcp)"
```

在远程 AI 客户端里把 endpoint 指向 `http://<host>:8080/mcp` 即可。

### 工具一览（约 30 个）

读：列出 / 读取 / watch Pod、Deployment、Service、Node、Namespace、Event、任意 CRD 资源。

写：apply、delete、scale、restart、cordon / uncordon、drain、exec。

网络：创建 / 列出 / 停止 port-forward，会话管理。

Shell：节点 / Pod 的 exec 会话，支持 stdin 透传。

### 快速冒烟

```bash
# stdio
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  | k7s-mcp
```

### 安全提示

- `k7s-mcp` 拥有你当前 kubeconfig 的全部权限 —— 它会按你的 K8s RBAC 行事，但工具可以触发删除、drain、exec 等高危动作。建议在专用 context / 服务账号下使用。
- HTTP 模式下 `/mcp` 默认无鉴权；务必放在受信网络或反向代理之后。
- exec 工具会执行任意 shell 命令，谨慎授权。

---

## 🗺 路线图

- **自定义 Dashboard** —— 基于 JSON Schema 的可拖拽卡片
- **多集群并行** —— 同一窗口跨多个 context 聚合视图
- **告警中心** —— 与 Alertmanager 集成
- **插件市场** —— 第三方 CRD 面板分享

---

## 📄 许可证

MIT

---

## 👤 作者

[Murphy-Yi](https://github.com/Murphy-Yi) — zy84338719@hotmail.com

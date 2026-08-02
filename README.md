# k7s

> **A Linear-grade Kubernetes monitor for the desktop, with a stdio + HTTP MCP server so any AI client can drive a real cluster.**
>
> **桌面级 Kubernetes 监控器,设计对齐 Linear / Vercel。同时附带 stdio 与 HTTP MCP server,让任意 AI 客户端都能驱动真实集群。**

![k7s — pods table (dark)](docs/screenshots/01-pods-table.png)

> `k7s` — because `t` is a `7` in 1337-speak.

A dark, Lens-style Kubernetes visual monitor for the desktop, built with
**Tauri 2 + Rust + React**, plus a stdio **MCP server** (`k7s-mcp`) so AI
clients can drive a real cluster the same way.

Targets **macOS** and **Linux** (and Windows for development). Inspired by
[k9s](https://k9scli.io/) and the [lyuke/k7s](https://github.com/lyuke/k7s)
reference project.

---

## 🤔 Why k7s (vs [KubePi](https://github.com/1Panel-dev/KubePi) / Lens / Headlamp)?

Both **k7s** and **[KubePi](https://github.com/1Panel-dev/KubePi)** are K8s dashboards that
have grown toward each other — both ship a Helm marketplace, an image-registry
panel, pod file browser, and a YAML-template-driven resource creator. They are
**not** the same product, and choosing between them is about *who's holding the
mouse*:

| | **k7s** | **KubePi** |
|---|---|---|
| **Shape** | Single ~9 MB native desktop app (Tauri 2) | Web app (Go + Iris + Vue 2) on a Docker image |
| **Deploy** | `pnpm tauri:build` → `.dmg` / `.appimage`; or `k7s-web` single binary | `docker run 1panel/kubepi` on a server |
| **Primary user** | A single SRE / platform engineer on their own laptop | A team / company sharing one dashboard via SSO + RBAC |
| **Local data** | Reads your `~/.kube/config` directly, no server | Reads whatever kubeconfig you point the cluster at |
| **AI integration** | **Built-in** stdio + HTTP MCP server; ~30 tools for Claude / Cursor / Claude Code | None |
| **Auth** | Whatever your local kubeconfig says (KUBECONFIG, exec plugins) | OIDC, SAML2, LDAP, MFA, RBAC down to the namespace |
| **Demo mode** | `pnpm dev` — full UI with seeded mock data, no cluster | Needs a real cluster |
| **Bundle size** | ~9 MB binary | ~hundreds of MB container |
| **Telemetry / audit** | None | Login + operation log to embedded DB |

**Pick k7s if** you want a fast, native, single-binary K8s monitor with first-class
AI control and you don't need a multi-tenant web dashboard for your whole team.

**Pick KubePi if** you need SSO + RBAC + audit for a shared team installation
behind a web login.

### Feature parity (the work in this repo)

k7s is intentionally a small set of high-quality primitives plus a fast UI;
the four feature panels below bring it close to KubePi on the operator-facing
surface, all without giving up the single-binary / single-user story:

- **Helm Marketplace** — repo CRUD, chart search across cached `index.yaml`,
  install/upgrade/uninstall/rollback with live log streaming, release history.
- **Pod Files** — browse / read / write / download / upload files inside a
  running container, via `tar` over `kubectl exec`.
- **Image Registries** — manage private OCI registries (Harbor, GHCR, ECR,
  Docker Hub), browse repositories and tags via the OCI Distribution v2
  spec with bearer-auth challenge dance.
- **YAML Templates** — pick a template (Deployment + Service, Ingress,
  ConfigMap), fill the form, preview the rendered YAML, apply as a
  multi-document bundle.

Open any of these from the **Tools** group in the sidebar.

---

## ✨ Features / 功能

- **Multi-cluster** — kubeconfig context switcher with on-the-fly import /
  **多集群** —— kubeconfig 上下文切换,支持即时导入
- **Live tables** for every common resource: Pods, Deployments, ReplicaSets,
  StatefulSets, DaemonSets, Jobs, CronJobs, Services, Ingresses,
  IngressClasses, ConfigMaps, Secrets, ServiceAccounts, PersistentVolumes,
  PersistentVolumeClaims, StorageClasses, Nodes, Namespaces, Events,
  Helm Releases
- **CRD discovery** — custom (CRD-backed) kinds are folded under their API
  group, Lens-style
- **Virtualised tables** for any list over 200 rows; filtering, sorting,
  metrics overlay and tone-coloring still work over the full dataset
- **Detail panel** with tabbed per-object views: Logs, Shell, Node shell,
  Properties, Metrics, YAML, Events
- **Actions** — bulk-aware context menus with confirmations that list the
  names being acted on. Delete, scale, port-forward, restart,
  cordon / uncordon / drain, view-pods jump
- **Port forwards** — service or pod, strip of active forwards, click to
  copy `localhost:<port>`, error highlighting
- **Node drains** — progress banner survives navigation, PDB-blocked pods
  reported
- **Command palette** (⌘K) — fuzzy-find a kind, an object, or an app command
- **Settings** — log buffer cap, poll intervals, default namespace, shell
  command, node-shell image, theme, language — all persisted, most take
  effect immediately
- **Theme** — dark / light / follow system; chrome (titlebar, scrollbars,
  controls) follows the OS when on "system"
- **i18n** — English and Simplified Chinese, switchable from the top bar
  or Settings; persisted with the rest of prefs; `<html lang>` updates live
- **Per-cluster prefs** — last nav, namespace, theme, language, imported
  kubeconfigs, show-timestamps: all come back on the next launch
- **MCP server** (`k7s-mcp`) — exposes the same Kubernetes plumbing to AI
  clients (Claude Desktop, Cursor, Claude Code, …) as a stdio
  [Model Context Protocol](https://modelcontextprotocol.io/) server with
  ~30 tools covering read, write, port-forward, and shell sessions

> **中文功能列表**:多集群 kubeconfig 切换、Live 资源表(覆盖所有内置 kind + CRD 自动发现),
> 200 行以上虚拟滚动表格;Detail 面板含 Logs / Shell / Node Shell / Properties / Metrics /
> YAML / Events 七个 Tab;Action 支持多选 + 二次确认;Port-forward 条带 + 错误高亮;
> Node drain 进度条带 PDB 阻塞提示;⌘K 命令面板模糊搜索;Settings 全部可持久化且大多立即生效;
> 主题支持 dark / light / 跟随系统;中英双语可热切换并持久化;按集群保存用户偏好;附带 ~30 个
> MCP 工具(读 / 写 / port-forward / shell)同时支持 stdio 与 HTTP 两种传输。

---

## 🧱 Tech stack / 技术栈

| Layer            | Choice                                          |
|------------------|-------------------------------------------------|
| Desktop shell    | [Tauri 2](https://tauri.app) (Rust + WebView)   |
| K8s client       | [kube-rs](https://github.com/kube-rs/kube)      |
| Renderer         | React 19 + TypeScript + Vite                    |
| State            | [Zustand](https://github.com/pmndrs/zustand)    |
| Styling          | Plain CSS with design tokens (`tokens.css`)     |
| Terminal         | [xterm.js](https://xtermjs.org/) + portable-pty |
| Plots            | [Plotly](https://plotly.com/javascript/) (basic-dist-min) |
| YAML editor      | [CodeMirror 6](https://codemirror.net/)         |
| K8s types        | k8s-openapi                                     |
| Tests            | Vitest + jsdom (unit), Cargo (Rust)             |

> **中文**:桌面壳用 Tauri 2,Rust + WebView;K8s 客户端用 kube-rs;渲染层 React 19 +
> TypeScript + Vite;状态管理 Zustand;样式用纯 CSS + design tokens;终端 xterm.js +
> portable-pty;图表用 Plotly 的 basic-dist-min;YAML 编辑器 CodeMirror 6;K8s 类型用
> k8s-openapi;前端测试 Vitest + jsdom,Rust 测试 Cargo。

---

## 📁 Layout / 目录结构

```
k7s/
├── src/                       # React renderer
│   ├── components/
│   │   ├── sidebar/           # cluster switcher, nav, watch footer
│   │   ├── topbar/            # breadcrumb, ⌘K search, namespace, language
│   │   ├── statusbar/         # connection, API latency, nodes, CPU/MEM
│   │   ├── table/             # virtualised resource table + context menu
│   │   ├── detail/            # tabbed panel (Logs, Shell, Properties, …)
│   │   ├── forwards/          # active port-forwards strip
│   │   ├── palette/           # ⌘K command palette
│   │   ├── settings/          # settings modal (incl. MCP panel)
│   │   └── actions/           # shared action menu (detail "…" + table right-click)
│   ├── lib/
│   │   ├── theme.ts           # palette resolution + token bridge
│   │   ├── settings.ts        # user settings + sanitisation
│   │   ├── i18n/              # dictionaries + translate() (en / zh)
│   │   ├── actions.ts         # action model + bulk runner
│   │   ├── kinds.ts           # kind registry + per-kind tabs
│   │   ├── palette.ts         # ⌘K ranking
│   │   ├── logview.ts         # log ring buffer + since window
│   │   ├── selection.ts       # multi-row selection
│   │   ├── filter.ts          # parser + name selectors
│   │   ├── fuzzy.ts           # subsequence match
│   │   ├── sort.ts            # column sort
│   │   ├── virtual.ts         # row windowing
│   │   ├── drain.ts           # node drain progress
│   │   ├── diff.ts            # YAML diff hunks
│   │   ├── format.ts          # age / bytes / human numbers
│   │   └── tone.ts            # status → colour
│   ├── hooks/                 # useBootstrap, useTheme, useI18n, useTerminal…
│   ├── providers/             # data layer (Tauri + Mock + Http)
│   ├── store.ts               # Zustand store
│   ├── styles/                # tokens.css + global.css
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/                 # Rust backend
│   ├── src/
│   │   ├── main.rs            # entry
│   │   ├── lib.rs             # Tauri builder + command registry
│   │   ├── commands.rs        # #[tauri::command] handlers
│   │   ├── error.rs           # Tauri-friendly error type
│   │   ├── core/              # cluster-agnostic business logic
│   │   ├── kube/              # kube client, watchers, logs, exec, drain, port-forward, …
│   │   ├── web/               # axum server (k7s-web binary; `--features web`)
│   │   ├── mcp/               # MCP server (k7s-mcp binary; `--features mcp`)
│   │   └── bin/               # k7s-web, k7s-mcp entry points
│   ├── capabilities/          # Tauri 2 capability allow-list
│   ├── icons/
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── design/                    # handoff: K8s Monitor.dc.html + design README (v2)
├── dev/                       # screenshots, internal scripts
├── docs/                      # screenshots + documents
├── public/                    # static assets
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 🎨 Design / 设计语言

k7s follows a **Linear / Vercel** direction:

- **Near-black surfaces** with cool blue undertones (`#0B0D10` base, `0.06` lift per elevation).
- **Hairline borders** (`1px` at `8–14%` alpha), no heavy dividers.
- **Subtle accent** — the brand teal `#4EC9B0` only on focus / selection / active state.
- **Tone-by-status** for row colors: green for `Running`, amber for `Pending`, red for
  `Failed`, neutral muted for terminal states. Status colors are tuned per palette so
  light mode stays legible.
- **Two palettes** — dark (headline) and light (secondary), both tokenised in
  `src/styles/tokens.css` and switchable from Settings or the top bar.
- **i18n baked in** — every visible string routes through `translate()`, with
  English + Simplified Chinese dictionaries; missing keys fall back to English.

> **中文设计说明**:整体走 Linear / Vercel 路线 —— 近黑底色 + 冷蓝调;细发丝边框(1px,
> 8–14% 透明);品牌色 `#4EC9B0` 只用在 focus / 选中 / active 状态;行级状态色按
> Running / Pending / Failed 区分,两套主题(深色为主、浅色为辅)都通过 design tokens
> 管理;所有可见文案走 i18n,中英双语;缺失 key 回退到英文。

See [`design/README.md`](design/README.md) for the full v2 spec, the standalone
`design/K8s Monitor.dc.html` interactive mockup, and the original hand-off notes.

---

## 🚀 Develop / 开发

### macOS / Linux (the intended targets / 推荐平台)

Prerequisites / 前置依赖:

- **Node.js ≥ 18** (tested on 24)
- **Rust stable** (1.77+)
- **macOS**: `xcode-select --install`
- **Linux**: `webkit2gtk-4.1`, `libsoup-3.0`, `libayatana-appindicator3`, `librsvg2`, `openssl-dev`
  - Debian/Ubuntu: `sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev`
  - Fedora: `sudo dnf install webkit2gtk4.1-devel libsoup3-devel libappindicator-gtk3-devel librsvg2-devel openssl-devel`

```bash
pnpm install     # or npm install
pnpm tauri:dev   # or: npm run tauri:dev
```

This starts Vite on `http://localhost:1420` and launches the Tauri shell.

### Scripts / 脚本

```bash
pnpm dev               # Vite only (use the mock provider for browser-only work)
pnpm tauri:dev         # Tauri + Vite
pnpm tauri:build       # full release bundle
pnpm typecheck         # tsc --noEmit
pnpm test              # vitest run
pnpm test:watch        # vitest
pnpm dev:shots         # regenerate design-comparison screenshots
```

### Demo / mock mode / Demo 模式

Set `VITE_DEMO=1` in `.env.development.local` to make `MockProvider` serve
seeded data so the UI is usable from `pnpm dev` alone (no Tauri, no cluster).
The provider is selected at build time based on whether the app is running
in a Tauri webview. See `src/providers/index.ts` for the routing.

> **中文**:在 `.env.development.local` 设置 `VITE_DEMO=1` 即启用 MockProvider,无需
> Tauri / 集群即可在 `pnpm dev` 模式下浏览完整 UI(使用预置示例数据)。Provider 在
> 编译期根据运行环境(Tauri webview / 浏览器)自动选择,详见 `src/providers/index.ts`。

### Windows (for development only / 仅供开发)

`cargo check` is verified to work on Windows after switching to the GNU toolchain:

```powershell
rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal
rustup default stable-x86_64-pc-windows-gnu
winget install --id BrechtSanders.WinLibs.POSIX.UCRT -e --source winget
```

> The full `cargo build` step on Windows hits a known MinGW export-ordinal limit
> in Tauri's DLL linking. Use macOS or Linux for actual bundle builds. Source code
> itself (`cargo check`) is clean on both platforms.
>
> **中文**:Windows 下可 `cargo check`,但完整 `cargo build` 会触发 MinGW 导出序号上限
> 的已知问题(Tauri DLL 链接)。要打 release 包请在 macOS / Linux 上进行。

---

## 📦 Build a release bundle / 打 release 包

```bash
pnpm tauri:build
```

Outputs / 产物:

- macOS: `src-tauri/target/release/bundle/dmg/*.dmg` and `bundle/macos/*.app`
- Linux: `src-tauri/target/release/bundle/{appimage,deb}/...`
- Windows: `src-tauri/target/release/bundle/{msi,nsis}/...`

---

## 🛠 Adding a new resource view / 新增资源视图

1. Backend: define a `*Row` DTO and a `#[tauri::command]` in
   `src-tauri/src/commands.rs` returning it.
2. Register the command in `src-tauri/src/lib.rs` under `invoke_handler!`.
3. Frontend: extend `src/providers/types.ts` (`Row` shape, `KindId`, kind
   metadata in `src/lib/kinds.ts`), wire a column layout and a `KINDS_WITH_*`
   flag if the kind gets Properties / Metrics / etc.
4. Add the kind's `KIND_META` entry; it appears in the sidebar automatically.

> **中文**:在 `src-tauri/src/commands.rs` 定义 `*Row` DTO 与 `#[tauri::command]`,
> 在 `src-tauri/src/lib.rs` 的 `invoke_handler!` 里注册。前端:扩展 `src/providers/types.ts`
> 的 `Row` / `KindId`,在 `src/lib/kinds.ts` 加 kind 元信息(列布局、必要时 `KINDS_WITH_*` 开关),
> 侧边栏会自动出现。

---

## 🌍 Adding a new locale / 新增语言

1. Add a `<locale>.ts` dictionary in `src/lib/i18n/` with the same shape as
   `dictionaries.ts` (`Dictionary` interface, exported as a const).
2. Register the locale in `src/lib/i18n/index.ts`: add to the `Locale` union,
   `LOCALES`, `LOCALE_LABELS`, the `dict()` switch, and the kind/group/tab
   label maps.
3. Add a localised label to the settings panel (`settings.language.<locale>`).
4. Add unit tests in `src/lib/i18n.test.ts`.

Missing keys fall back to English, so a half-translated locale is still
shippable.

> **中文**:在 `src/lib/i18n/` 新建 `<locale>.ts` 字典(与 `dictionaries.ts` 同构),
> 在 `src/lib/i18n/index.ts` 的 `Locale` 联合、`LOCALES`、`LOCALE_LABELS`、`dict()` 、
> kind / group / tab 标签映射里注册;在 settings 面板加 `settings.language.<locale>`
> 文案;在 `src/lib/i18n.test.ts` 加单测。缺失 key 回退英文,半翻译版本也能发布。

---

## 🧪 Testing / 测试

```bash
pnpm test
```

Vitest + jsdom. The catalogue:

- `src/lib/*.test.ts` — pure-function tests (settings, theme, actions, palette,
  i18n, selection, filter, fuzzy, sort, virtual, logview, diff, drain,
  format, kinds)
- `src/store.test.ts` — Zustand store transitions
- `src/hooks/useGlobalKeys.test.ts` — keyboard shortcut layer

Rust integration tests live under `src-tauri/`.

> **中文**:Vitest + jsdom 跑前端单元测试;Rust 集成测试在 `src-tauri/`。

---

## 🌍 Server deployment (single binary) / 单二进制服务部署

The same `core` that powers the desktop app and the browser dev shell also
ships as a standalone server. One Rust binary serves the built React app
*and* the Kubernetes API over a single port — no node, no vite, no
reverse proxy required.

> **中文**:与桌面 app 共享同一个 `core` 业务层,同一个 Rust 二进制既托管 React 静态资源
> 又暴露 K8s API —— 无需 node、vite、反向代理。

```bash
# 1. Build the front-end (writes dist/ next to the repo root)
npm install
npm run build

# 2. Build the k7s-web binary in release mode
cd src-tauri
cargo build --release --features web --bin k7s-web
# → produces src-tauri/target/release/k7s-web (~8.3 MB)

# 3. Ship both to the box
#   ./k7s-web
#   ../dist/

# 4. Run
KUBECONFIG=/etc/rancher/k3s/k3s.yaml \
  ./k7s-web --addr 0.0.0.0:8080 --static ../dist
```

Open `http://<server>:8080/` and the same UI as the desktop app shows up,
talking to whatever kubeconfig you pointed it at.

### Flags / 启动参数

```text
--addr <SOCKET>      Listen address (default: 127.0.0.1:7180).
                     Use 0.0.0.0:8080 to expose beyond localhost.
--static <DIR>       Also serve the built React app from <DIR>.
                     Enables single-binary 'server' mode; the binary
                     verifies <DIR>/index.html exists at start.
-h, --help           Print this and exit.
```

### Two modes, one binary / 一个二进制,两种模式

| Mode             | Command                                                   | What it serves              |
|------------------|-----------------------------------------------------------|-----------------------------|
| **server**       | `k7s-web --static ./dist`                                  | UI + API on one port        |
| **dev API**      | `k7s-web` (no `--static`)                                 | API only — pair with `vite` |

Both expose the same `/api/*` paths, so the front-end's `transport.ts`
writes the same code in either mode. The only thing that differs is
whether the browser fetches via the vite dev proxy (dev) or straight
from the same origin (server).

> **中文**:两种模式共用同一套 `/api/*` 路径,前端 `transport.ts` 写法一致 —— 唯一区别是
> dev 模式走 vite 代理,server 模式同源直连。

### Production checklist / 上线前检查

- Run behind a TLS-terminating reverse proxy (caddy / nginx / traefik) —
  k7s-web itself is plain HTTP.
- `KUBECONFIG` should be mounted read-only from a secret store; never
  bake credentials into the binary.
- The `WebState::data_dir` (`$XDG_CONFIG_HOME/k7s` on Linux,
  `~/Library/Application Support/k7s` on macOS) holds the per-user
  `prefs.json`. Persist this across restarts.

> **中文**:TLS 由反向代理(caddy / nginx / traefik)终止,`k7s-web` 自身只走 HTTP;
> `KUBECONFIG` 只读挂载,凭证不要烤进二进制;per-user `prefs.json` 位于
> `$XDG_CONFIG_HOME/k7s` (Linux) / `~/Library/Application Support/k7s` (macOS),
> 跨重启请持久化。

### Quick local smoke test / 本地冒烟测试

```bash
KUBECONFIG=$HOME/.kube/config \
  ./src-tauri/target/release/k7s-web \
    --addr 127.0.0.1:8080 --static ./dist
# open http://127.0.0.1:8080/ in a browser
```

If you see a populated cluster view, you're done. If you see a
"connection refused" error inside the UI, the binary can't reach your
API server — most often because the kubeconfig's `server:` field is
`https://127.0.0.1:6443` (k3s's default, which only listens on the
host) and the binary is not on the same host. Either run k7s-web on
the cluster node or set up an SSH port-forward / TCP tunnel first.

> **中文**:打开 `http://127.0.0.1:8080/` 若 UI 有数据即视为通过。若报
> "connection refused",多为 `kubeconfig` 里 `server: https://127.0.0.1:6443`(k3s 默认,
> 只监听 host)且二进制与 API server 不在同一机器 —— 把 `k7s-web` 部署到集群节点,或先
> 用 SSH 端口转发打通。

---

## 🤖 MCP server / MCP 服务

`k7s` ships an MCP server two ways:

1. **`k7s-mcp`** — a standalone stdio binary you can run from any shell.
2. **`k7s-web` with `/mcp`** — the same 30 tools, served over Streamable
   HTTP on the existing axum port, so a remote AI client can reach a
   cluster without ssh-ing in to run a binary.

Both expose the same 30 tools (read, write, port-forward, shell
sessions) over the same `core::` business logic the desktop and web
shells use. The wire format follows the
[Model Context Protocol](https://modelcontextprotocol.io/) so any
MCP-aware client (Claude Desktop, Cursor, Claude Code, Zed, Continue, …)
can drive a real cluster through natural-language tool calls.

> **中文**:`k7s` 提供两种 MCP 部署形态:① `k7s-mcp` 独立 stdio 二进制,直接被 AI 客户端
> 拉起;② `k7s-web` 内置 Streamable HTTP 端点 `/mcp`,远程 AI 客户端无需 ssh 进集群节点
> 即可驱动同一套 `core::` 业务逻辑。两者都按 MCP 协议暴露 30 个工具(读 / 写 /
> port-forward / shell),与 Claude Desktop、Cursor、Claude Code、Zed、Continue 等
> MCP 客户端开箱即用。

### Choose your transport / 选择传输

| Where does the AI client run? | Transport | What to start |
| --- | --- | --- |
| Same machine as the k8s cluster (and the AI client) | stdio | `k7s-mcp` binary as a child process of the AI host |
| Different machine / can't run a local binary | Streamable HTTP | `k7s-web` (any mode), reach it at `http://host:port/mcp` |

> **中文**:能跑 stdio 就跑 stdio(最简单、无鉴权);必须远程时用 HTTP —— `k7s-web` 已经
> 部署在服务器,AI 客户端只要能出网 HTTPS 即可。

### 1. Local stdio — `k7s-mcp`

Build the standalone binary:

```bash
cargo build --release --features mcp --bin k7s-mcp
# → src-tauri/target/release/k7s-mcp   (~7 MB)
```

`k7s-mcp` reads the same kubeconfig kubectl reads (`$KUBECONFIG`,
else `~/.kube/config` on macOS/Linux, `%USERPROFILE%\.kube\config` on
Windows). The AI host launches the binary as a child process and
exchanges JSON-RPC over its stdio — no daemon, no socket, no port.

> **中文**:`k7s-mcp` 与 kubectl 共用同一份 kubeconfig(优先级 `$KUBECONFIG` →
> `~/.kube/config` / `%USERPROFILE%\.kube\config`)。AI 客户端把它作为子进程拉起,
> stdio 上跑 JSON-RPC —— 无守护进程、无 socket、无端口。

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "k7s": {
      "command": "/absolute/path/to/k7s-mcp"
    }
  }
}
```

#### Claude Code

`~/.claude.json` (or the per-project `.mcp.json`):

```json
{
  "mcpServers": {
    "k7s": {
      "command": "/absolute/path/to/k7s-mcp"
    }
  }
}
```

Or from the CLI:

```bash
claude mcp add k7s /absolute/path/to/k7s-mcp
```

#### Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` in a project
(local, takes precedence):

```json
{
  "mcpServers": {
    "k7s": {
      "command": "/absolute/path/to/k7s-mcp"
    }
  }
}
```

### 2. Remote / HTTP — `k7s-web`'s `/mcp`

If `k7s-web` is already deployed (server mode, see
[🌍 Server deployment](#-server-deployment-single-binary--单二进制服务部署) above),
the same binary now also serves a Streamable HTTP MCP endpoint at
`/mcp`. Each client gets its own `Mcp-Session-Id` and its own
`ClientManager` — so connect/list/forwards live in your session, not
shared with anyone else hitting the same server.

```bash
cargo build --release --features web --bin k7s-web
# → src-tauri/target/release/k7s-web   (~10 MB)

KUBECONFIG=/etc/rancher/k3s/k3s.yaml \
  ./k7s-web --addr 0.0.0.0:8080 --static ../dist
# → "k7s-web (server) listening on http://0.0.0.0:8080 (MCP: /mcp)"
```

> **中文**:已部署 `k7s-web` 时,同一个二进制同时在 `/mcp` 暴露 Streamable HTTP 端点,
> 每个客户端一个 `Mcp-Session-Id` + 独立 `ClientManager` —— 你的连接/列表/转发完全独立,
> 不会与其他用户串。

The MCP endpoint shares the server's CORS, auth (none by default — put
it behind your reverse proxy), and TLS story. Same single binary, same
single port as the web UI — the AI client just hits `/mcp` instead of
`/`.

#### Claude Desktop (HTTP)

```json
{
  "mcpServers": {
    "k7s-remote": {
      "url": "http://your-k7s-host:8080/mcp"
    }
  }
}
```

#### Claude Code (HTTP)

```bash
claude mcp add k7s-remote --transport http http://your-k7s-host:8080/mcp
```

or in `~/.claude.json`:

```json
{
  "mcpServers": {
    "k7s-remote": {
      "url": "http://your-k7s-host:8080/mcp"
    }
  }
}
```

#### Cursor (HTTP)

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "k7s-remote": {
      "url": "http://your-k7s-host:8080/mcp"
    }
  }
}
```

### What you get — the 30 tools / 30 个工具一览

**Connection / 连接** — `list_contexts` → `connect` → `status` / `disconnect`. Empty
`context` in `connect` uses the current-context.

**Read (~ 7 tools) / 读(约 7 个)**

| Tool | What it does |
| --- | --- |
| `list_resources` | One-shot list of any built-in or CRD kind, with optional `namespace` and `labelSelector`. Returns `{ kind, namespace, name, summary }`. |
| `get_resource` | The resource's YAML (Secret data redacted, `managedFields` stripped). |
| `describe_resource` | The Properties panel as JSON — status, conditions, labels, container list, … |
| `get_events` | Events filtered to one object. |
| `get_logs` | One-shot pod log snapshot with `tail` / `sinceSeconds` / `previous` / `container`. |
| `list_builtin_kinds` / `list_custom_kinds` | Kind discovery. |

**Write (~ 8 tools) / 写(约 8 个)**

| Tool | What it does |
| --- | --- |
| `apply_yaml` / `dry_run_yaml` | Server-side replace; `dry_run` returns the live + proposed YAML for diffing. |
| `delete_resource` | Delete by kind/namespace/name. |
| `scale_resource` | Patch `spec.replicas`. |
| `set_cordon` | Cordon / uncordon a node. |
| `restart_pod` / `restart_rollout` | Delete a pod, or roll a workload's `restartedAt` annotation. |
| `drain_node` | Cordon + evict in the background. |

**Long-lived sessions (~ 11 tools) / 长连接会话(约 11 个)**

- `start_port_forward` / `start_service_port_forward` / `stop_port_forward` /
  `list_port_forwards`
- `start_shell` / `shell_input` / `shell_resize` / `stop_shell`
- `start_node_shell` / `stop_node_shell` — privileged debug pod on a
  node, auto-cleaned on stop

### Quick smoke test / 快速冒烟

> Use k7s to list the pods in the `kube-system` namespace that aren't `Running`.

A well-behaved agent will: `list_contexts` → `connect` → `list_resources`
with `kind=pods, namespace=kube-system` → summarise the rows that have a
non-`Running` summary. All in one tool-call turn.

> **中文**:给 AI 客户端一句自然语言指令("列出 `kube-system` 命名空间下所有非 Running
> 状态的 Pod"),预期流程:`list_contexts` → `connect` → `list_resources` 过滤 → 总结
> 非 `Running` 行,一轮 tool-call 即可完成。

### Safety notes / 安全提示

The MCP server runs with **your** kubeconfig and **your** RBAC. An AI
that can call `delete_resource` can delete things. A few defaults that
help:

- `apply_yaml` refuses `kind: secrets` (Secrets are redacted on read;
  applying them would clobber real values) and `kind: helm` (Helm
  releases are read-only here — use `helm upgrade` to change one).
- `restart_pod` refuses to delete a pod with no controller (it would
  never come back).
- `dry_run_yaml` is always the safe way to preview an apply before
  committing it.

> **中文**:`apply_yaml` 拒绝 `kind: secrets`(读侧已脱敏,写会冲掉真实值)与
> `kind: helm`(Helm release 在此只读,改 release 请走 `helm upgrade`);`restart_pod`
> 拒绝删无 controller 的 pod(删了不会回来);写之前永远用 `dry_run_yaml` 看 diff。
> 想要更小的爆炸半径,就把 `KUBECONFIG` 指向一个只读 RBAC 的 service account;
> HTTP 模式请把 `k7s-web` 放在有鉴权的反向代理后。

For HTTP mode, put `k7s-web` behind your reverse proxy with auth
(nginx, caddy, traefik — pick your favourite). The `/mcp` endpoint
speaks the same MCP transport Claude/Cursor/Zed already speak, so
nothing k7s-specific is needed beyond the URL.

---

## 🗺 Roadmap / 路线图

Shipped / 已完成:

- [x] Kubeconfig import + context switcher
- [x] Live watchers for every built-in kind
- [x] CRD introspection and dynamic kinds
- [x] Logs streaming with since / previous / save
- [x] Pod exec (xterm) + node debug shell
- [x] Port-forward (pod and service)
- [x] YAML view + in-place edit + server-side apply preview
- [x] Events feed (per-object + cluster-wide)
- [x] Per-pod and per-node metrics (live, with optional Prometheus backfill)
- [x] Node drain with PDB-aware progress
- [x] Multi-select + bulk actions with confirmation
- [x] Command palette (⌘K)
- [x] Theme switching (dark / light / system)
- [x] i18n (English / Simplified Chinese)
- [x] Per-cluster prefs (last nav, namespace, theme, language, imported
      kubeconfigs)
- [x] MCP server (stdio + HTTP) with ~30 tools
- [x] Single-binary `k7s-web` server deployment
- [x] v2 design refresh (Linear / Vercel direction)

Planned / 计划中:

- [ ] RBAC-aware UI hints (when a user lacks list / get on a kind)
- [ ] In-app log search by regex (current filter is substring)
- [ ] Edit-in-place for non-YAML fields (replicas, image, env)
- [ ] Plugin system
- [ ] Multi-cluster federated view

> **中文**:已完成 Kubeconfig 导入 + 上下文切换、内置 kind Live watch、CRD 自动发现、
> 日志流式(since/previous/保存)、Pod exec + Node debug shell、port-forward(pod &
> service)、YAML 查看 + 在位编辑 + 服务端 apply 预览、事件流(对象级 + 集群级)、
> Pod/Node 指标(实时 + 可选 Prometheus 回填)、带 PDB 提示的 Node drain、多选 +
> 批量 action + 二次确认、⌘K 命令面板、主题切换(dark/light/系统)、中英双语、
> 按集群保存偏好、MCP 服务(stdio + HTTP,~30 个工具)、`k7s-web` 单二进制部署、
> v2 设计语言(Linear / Vercel 方向)。
> 计划:RBAC 感知 UI 提示、应用内日志正则搜索、非 YAML 字段在位编辑、插件系统、
> 多集群联邦视图。

---

## 📄 License / 许可证

MIT — see [LICENSE](LICENSE) (or the SPDX header at the top of each source file).
If a `LICENSE` file is missing in this revision, the project's intent is
MIT, and you may treat the absence as a packaging oversight.

> **中文**:MIT 协议。若当前版本没有 `LICENSE` 文件,以本 README 为准 —— 项目意图即 MIT,
> 视为打包遗漏。

---

## 👤 Author / 作者

**Murphy-Yi** <zy84338719@hotmail.com>

> **中文**:本项目由 Murphy-Yi 维护,欢迎 issue / PR 反馈。

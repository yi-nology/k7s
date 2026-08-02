# k7s

> A Linear-grade Kubernetes monitor for the desktop, with a stdio + HTTP MCP server so any AI client can drive a real cluster.

![k7s — pods table (dark)](docs/screenshots/01-pods-table.png)

> `k7s` — because `t` is a `7` in 1337-speak.

**Languages / 语言**: [English](README.md) · [简体中文](README.zh-CN.md)

A dark, Lens-style Kubernetes visual monitor for the desktop, built with **Tauri 2 + Rust + React**, plus a stdio **MCP server** (`k7s-mcp`) so AI clients can drive a real cluster the same way.

Targets **macOS** and **Linux** (and Windows for development). Inspired by [k9s](https://k9scli.io/) and the [lyuke/k7s](https://github.com/lyuke/k7s) reference project.

---

## 🤔 Why k7s (vs KubePi / Lens / Headlamp)

Both [k7s](https://github.com/) and [KubePi](https://github.com/1Panel-dev/KubePi) are K8s dashboards that have grown toward each other — both ship a Helm marketplace, an image-registry panel, pod file browser, and a YAML-template-driven resource creator. They are **not** the same product, and the choice between them is about *who's holding the mouse*:

| | **k7s** | **KubePi** |
|---|---|---|
| **Shape** | Single ~9 MB native desktop app (Tauri 2) | Web app (Go + Iris + Vue 2) on a Docker image |
| **Deploy** | `pnpm tauri:build` → `.dmg` / `.appimage`; or `k7s-web` single binary | `docker run 1panel/kubepi` on a server |
| **Primary user** | A single SRE / platform engineer on their own laptop | A team / company sharing one dashboard via SSO + RBAC |
| **Local data** | Reads your `~/.kube/config` directly, no server | Reads whatever kubeconfig you point the cluster at |
| **AI integration** | **Built-in** stdio + HTTP MCP server; ~30 tools for Claude / Cursor / Claude Code | None |
| **Auth** | Whatever your local kubeconfig says (KUBECONFIG, exec plugins) | OIDC, SAML2, LDAP, MFA, RBAC down to the namespace |
| **Demo mode** | `pnpm dev` — full UI with seeded mock data, no cluster | Needs a real cluster |
| **Bundle size** | ~9 MB binary | Hundreds of MB container |
| **Telemetry / audit** | None | Login + operation log to embedded DB |

**Pick k7s** if you want a fast, native, single-binary K8s monitor with first-class AI control and you don't need a multi-tenant web dashboard for your whole team.

**Pick KubePi** if you need SSO + RBAC + audit for a shared team installation behind a web login.

### Feature parity with KubePi

k7s is intentionally a small set of high-quality primitives plus a fast UI; the four feature panels below bring it close to KubePi on the operator-facing surface, all without giving up the single-binary / single-user story:

- **Helm Marketplace** — repo CRUD, chart search across cached `index.yaml`, install / upgrade / uninstall / rollback with live log streaming, release history.
- **Pod Files** — browse / read / write / download / upload files inside a running container, via `tar` over `kubectl exec`.
- **Image Registries** — manage private OCI registries (Harbor, GHCR, ECR, Docker Hub), browse repositories and tags via the OCI Distribution v2 spec with bearer-auth challenge dance.
- **YAML Templates** — pick a template (Deployment + Service, Ingress, ConfigMap), fill the form, preview the rendered YAML, apply as a multi-document bundle.

Open any of these from the **Tools** group in the sidebar.

---

## ✨ Features

- **Multi-cluster** — kubeconfig context switcher with on-the-fly import
- **Live tables** for every common resource: Pods, Deployments, ReplicaSets, StatefulSets, DaemonSets, Jobs, CronJobs, Services, Ingresses, IngressClasses, ConfigMaps, Secrets, ServiceAccounts, PersistentVolumes, PersistentVolumeClaims, StorageClasses, Nodes, Namespaces, Events, Helm Releases
- **CRD discovery** — custom (CRD-backed) kinds are folded under their API group, Lens-style
- **Virtualised tables** for any list over 200 rows; filtering, sorting, metrics overlay and tone-coloring still work over the full dataset
- **Detail panel** with tabbed per-object views: Logs, Shell, Node Shell, Properties, Metrics, YAML, Events
- **Actions** — bulk-aware context menus with confirmations that list the names being acted on. Delete, scale, port-forward, restart, cordon / uncordon / drain, view-pods jump
- **Port forwards** — service or pod, strip of active forwards, click to copy `localhost:<port>`, error highlighting
- **Node drains** — progress banner survives navigation, PDB-blocked pods reported
- **Command palette** (⌘K) — fuzzy-find a kind, an object, or an app command
- **Settings** — log buffer cap, poll intervals, default namespace, shell command, node-shell image, theme, language — all persisted, most take effect immediately
- **Theme** — dark / light / follow system; chrome (titlebar, scrollbars, controls) follows the OS when on "system"
- **i18n** — English and Simplified Chinese, switchable from the top bar or Settings; persisted with the rest of prefs; `<html lang>` updates live
- **Per-cluster prefs** — last nav, namespace, theme, language, imported kubeconfigs, show-timestamps: all come back on the next launch
- **MCP server** (`k7s-mcp`) — exposes the same Kubernetes plumbing to AI clients (Claude Desktop, Cursor, Claude Code, …) as a stdio [Model Context Protocol](https://modelcontextprotocol.io/) server with ~30 tools covering read, write, port-forward, and shell sessions

---

## 🧱 Tech stack

| Layer | Choice |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) (Rust + WebView) |
| K8s client | [kube-rs](https://github.com/kube-rs/kube) |
| Renderer | React 19 + TypeScript + Vite |
| State | [Zustand](https://github.com/pmndrs/zustand) |
| Styling | Plain CSS with design tokens (`tokens.css`) |
| Terminal | [xterm.js](https://xtermjs.org/) + portable-pty |
| Plots | [Plotly](https://plotly.com/javascript/) (basic-dist-min) |
| YAML editor | [CodeMirror 6](https://codemirror.net/) |
| K8s types | k8s-openapi |
| Tests | Vitest + jsdom (unit), Cargo (Rust) |

---

## 📁 Layout

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
│   │   ├── web/               # axum server (k7s-web binary; --features web)
│   │   ├── mcp/               # MCP server (k7s-mcp binary; --features mcp)
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

## 🎨 Design language

k7s follows a **Linear / Vercel** direction:

- **Near-black surfaces** with cool blue undertones (`#0B0D10` base, `0.06` lift per elevation).
- **Hairline borders** (`1px` at `8–14%` alpha), no heavy dividers.
- **Subtle accent** — the brand teal `#4EC9B0` only on focus / selection / active state.
- **Tone-by-status** for row colors: green for `Running`, amber for `Pending`, red for `Failed`, neutral muted for terminal states. Status colors are tuned per palette so light mode stays legible.
- **Two palettes** — dark (headline) and light (secondary), both tokenised in `src/styles/tokens.css` and switchable from Settings or the top bar.
- **i18n baked in** — every visible string routes through `translate()`, with English + Simplified Chinese dictionaries; missing keys fall back to English.

See [`design/README.md`](design/README.md) for the full v2 spec, the standalone `design/K8s Monitor.dc.html` interactive mockup, and the original hand-off notes.

---

## 🚀 Develop

### macOS / Linux (the intended targets)

Prerequisites:

- **Node.js ≥ 18** (tested on 24)
- **Rust stable** (1.77+)
- **macOS**: `xcode-select --install`
- **Linux**: `webkit2gtk-4.1`, `libsoup-3.0`, `libayatana-appindicator3`, `librsvg2`, `openssl-dev`
  - Debian / Ubuntu: `sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev`
  - Fedora: `sudo dnf install webkit2gtk4.1-devel libsoup3-devel libappindicator-gtk3-devel librsvg2-devel openssl-devel`

```bash
pnpm install     # or npm install
pnpm tauri:dev   # or: npm run tauri:dev
```

This starts Vite on `http://localhost:1420` and launches the Tauri shell.

### Scripts

```bash
pnpm dev               # Vite only (use the mock provider for browser-only work)
pnpm tauri:dev         # Tauri + Vite
pnpm tauri:build       # full release bundle
pnpm typecheck         # tsc --noEmit
pnpm test              # vitest run
pnpm test:watch        # vitest
pnpm dev:shots         # regenerate design-comparison screenshots
```

### Demo / mock mode

Set `VITE_DEMO=1` in `.env.development.local` to make `MockProvider` serve seeded data so the UI is usable from `pnpm dev` alone (no Tauri, no cluster). The provider is selected at build time based on whether the app is running in a Tauri webview. See `src/providers/index.ts` for the routing.

### Windows (for development only)

`cargo check` is verified to work on Windows after switching to the GNU toolchain:

```powershell
rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal
rustup default stable-x86_64-pc-windows-gnu
winget install --id BrechtSanders.WinLibs.POSIX.UCRT -e --source winget
```

---

## 📦 Build a release bundle

```bash
# Desktop
pnpm tauri:build

# Browser single binary
pnpm build                            # writes dist/
cargo build --release --manifest-path src-tauri/Cargo.toml \
  --features web --bin k7s-web

# MCP stdio binary
cargo build --release --manifest-path src-tauri/Cargo.toml \
  --features mcp --bin k7s-mcp
```

`pnpm tauri:build` produces per-platform installers under `src-tauri/target/release/bundle/`.

---

## 🛠 Adding a new resource view

Add your kind to a `KindDef` in `src/lib/kinds.ts` (label, column definitions, allowed tabs, actions) — the sidebar, table, detail panel and command palette all pick it up automatically. No other file needs to change.

---

## 🌍 Adding a new locale

Drop a new dictionary into `src/lib/i18n/` (see `en.ts`) and register it in `i18n/index.ts`. Every visible string goes through `translate()`; missing keys fall back to English.

---

## 🧪 Testing

```bash
pnpm test              # frontend unit tests
pnpm typecheck         # TypeScript strict mode
cd src-tauri && cargo test   # Rust unit tests
```

For the full test plan see [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md); the most recent regression report is at [`dev/TEST_REPORT.md`](dev/TEST_REPORT.md).

---

## 🌍 Server deployment (single binary)

`k7s-web` is the same repo in a different shape — an axum HTTP server that fronts a prebuilt `dist/` and replays the same command surface over `/api/*` plus SSE, so any modern browser can drive a real cluster.

```bash
# 1. Build the front-end (writes dist/ next to the repo root)
pnpm build

# 2. Build the k7s-web binary in release mode
cargo build --release --manifest-path src-tauri/Cargo.toml \
  --features web --bin k7s-web
# → produces src-tauri/target/release/k7s-web (~8.3 MB)

# 3. Ship both to the box
#   ./k7s-web
#   ../dist/

# 4. Run
./k7s-web --addr 0.0.0.0:8080
```

Open `http://127.0.0.1:8080/` in a browser. `/api/*` uses SSE for live event streaming.

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--addr` | `0.0.0.0:8080` | Listen address |
| `--kubeconfig` | `KUBECONFIG` env var → `~/.kube/config` | Path to kubeconfig |
| `--context` | current context in kubeconfig | Override the active context |
| `--static-dir` | `dist/` next to the binary | Frontend static files |
| `--no-mcp` | enabled | Disable the embedded `/mcp` route |

### Two modes, one binary

The desktop build (`k7s`) calls into Rust directly through Tauri; the browser build (`k7s-web`) replays the same command surface as JSON-over-HTTP on top of axum. Both paths share the same `commands.rs` business logic.

### Production checklist

- Keep `dist/` next to the `k7s-web` binary.
- Open the port you passed to `--addr` in your firewall / security group.
- For container deployments, bind to 127.0.0.1 and put a reverse proxy in front.
- Mount kubeconfig as a secret — never bake it into the image.

---

## 🤖 MCP server

k7s ships a first-party MCP server called **`k7s-mcp`** with ~30 tools covering read, write, port-forward and shell sessions. AI clients (Claude Desktop, Cursor, Claude Code, …) can drive a real cluster through it.

### Choose your transport

| Scenario | Recommended | How to start |
|---|---|---|
| AI client runs on the same machine as k7s | stdio (simplest) | `k7s-mcp` |
| AI client talks to k7s over the network | HTTP (Streamable HTTP) | `k7s-web` at `/mcp` |

### 1. Local stdio — `k7s-mcp`

```bash
cargo build --release --manifest-path src-tauri/Cargo.toml \
  --features mcp --bin k7s-mcp
# → src-tauri/target/release/k7s-mcp   (~7 MB)
```

Add to your Claude Desktop / Cursor MCP config:

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

### 2. Remote / HTTP — `k7s-web`'s `/mcp`

```bash
cargo build --release --manifest-path src-tauri/Cargo.toml \
  --features web --bin k7s-web
# → src-tauri/target/release/k7s-web   (~10 MB)
./k7s-web --addr 0.0.0.0:8080
# → "k7s-web (server) listening on http://0.0.0.0:8080 (MCP: /mcp)"
```

Point the remote AI client at `http://<host>:8080/mcp` and you're done.

### What you get — the 30 tools

**Read**: list / get / watch Pods, Deployments, Services, Nodes, Namespaces, Events, and any CRD.

**Write**: apply, delete, scale, restart, cordon / uncordon, drain, exec.

**Networking**: create / list / stop port-forwards, session management.

**Shell**: node / pod exec sessions with stdin pass-through.

### Quick smoke test

```bash
# stdio
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  | k7s-mcp
```

### Safety notes

- `k7s-mcp` has the full authority of your current kubeconfig — it honours your K8s RBAC, but its tools can trigger delete, drain, exec and other high-impact actions. Run it under a dedicated context / service account.
- HTTP mode exposes `/mcp` with no built-in auth; put it behind a trusted network or reverse proxy.
- The exec tool runs arbitrary shell commands — grant with care.

---

## 🗺 Roadmap

- **Custom dashboards** — draggable cards defined by JSON Schema
- **Multi-cluster in parallel** — aggregated view across contexts in one window
- **Alerting center** — integrated with Alertmanager
- **Plugin marketplace** — shareable third-party CRD panels

---

## 📄 License

MIT

---

## 👤 Author

[Murphy-Yi](https://github.com/Murphy-Yi) — zy84338719@hotmail.com

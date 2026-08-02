# k7s

A dark, Lens-style Kubernetes visual monitor for the desktop, built with **Tauri 2 + Rust + React**.

> *k7s — because `t` is a `7` in 1337-speak.*

Targets **macOS** and **Linux** (and Windows for development). Inspired by
[k9s](https://k9scli.io/) and the [lyuke/k7s](https://github.com/lyuke/k7s)
reference project.

## ✨ Features

- **Multi-cluster** — kubeconfig context switcher with on-the-fly import
- **Live tables** for every common resource: Pods, Deployments, ReplicaSets,
  StatefulSets, DaemonSets, Jobs, CronJobs, Services, Ingresses, IngressClasses,
  ConfigMaps, Secrets, ServiceAccounts, PersistentVolumes, PersistentVolumeClaims,
  StorageClasses, Nodes, Namespaces, Events, Helm Releases
- **CRD discovery** — custom (CRD-backed) kinds are folded under their API
  group, Lens-style
- **Virtualised tables** for any list over 200 rows; filtering, sorting,
  metrics overlay and tone-coloring still work over the full dataset
- **Detail panel** with tabbed per-object views:
  - **Logs** — streaming, filter, multi-container cycler, since window, previous
    container, save to file
  - **Shell** — interactive xterm session into a pod's container
  - **Node shell** — explicit-consent privileged pod for root access on a node
  - **Properties** — sections, tables and chips gathered by the backend for
    every supported kind
  - **Metrics** — live CPU / memory / network / load / filesystem charts
    (Plotly), with optional Prometheus history backfill
  - **YAML** — read-only CodeMirror view, in-place editor, server-side apply
    preview (diff against the live object)
  - **Events** — per-object, with cluster-wide feed in the Events table
- **Actions** — bulk-aware context menus, with confirmations that list the
  names being acted on. Delete, scale, port-forward, restart, cordon / uncordon
  / drain, view-pods jump
- **Port forwards** — service or pod, strip of active forwards, copy-localhost
  by clicking, error highlighting
- **Node drains** — progress banner survives navigation; PDB-blocked pods
  reported
- **Command palette** (⌘K) — fuzzy-find a kind, an object, or an app command
- **Settings** — log buffer cap, poll intervals, default namespace, shell
  command, node-shell image, theme, language — all persisted, most take effect
  immediately
- **Theme** — dark / light / follow system; chrome (titlebar, scrollbars,
  controls) follows the OS setting when on "system"
- **i18n** — English and Simplified Chinese, switchable from the top bar or
  Settings; persisted with the rest of prefs; `<html lang>` updates live
- **Per-cluster prefs** — last nav, namespace, theme, language, imported
  kubeconfigs, show-timestamps: all come back on the next launch

## 🧱 Tech stack

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

## 📁 Layout

```
k7s/
├── src/                       # React renderer
│   ├── components/
│   │   ├── sidebar/           # cluster switcher, nav, watch footer
│   │   ├── topbar/            # breadcrumb, namespace picker, language switcher
│   │   ├── statusbar/         # connection, API latency, nodes, CPU/MEM
│   │   ├── table/             # virtualised resource table + row context menu
│   │   ├── detail/            # tabbed panel (Logs, Shell, Properties, Metrics, YAML, Events)
│   │   ├── forwards/          # active port-forwards strip
│   │   ├── palette/           # ⌘K command palette
│   │   ├── settings/          # settings modal
│   │   └── actions/           # shared action menu (detail "…" + table right-click)
│   ├── lib/
│   │   ├── theme.ts           # palette resolution + token bridge (B52)
│   │   ├── settings.ts        # user settings + sanitisation (B23)
│   │   ├── i18n/              # dictionaries + translate() (en / zh)
│   │   ├── actions.ts         # action model + bulk runner (B39)
│   │   ├── kinds.ts           # kind registry + per-kind tabs
│   │   ├── palette.ts         # ⌘K ranking (B28)
│   │   ├── logview.ts         # log ring buffer + since window (B29)
│   │   ├── selection.ts       # multi-row selection
│   │   ├── filter.ts          # parser + name selectors
│   │   ├── fuzzy.ts           # subsequence match
│   │   ├── sort.ts            # column sort
│   │   ├── virtual.ts         # row windowing (B21)
│   │   ├── drain.ts           # node drain progress
│   │   ├── diff.ts            # YAML diff hunks
│   │   ├── format.ts          # age / bytes / human numbers
│   │   └── tone.ts            # status → colour
│   ├── hooks/                 # useBootstrap, useTheme, useI18n, useTerminal, useLogStream…
│   ├── providers/             # data layer (Tauri + Mock)
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
│   │   └── kube/              # kube client, watchers, logs, exec, drain, port-forward, …
│   ├── capabilities/          # Tauri 2 capability allow-list
│   ├── icons/
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── design/                    # handoff: K8s Monitor.dc.html + design README
├── dev/                       # screenshots, internal scripts
├── public/                    # static assets
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 🚀 Develop

### macOS / Linux (the intended targets)

Prerequisites:

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

The `MockProvider` powers a demo with seeded data so the UI is usable from
`pnpm dev` alone (no Tauri, no cluster). The provider is selected at build time
based on whether the app is running in a Tauri webview. See
`src/providers/index.ts` for the routing.

### Windows (for development only)

`cargo check` is verified to work on Windows after switching to the GNU toolchain:

```powershell
# Install Rust GNU toolchain (one-time)
rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal
rustup default stable-x86_64-pc-windows-gnu

# Install MinGW (WinLibs) for the linker
winget install --id BrechtSanders.WinLibs.POSIX.UCRT -e --source winget

# Build a full release bundle on macOS / Linux instead.
```

> Note: the full `cargo build` step on Windows hits a known MinGW export-ordinal limit
> in Tauri's DLL linking. Use macOS or Linux for actual bundle builds. Source code
> itself (`cargo check`) is clean on both platforms.

## 📦 Build a release bundle

```bash
pnpm tauri:build
```

Outputs:

- macOS: `src-tauri/target/release/bundle/dmg/*.dmg` and `bundle/macos/*.app`
- Linux: `src-tauri/target/release/bundle/{appimage,deb}/...`
- Windows: `src-tauri/target/release/bundle/{msi,nsis}/...`

## 🛠 Adding a new resource view

1. Backend: define a `*Row` DTO and a `#[tauri::command]` in
   `src-tauri/src/commands.rs` returning it.
2. Register the command in `src-tauri/src/lib.rs` under `invoke_handler!`.
3. Frontend: extend `src/providers/types.ts` (`Row` shape, `KindId`, kind
   metadata in `src/lib/kinds.ts`), wire a column layout and a `KINDS_WITH_*`
   flag if the kind gets Properties / Metrics / etc.
4. Add the kind's `KIND_META` entry; it appears in the sidebar automatically.

## 🌍 Adding a new locale

1. Add a `<locale>.ts` dictionary in `src/lib/i18n/` with the same shape as
   `dictionaries.ts` (`Dictionary` interface, exported as a const).
2. Register the locale in `src/lib/i18n/index.ts`: add to the `Locale` union,
   `LOCALES`, `LOCALE_LABELS`, the `dict()` switch, and the kind/group/tab
   label maps.
3. Add a localised label to the settings panel (`settings.language.<locale>`).
4. Add unit tests in `src/lib/i18n.test.ts`.

Missing keys fall back to English, so a half-translated locale is still
shippable.

## 🧪 Testing

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

## 🗺 Roadmap

Shipped:

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

Planned:

- [ ] RBAC-aware UI hints (when a user lacks list / get on a kind)
- [ ] In-app log search by regex (current filter is substring)
- [ ] Edit-in-place for non-YAML fields (replicas, image, env)
- [ ] Plugin system
- [ ] Multi-cluster federated view

## 📄 License

MIT

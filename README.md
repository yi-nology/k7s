# k7s-frontend

React frontend for [k7s](https://github.com/yi-nology/k7s) — a Lens-style Kubernetes visual monitor.

## Tech Stack

- **React 19** + **Vite 8** — fast dev/build
- **Zustand** — lightweight state management
- **CSS Modules** + CSS custom properties — token-based theming (dark/light)
- **xterm.js** — terminal emulation (pod/node shell)
- **CodeMirror 6** — YAML editor
- **Plotly** — metrics charts
- **d3-force** — service topology graph
- **lucide-react** — icons

## Architecture

```
src/
├── components/     # UI components (sidebar, table, detail, helm, ai, ...)
├── hooks/          # React hooks (useBootstrap, useTheme, useI18n, ...)
├── lib/            # Shared utilities (kinds, i18n, theme, security, ...)
├── providers/      # Data provider abstraction
│   ├── types/      # DataProvider interface + type definitions
│   ├── BaseRpcProvider.ts  # Shared RPC methods
│   ├── HttpProvider.ts     # Browser mode (HTTP + SSE)
│   └── tauri/      # Desktop mode (Tauri IPC)
├── store/          # Zustand slices (connection, navigation, detail, data)
├── styles/         # Global CSS + design tokens
└── test/           # Test setup
```

### Provider Pattern

All backend communication goes through the `DataProvider` interface. Three implementations:

| Provider | Transport | When Used |
|----------|-----------|-----------|
| `TauriProvider` | Tauri IPC (`invoke`/`listen`) | Desktop app |
| `HttpProvider` | HTTP fetch + SSE | Browser (talks to k7s-web server) |
| `MockProvider` | Static data | Demo mode (`VITE_DEMO=1`) |

## Navigation & First-Run UX (P1)

The sidebar is a 5-section rail (registry in `src/lib/sections.tsx`); the content area routes by section:

| Section | Content |
|---------|---------|
| 概览 Overview | Home page — dashboard, or an empty-state CTA when no cluster is connected |
| 工作负载 Workloads | SubNav strip (Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, Pods, Helm releases) + resource table |
| 配置与网络 Config & Network | Grouped SubNav (Configuration / Network / Access Control / Cluster) + resource table |
| 存储 Storage | Grouped SubNav (Storage) + resource table |
| 运维工具 Tools | Tool catalog — categorized cards (metrics, Helm, images, security, network, cluster tools) |

- **First-run wizard**: on a fresh profile the app auto-opens a 3-step onboarding wizard (import kubeconfig → verify connection → preferences). Finishing it *or* dismissing it (Esc / backdrop) writes `localStorage['k7s.onboarded']`, so it never nags twice.
- **Empty state**: with no cluster connected, the overview shows an "import cluster" CTA that opens the same wizard.
- **Locale**: Chinese (zh) is the default; switch in Settings. The choice is cached at `localStorage['k7s.locale']`.

### Create-workload wizard (P2)

Workload kinds get a Kuboard-style 4-step wizard (component in `src/components/wizard/`):

1. **基本信息** Basics — name, namespace, type (Deployment/StatefulSet/DaemonSet/Job/CronJob), replicas/completions/schedule, image. Next stays disabled until name + image are valid.
2. **容器配置** Container — ports, env vars, and collapsed advanced blocks (command/args, resources, readiness/liveness probes).
3. **存储与配置** Storage — PVC volume mounts.
4. **预览与应用** Review & Apply — an editable CodeMirror YAML draft. 检查 runs a server-side dry run (per-doc pass/fail rows); any draft edit invalidates the run, and **应用 stays disabled until a clean, non-stale dry run exists**. 从 YAML 回填表单 parses an edited draft back into the form and regenerates the preview.

Entry points: the 新建 button on any workload kind, the "create your first workload" empty-state CTA, and the overview's quick entry. Non-workload kinds route their 新建 button to the YAML template picker; ingresses route to the visual Ingress editor.

### Table & feedback polish (P3)

- **Localized status badges**: status pills show localized labels (运行中 / 等待中 / 失败, …) with a "raw status — cause hint" tooltip; unknown statuses keep showing the raw string rather than a guessed label (`src/lib/statusLabels.ts`).
- **Table density**: Settings → 表格密度 switches between comfortable (default) and compact rows (26px, half the cell padding). Both modes apply to all tables, virtualized ones included — compact rows (26px) fit more of any cluster on screen, large ones included — and the choice is applied live and persisted with the other prefs.
- **Hover quick actions**: hovering a table row floats a 详情 + ⋯ cluster over the row tail — one click opens the detail panel, ⋯ opens the row's context menu without first selecting the row.
- **Humanized toasts**: known error families (connection refused, forbidden, unauthorized, …) get a localized toast title with the original raw error kept as the body so diagnostics survive; successful actions get a success-toast variant instead of silence.

### Workload wizard & navigation polish (P4)

- **Job & CronJob wizard support** — the create-workload wizard now builds all 5 workload kinds (Deployment, StatefulSet, DaemonSet, Job, CronJob). Job offers a Completions field; CronJob offers a Schedule (cron expression) field. Replicas is hidden for DaemonSet/Job/CronJob (irrelevant to those workload shapes).
- **Empty CRD hiding** — operator-installed custom resource types with zero instances are hidden from the navigation, auto-revealed when instances appear. The "Custom Resources" group toggle shows a badge of the visible (non-empty) kind count and a tooltip when some kinds are hidden.
- **Onboarding dismiss** — the first-run wizard can be dismissed via the X button (previously only Esc/backdrop worked).
- **Error hardening** — `errorsHuman` (the humanized-error toast map) covers additional connection and auth failure families so known errors always show a localized title.

### Web-mode login gate (`HttpProvider` only)

`k7s-web` exposes the full Kubernetes control surface over HTTP, so `/api/invoke/*` is always gated:

- **Loopback binds (default `127.0.0.1`)**: no password. The server publishes a per-install random token at `GET /api/web-token` (same-origin only) which the SPA picks up automatically — zero config.
- **Non-loopback binds**: `/api/web-token` is not published, so the operator must set `K7S_WEB_TOKEN` (still honored as the bearer token for scripted clients). `/api/auth/status` is session-aware: it reports `authRequired: true` only while there is no valid `k7s_session` cookie, plus `configured` so the SPA knows whether to show the setup form (first run — set the password via `POST /api/auth/setup`, which also logs you in with a 7-day sliding cookie) or the sign-in form (`POST /api/auth/login`). With a valid session the gate opens; `POST /api/auth/logout` drops it. Without credentials, API calls return 401.

## Development

```bash
pnpm install
pnpm dev          # Start Vite dev server (port 1420)
pnpm test         # Run unit tests (Vitest)
pnpm test:e2e     # Playwright smoke against the dev server (no backend needed)
pnpm lint         # ESLint
pnpm format       # Prettier
```

### With k7s-web backend

```bash
# In another terminal, start the web server:
cd ../k7s-server && cargo run --features web --bin k7s-web

# The Vite dev server proxies /api/* to http://127.0.0.1:7180
```

### Demo mode (no backend needed)

```bash
VITE_DEMO=1 pnpm dev
```

## Building

```bash
pnpm build        # Production build → dist/
```

The built assets are embedded into the `k7s-web` binary via `rust-embed`, or can be served by any static file server.

## i18n

Two locales supported: English (en) and Simplified Chinese (zh, the default). Translations are in `src/lib/i18n/` (`zh.ts`, `en.ts`, keyed by `dictionaries.ts`).

## License

Same as k7s.

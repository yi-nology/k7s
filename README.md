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

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

## Development

```bash
pnpm install
pnpm dev          # Start Vite dev server (port 1420)
pnpm test         # Run unit tests (Vitest)
pnpm lint         # ESLint
pnpm format       # Prettier
```

### With k7s-web backend

```bash
# In another terminal, start the web server:
cd ../k7s && cargo run --features web --bin k7s-web

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

Two locales supported: English (en) and Simplified Chinese (zh). Translations are in `src/lib/i18n/dictionaries.ts`.

## License

Same as k7s.

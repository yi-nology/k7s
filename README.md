# k7s-desktop

Tauri desktop shell for [k7s](https://github.com/yi-nology/k7s) — a Lens-style Kubernetes visual monitor.

## Overview

This is the standalone Tauri desktop application that wraps the k7s React frontend with native desktop capabilities:

- Native window management (size/position persistence)
- File system access (kubeconfig import)
- System tray integration
- OS keychain for API key storage
- Native dialogs

## Tech Stack

- **Tauri 2** — Rust-based desktop framework
- **React 19** + **Vite 8** — frontend
- **kube-rs** — Kubernetes client
- **tokio** — async runtime

## Building

```bash
# Install dependencies
pnpm install

# Development
pnpm tauri dev

# Production build
pnpm tauri build
```

## Related Repos

- [k7s](https://github.com/yi-nology/k7s) — monorepo (original)
- [k7s-frontend](https://github.com/yi-nology/k7s-frontend) — React frontend
- [k7s-core](https://github.com/yi-nology/k7s-core) — shared Rust core library

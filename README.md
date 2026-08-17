# k7s-ios

iPad/iOS client for [k7s](https://github.com/yi-nology/k7s) — a Lens-style Kubernetes visual monitor.

## What is this?

Native iPad app built with Tauri 2 Mobile for monitoring and managing Kubernetes clusters.

## Architecture

- [k7s-core](https://github.com/yi-nology/k7s-core) — Kubernetes business logic
- [k7s-frontend](https://github.com/yi-nology/k7s-frontend) — React UI (runs in WKWebView)

## Prerequisites

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
cargo install tauri-cli --version "^2"
```

## Build & Run

```bash
pnpm install
cargo tauri ios dev --simulator    # iOS Simulator
cargo tauri ios dev                 # Physical iPad
cargo tauri ios build               # App Store
```

## Minimum Requirements

- iOS 16.0+
- iPad (recommended) or iPhone

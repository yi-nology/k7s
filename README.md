# k7s-android

Android client for [k7s](https://github.com/yi-nology/k7s) — a Lens-style Kubernetes visual monitor.

## What is this?

Native Android app built with Tauri 2 Mobile for monitoring and managing Kubernetes clusters from your Android phone or tablet.

## Architecture

- [k7s-core](https://github.com/yi-nology/k7s-core) — Kubernetes business logic
- [k7s-frontend](https://github.com/yi-nology/k7s-frontend) — React UI (runs in Android WebView)

## Prerequisites

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
cargo install tauri-cli --version "^2"
# Android SDK + NDK (via Android Studio or sdkmanager)
```

## Build & Run

```bash
pnpm install
cargo tauri android dev              # Run on connected device/emulator
cargo tauri android build            # Build APK/AAB
```

## Minimum Requirements

- Android 8.0 (API 26)+

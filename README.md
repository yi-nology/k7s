# k7s

A cross-platform Kubernetes cluster manager built with **Tauri 2 + Rust + React**.

> *k7s — because `t` is a `7` in 1337-speak.*

Targets **macOS** and **Linux** (and Windows for development). Inspired by
[k9s](https://k9scli.io/) and the [lyuke/k7s](https://github.com/lyuke/k7s)
reference project.

## ✨ Features (MVP scaffold)

- Multi-context kubeconfig picker (auto-detects `~/.kube/config` / `$KUBECONFIG`)
- Per-namespace filtering (with an `all` option)
- Resource views: **Pods · Deployments · Services · Nodes · Namespaces**
- Compact, dark-themed UI with status-coloring (Running / Pending / Failed)
- 100% local: the kube client and credentials stay in the Rust side
- Tiny binary (~15 MB on macOS, ~20 MB on Linux) thanks to Tauri

## 🧱 Tech stack

| Layer            | Choice                                          |
|------------------|-------------------------------------------------|
| Desktop shell    | [Tauri 2](https://tauri.app) (Rust + WebView)   |
| K8s client       | [kube-rs](https://github.com/kube-rs/kube)      |
| Renderer         | React 18 + TypeScript + Vite                    |
| Styling          | Plain CSS (no framework)                        |
| K8s types        | k8s-openapi                                     |

## 📁 Layout

```
k7s/
├── src/                   # React renderer
│   ├── components/        # Sidebar / TopBar / ResourceTable
│   ├── lib/               # tauri command wrappers + shared types
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── main.rs        # entry
│   │   ├── lib.rs         # Tauri builder + command registry
│   │   ├── kube.rs        # kubeconfig loading, client construction
│   │   └── commands.rs    # #[tauri::command] handlers
│   ├── capabilities/      # Tauri 2 capability allow-list
│   ├── icons/
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── public/                # static assets for the renderer
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
npm install
npm run tauri:dev
```

This starts Vite on `http://localhost:5173` and launches the Tauri shell.

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
npm run tauri:build
```

Outputs:

- macOS: `src-tauri/target/release/bundle/dmg/*.dmg` and `bundle/macos/*.app`
- Linux: `src-tauri/target/release/bundle/{appimage,deb}/...`
- Windows: `src-tauri/target/release/bundle/{msi,nsis}/...`

## 🛠 Adding a new resource view

1. Define a `*Row` struct in `src-tauri/src/commands.rs` and a `#[tauri::command]`
   handler that returns `Result<Vec<…Row>, String>`.
2. Register the command in `src-tauri/src/lib.rs` under `invoke_handler!`.
3. Add the type to `src/lib/types.ts` and a wrapper in `src/lib/tauri.ts`.
4. Add an entry in `App.tsx`'s `NAV`, an `if (active === "...")` branch in
   `useEffect`, and a `case` in `columns` / `rows`.

## 🗺 Roadmap

- [ ] Logs streaming (xterm.js + kube-rs log watcher)
- [ ] Pod exec / attach (portable-pty)
- [ ] Port-forward UI
- [ ] YAML editor + apply
- [ ] Events stream
- [ ] CRD introspection
- [ ] Plugin system
- [ ] Multi-cluster federated view

## 📄 License

MIT

//! k7s-web — the browser-facing shell's entry point.
//!
//! Boots a tokio runtime, builds a [`k7s_lib::web::WebState`] (kube client +
//! watchers + SSE plumbing all wired up to a fresh `WebEventSink`), and
//! serves an axum router on the address given by `--addr` (default
//! `127.0.0.1:7180`).
//!
//! Two operating modes:
//!
//! - **dev API** (no `--static`): the axum server only exposes the API.
//!   Pair it with `npm run dev` (vite on 1420) which proxies `/api/*` here.
//!   This is the workflow `dev/web.mjs` automates.
//!
//! - **server** (`--static <DIR>`): also serves the built React app from
//!   `<DIR>`. One process, one port (default `0.0.0.0:8080` in production),
//!   no node, no vite. `vite build` → drop the `dist/` next to the binary →
//!   `./k7s-web --static ./dist`.
//!
//! ```text
//! $ cargo run --features web --bin k7s-web -- \
//!     --addr 0.0.0.0:8080 --static ./dist
//! ```
//!
//! Vite's dev server proxies `/api/*` here (see `vite.config.ts`), so the
//! browser sees one origin (1420) and the HTTP traffic lands on 7180. The
//! `/api` prefix is *part of k7s-web's contract*, not a vite proxy artifact
//! — both modes use the same paths.

use std::net::SocketAddr;
use std::path::PathBuf;

use k7s_lib::web::{serve, WebState};

#[tokio::main]
async fn main() -> std::io::Result<()> {
    // Match the Tauri shell's default level so logs feel familiar.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let Args { addr, static_dir } = parse_args();
    let addr = addr.unwrap_or_else(|| "127.0.0.1:7180".parse().expect("default addr parses"));

    // Where prefs and any future state lives. The Tauri shell uses
    // `app.path().app_config_dir()`; here we use a XDG-style fallback that
    // matches what kubectl itself reads.
    let data_dir = default_data_dir();

    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        tracing::warn!("could not create {}: {e}", data_dir.display());
    }

    // If we were told to serve static files, make sure the directory exists
    // before we start — a missing dist/ in server mode means the user
    // forgot to `npm run build`, and they'd rather hear that now than at
    // the first 404.
    if let Some(dir) = &static_dir {
        if !dir.join("index.html").exists() {
            tracing::error!(
                "{} does not contain index.html — did you `npm run build`?",
                dir.display()
            );
            std::process::exit(1);
        }
    }

    let state = WebState::new(data_dir);
    serve(addr, state, static_dir).await
}

#[derive(Default)]
struct Args {
    addr: Option<SocketAddr>,
    static_dir: Option<PathBuf>,
}

fn parse_args() -> Args {
    let mut out = Args::default();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--addr" => {
                out.addr = args.next().and_then(|s| s.parse().ok());
            }
            "--static" | "--static-dir" => {
                out.static_dir = args.next().map(PathBuf::from);
            }
            "-h" | "--help" => {
                eprintln!("k7s-web — Kubernetes visual monitor (web shell)\n");
                eprintln!("USAGE:");
                eprintln!("    k7s-web [--addr <SOCKET>] [--static <DIR>]\n");
                eprintln!("OPTIONS:");
                eprintln!("    --addr <SOCKET>     Listen address (default: 127.0.0.1:7180)");
                eprintln!("                         Use 0.0.0.0:8080 in production.");
                eprintln!("    --static <DIR>      Also serve the built React app from <DIR>.");
                eprintln!("                         Enables single-binary 'server' mode.");
                std::process::exit(0);
            }
            other => {
                tracing::warn!("ignoring unknown arg: {other}");
            }
        }
    }
    out
}

/// XDG-style data directory: `$XDG_CONFIG_HOME/k7s` on Linux,
/// `~/Library/Application Support/k7s` on macOS, `%APPDATA%\k7s` on Windows.
/// Falls back to the current working directory if nothing usable is set.
fn default_data_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("k7s");
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
            if !xdg.is_empty() {
                return PathBuf::from(xdg).join("k7s");
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(".config").join("k7s");
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(roam) = std::env::var("APPDATA") {
            return PathBuf::from(roam).join("k7s");
        }
    }
    PathBuf::from(".k7s")
}

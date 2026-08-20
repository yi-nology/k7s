//! k7s-web — the browser-facing shell's entry point.
//!
//! Boots a tokio runtime, builds a [`k7s_server::web::WebState`] (kube client +
//! watchers + SSE plumbing all wired up to a fresh `WebEventSink`), and
//! serves an axum router.
//!
//! Features:
//! - **Auto port selection**: tries the preferred port, then increments until
//!   an available port is found.
//! - **Auto browser open**: opens the default browser to the serving URL.
//! - **Embedded assets**: serves the built React app from compile-time
//!   embedded files when no `--static` dir is given.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener as StdTcpListener};

use k7s_server::web::{serve, WebState};

#[k7s_deps::tokio::main]
async fn main() -> std::io::Result<()> {
    // Install the rustls crypto provider before any TLS connections are made.
    let _ = k7s_deps::rustls::crypto::ring::default_provider().install_default();

    // Match the Tauri shell's default level so logs feel familiar.
    k7s_deps::tracing_subscriber::fmt()
        .with_env_filter(
            k7s_deps::tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| k7s_deps::tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let args = parse_args();

    // ── Port selection ───────────────────────────────────────────────
    let addr = if let Some(a) = args.addr {
        a
    } else {
        pick_port(args.preferred_port).await
    };

    // Where prefs and any future state lives.
    let data_dir = default_data_dir();
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        k7s_deps::tracing::warn!("could not create {}: {e}", data_dir.display());
    }

    // Validate --static if given.
    if let Some(dir) = &args.static_dir {
        if !dir.join("index.html").exists() {
            k7s_deps::tracing::error!(
                "{} does not contain index.html — did you `npm run build`?",
                dir.display()
            );
            std::process::exit(1);
        }
    }

    // Determine whether to use embedded assets.
    let use_embedded = args.static_dir.is_none();

    let state = WebState::new(data_dir, addr);

    // Print the access URL prominently.
    let url = format!("http://{addr}");
    k7s_deps::tracing::info!("k7s-web listening on {url}");
    println!();
    println!("  k7s-web is running at: {url}");
    println!();

    // ── Auto-open browser ────────────────────────────────────────────
    if !args.no_open {
        if let Err(e) = open::that(&url) {
            k7s_deps::tracing::warn!("failed to open browser: {e}");
        }
    }

    // ── Start server ─────────────────────────────────────────────────
    k7s_deps::tokio::select! {
        result = serve(addr, state, args.static_dir, use_embedded) => {
            result?;
        }
        _ = k7s_deps::tokio::signal::ctrl_c() => {
            k7s_deps::tracing::info!("Ctrl+C received, shutting down");
        }
    }

    Ok(())
}

/// Try to bind to `preferred` port; if busy, try the next 100 ports.
async fn pick_port(preferred: u16) -> SocketAddr {
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), preferred);
    if StdTcpListener::bind(addr).is_ok() {
        return addr;
    }
    for port in (preferred + 1)..=(preferred + 100) {
        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
        if StdTcpListener::bind(addr).is_ok() {
            k7s_deps::tracing::info!("port {preferred} busy, using {port}");
            return addr;
        }
    }
    let listener = StdTcpListener::bind("127.0.0.1:0").expect("bind to port 0");
    let addr = listener.local_addr().expect("get local addr");
    k7s_deps::tracing::info!("port {preferred}+ busy, OS assigned {addr}");
    addr
}

// ── CLI argument parsing ─────────────────────────────────────────────

struct Args {
    addr: Option<SocketAddr>,
    preferred_port: u16,
    static_dir: Option<std::path::PathBuf>,
    no_open: bool,
}

fn parse_args() -> Args {
    let mut args = Args {
        addr: None,
        preferred_port: 7180,
        static_dir: None,
        no_open: false,
    };
    let mut iter = std::env::args().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--addr" => {
                args.addr = iter.next().and_then(|s| s.parse().ok());
            }
            "--port" => {
                args.preferred_port = iter.next().and_then(|s| s.parse().ok()).unwrap_or(7180);
            }
            "--static" | "--static-dir" => {
                args.static_dir = iter.next().map(std::path::PathBuf::from);
            }
            "--no-open" => {
                args.no_open = true;
            }
            "-h" | "--help" => {
                eprintln!("k7s-web — Kubernetes visual monitor (web shell)\n");
                eprintln!("USAGE:");
                eprintln!("    k7s-web [OPTIONS]\n");
                eprintln!("OPTIONS:");
                eprintln!("    --addr <SOCKET>     Listen address (default: auto-select port on 127.0.0.1)");
                eprintln!("    --port <PORT>       Preferred port (default: 7180, auto-increments if busy)");
                eprintln!(
                    "    --static <DIR>      Serve built React app from <DIR> instead of embedded"
                );
                eprintln!("    --no-open           Don't auto-open the browser");
                eprintln!("    -h, --help          Show this help");
                std::process::exit(0);
            }
            other => {
                k7s_deps::tracing::warn!("ignoring unknown arg: {other}");
            }
        }
    }
    args
}

/// XDG-style data directory.
fn default_data_dir() -> std::path::PathBuf {
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return std::path::PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("k7s");
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
            if !xdg.is_empty() {
                return std::path::PathBuf::from(xdg).join("k7s");
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            return std::path::PathBuf::from(home).join(".config").join("k7s");
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(roam) = std::env::var("APPDATA") {
            return std::path::PathBuf::from(roam).join("k7s");
        }
    }
    std::path::PathBuf::from(".k7s")
}

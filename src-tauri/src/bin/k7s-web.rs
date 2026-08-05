//! k7s-web — the browser-facing shell's entry point.
//!
//! Boots a tokio runtime, builds a [`k7s_lib::web::WebState`] (kube client +
//! watchers + SSE plumbing all wired up to a fresh `WebEventSink`), and
//! serves an axum router.
//!
//! Features:
//! - **Auto port selection**: tries the preferred port, then increments until
//!   an available port is found.
//! - **Auto browser open**: opens the default browser to the serving URL.
//! - **System tray**: shows a tray icon with the URL, copy-link, and quit.
//! - **Embedded assets**: serves the built React app from compile-time
//!   embedded files when no `--static` dir is given.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener as StdTcpListener};

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

    let args = parse_args();

    // ── Port selection ───────────────────────────────────────────────
    // If --addr is given, use it directly. Otherwise try the preferred
    // port and increment until we find a free port.
    let addr = if let Some(a) = args.addr {
        a
    } else {
        pick_port(args.preferred_port).await
    };

    // Where prefs and any future state lives.
    let data_dir = default_data_dir();
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        tracing::warn!("could not create {}: {e}", data_dir.display());
    }

    // Validate --static if given.
    if let Some(dir) = &args.static_dir {
        if !dir.join("index.html").exists() {
            tracing::error!(
                "{} does not contain index.html — did you `npm run build`?",
                dir.display()
            );
            std::process::exit(1);
        }
    }

    // Determine whether to use embedded assets.
    // Embedded mode is active when no --static is given.
    let use_embedded = args.static_dir.is_none();

    let state = WebState::new(data_dir);

    // Print the access URL prominently.
    let url = format!("http://{addr}");
    tracing::info!("k7s-web listening on {url}");
    println!();
    println!("  k7s-web is running at: {url}");
    println!();

    // ── Auto-open browser ────────────────────────────────────────────
    if !args.no_open {
        if let Err(e) = open::that(&url) {
            tracing::warn!("failed to open browser: {e}");
        }
    }

    // ── System tray ──────────────────────────────────────────────────
    // Run the tray in a background thread. The tray needs a Win32
    // message loop on Windows, which blocks the thread.
    let (quit_tx, quit_rx) = tokio::sync::oneshot::channel::<()>();

    if !args.no_tray {
        let url_clone = url.clone();
        std::thread::spawn(move || {
            run_tray(&url_clone, quit_tx);
        });
    } else {
        // If no tray, drop the sender so the receiver resolves immediately
        // on shutdown (Ctrl+C handles it).
        drop(quit_tx);
    }

    // ── Start server ─────────────────────────────────────────────────
    // Race between the server and the quit signal.
    tokio::select! {
        result = serve(addr, state, args.static_dir, use_embedded) => {
            result?;
        }
        _ = quit_rx => {
            tracing::info!("quit requested from tray");
        }
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("Ctrl+C received, shutting down");
        }
    }

    Ok(())
}

/// Try to bind to `preferred` port; if busy, try the next 100 ports.
/// Falls back to OS-assigned port (port 0).
async fn pick_port(preferred: u16) -> SocketAddr {
    // Try the preferred port first.
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), preferred);
    if StdTcpListener::bind(addr).is_ok() {
        return addr;
    }
    // Try the next 100 ports.
    for port in (preferred + 1)..=(preferred + 100) {
        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
        if StdTcpListener::bind(addr).is_ok() {
            tracing::info!("port {preferred} busy, using {port}");
            return addr;
        }
    }
    // Fall back to OS-assigned.
    let listener = StdTcpListener::bind("127.0.0.1:0").expect("bind to port 0");
    let addr = listener.local_addr().expect("get local addr");
    tracing::info!("port {preferred}+ busy, OS assigned {addr}");
    addr
}

/// Run the system tray icon with a context menu. Blocks the calling thread
/// (needs a Win32 message loop on Windows).
fn run_tray(url: &str, quit_tx: tokio::sync::oneshot::Sender<()>) {
    use tray_icon::{
        menu::{Menu, MenuItem, PredefinedMenuItem},
        TrayIconBuilder,
    };

    let menu = Menu::new();
    let copy_url_item = MenuItem::new("Copy URL", true, None);
    let open_browser_item = MenuItem::new("Open in browser", true, None);
    let quit_item = MenuItem::new("Quit k7s", true, None);

    let _ = menu.append(&copy_url_item);
    let _ = menu.append(&open_browser_item);
    let _ = menu.append(&PredefinedMenuItem::separator());
    let _ = menu.append(&quit_item);

    let _tray = match TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip(&format!("k7s — {url}"))
        .build()
    {
        Ok(tray) => tray,
        Err(e) => {
            tracing::warn!("failed to create tray icon: {e}");
            let _ = quit_tx.send(());
            return;
        }
    };

    let url_owned = url.to_string();

    // Event loop — blocks until quit.
    loop {
        if let Ok(event) = tray_icon::menu::MenuEvent::receiver().try_recv() {
            if event.id == *copy_url_item.id() {
                if let Ok(mut clipboard) = arboard::Clipboard::new() {
                    if let Err(e) = clipboard.set_text(&url_owned) {
                        tracing::warn!("failed to copy URL: {e}");
                    } else {
                        tracing::info!("URL copied to clipboard");
                    }
                }
            } else if event.id == *open_browser_item.id() {
                if let Err(e) = open::that(&url_owned) {
                    tracing::warn!("failed to open browser: {e}");
                }
            } else if event.id == *quit_item.id() {
                let _ = quit_tx.send(());
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

// ── CLI argument parsing ─────────────────────────────────────────────

struct Args {
    addr: Option<SocketAddr>,
    preferred_port: u16,
    static_dir: Option<std::path::PathBuf>,
    no_open: bool,
    no_tray: bool,
}

fn parse_args() -> Args {
    let mut args = Args {
        addr: None,
        preferred_port: 7180,
        static_dir: None,
        no_open: false,
        no_tray: false,
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
            "--no-tray" => {
                args.no_tray = true;
            }
            "-h" | "--help" => {
                eprintln!("k7s-web — Kubernetes visual monitor (web shell)\n");
                eprintln!("USAGE:");
                eprintln!("    k7s-web [OPTIONS]\n");
                eprintln!("OPTIONS:");
                eprintln!("    --addr <SOCKET>     Listen address (default: auto-select port on 127.0.0.1)");
                eprintln!("    --port <PORT>       Preferred port (default: 7180, auto-increments if busy)");
                eprintln!("    --static <DIR>      Serve built React app from <DIR> instead of embedded");
                eprintln!("    --no-open           Don't auto-open the browser");
                eprintln!("    --no-tray           Don't show system tray icon");
                eprintln!("    -h, --help          Show this help");
                std::process::exit(0);
            }
            other => {
                tracing::warn!("ignoring unknown arg: {other}");
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

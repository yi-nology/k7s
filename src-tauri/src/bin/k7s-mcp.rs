//! k7s-mcp — a Model Context Protocol server for Kubernetes.
//!
//! Boots a tokio runtime, builds a [`k7s_lib::mcp::K7sMcpServer`] (a
//! `ClientManager` wrapped behind `rmcp`'s `#[tool_router]`), and serves it
//! over stdin/stdout. The MCP host (Claude Desktop, Cursor, Claude Code, …)
//! launches this binary as a child process; the host and server exchange
//! JSON-RPC over stdio.
//!
//! Connection model:
//!
//! - On startup the server has no kube client. The first tool call that
//!   needs one returns a friendly "call `connect` first" error.
//! - The AI calls `list_contexts`, then `connect` with a context name
//!   (empty uses current-context). The server builds the client, probes
//!   the API server, and starts CRD discovery.
//! - Subsequent tool calls use the same client. `disconnect` (or any
//!   re-`connect`) tears down the prior session — watchers, log streams,
//!   shells, port-forwards all get aborted.
//!
//! Read your `KUBECONFIG` env var (or `~/.kube/config`) the same way
//! `kubectl` does — nothing in the kubeconfig handling is k7s-specific.
//!
//! ```text
//! $ KUBECONFIG=/path/to/config ./k7s-mcp
//! ```
//!
//! This binary is gated on the `mcp` feature; build it with:
//!
//! ```text
//! cargo build --release --features mcp --bin k7s-mcp
//! ```

use std::path::PathBuf;

use k7s_lib::mcp::K7sMcpServer;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    // Install the rustls crypto provider before any TLS connections.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    // Match the Tauri shell's default level so logs feel familiar; the host
    // sees the same severity structure as its own MCP servers.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    let data_dir = default_data_dir();
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        tracing::warn!("could not create {}: {e}", data_dir.display());
    }

    let server = K7sMcpServer::new(data_dir);
    if let Err(e) = k7s_lib::mcp::server::serve_stdio(server).await {
        tracing::error!("k7s-mcp exiting: {e}");
        return Err(std::io::Error::other(e.to_string()));
    }
    Ok(())
}

/// XDG-style data directory. The MCP server has no Settings dialog, so
/// nothing in `data_dir` is read at runtime today — but the directory must
/// exist (and be writable) so the future prefs path doesn't blow up the
/// first time someone wires one in.
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

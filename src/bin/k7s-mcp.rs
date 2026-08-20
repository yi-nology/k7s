//! k7s-mcp — a Model Context Protocol server for Kubernetes.
//!
//! Boots a tokio runtime, builds a [`k7s_server::mcp::K7sMcpServer`] (a
//! `ClientManager` wrapped behind `rmcp`'s `#[tool_router]`), and serves it
//! over stdin/stdout. The MCP host (Claude Desktop, Cursor, Claude Code, …)
//! launches this binary as a child process; the host and server exchange
//! JSON-RPC over stdio.

use std::path::PathBuf;

use k7s_server::mcp::K7sMcpServer;

#[k7s_deps::tokio::main]
async fn main() -> std::io::Result<()> {
    // Install the rustls crypto provider before any TLS connections.
    let _ = k7s_deps::rustls::crypto::ring::default_provider().install_default();

    k7s_deps::tracing_subscriber::fmt()
        .with_env_filter(
            k7s_deps::tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| k7s_deps::tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    let data_dir = default_data_dir();
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        k7s_deps::tracing::warn!("could not create {}: {e}", data_dir.display());
    }

    let server = K7sMcpServer::new(data_dir);
    if let Err(e) = k7s_server::mcp::server::serve_stdio(server).await {
        k7s_deps::tracing::error!("k7s-mcp exiting: {e}");
        return Err(std::io::Error::other(e.to_string()));
    }
    Ok(())
}

/// XDG-style data directory.
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

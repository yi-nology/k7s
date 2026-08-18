//! k7s-server — axum HTTP server + MCP server for k7s.
//!
//! This crate provides the web (HTTP) and MCP (Model Context Protocol) server
//! implementations for k7s. Both delegate to `k7s-core` for all Kubernetes
//! business logic; this crate only handles transport (HTTP routes, SSE, auth,
//! MCP tool dispatch).
//!
//! - `k7s-web` binary: standalone axum server with embedded React frontend.
//! - `k7s-mcp` binary: stdio MCP server for AI clients.
//!
//! Feature flags:
//! - `web`: enables axum HTTP server + MCP over Streamable HTTP.
//! - `mcp`: enables stdio MCP server (independent of `web`).

// Re-export core modules so downstream consumers can use `k7s_server::core::*`
pub use k7s_core::{ai, core, error, kube};

// Re-export k7s-deps for shared dependencies
pub use k7s_deps;

// Re-export k7s_core itself for convenience
pub use k7s_core;

/// Web server (axum HTTP, SSE, auth). Only compiled with the `web` feature.
#[cfg(feature = "web")]
pub mod web;

/// MCP server (stdio + Streamable HTTP). Compiled with either `mcp` or `web`.
#[cfg(any(feature = "mcp", feature = "web"))]
pub mod mcp;

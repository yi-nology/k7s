//! Tauri commands invoked by the frontend. These are the only entry points from
//! the webview into Kubernetes. Live data (tables, metrics, status, logs) is
//! pushed back via events (see kube::events); these commands cover the one-shot
//! request/response operations plus starting/stopping log streams.
//!
//! iPadOS build: AI assistant, Helm marketplace, SBOM, security audit, image
//! registry/transfer, scanner, Grafana, pod files, and plugins are excluded to
//! reduce binary size and match the trimmed mobile feature set.

pub mod core;
pub mod forward;
pub mod observability;
pub mod shell;
pub mod storage;

// Re-export all commands so `commands::func` paths in lib.rs still work.
pub use core::*;
pub use forward::*;
pub use observability::*;
pub use shell::*;
pub use storage::*;

//! Tauri commands invoked by the frontend. These are the only entry points from
//! the webview into Kubernetes. Live data (tables, metrics, status, logs) is
//! pushed back via events (see kube::events); these commands cover the one-shot
//! request/response operations plus starting/stopping log streams.

pub mod core;
pub mod forward;
pub mod helm;
pub mod observability;
pub mod sbom;
pub mod shell;
pub mod storage;

// Re-export all commands so `commands::func` paths in lib.rs still work.
pub use core::*;
pub use forward::*;
pub use helm::*;
pub use observability::*;
pub use sbom::*;
pub use shell::*;
pub use storage::*;

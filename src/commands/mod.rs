//! Tauri commands invoked by the frontend. These are the only entry points from
//! the webview into Kubernetes. Live data (tables, metrics, status, logs) is
//! pushed back via events (see k7s_deps::kube::events); these commands cover the one-shot
//! request/response operations plus starting/stopping log streams.

pub mod ai;
pub mod ai_deep;
pub mod ai_extra;
pub mod core;
pub mod cron;
pub mod forward;
pub mod helm;
pub mod memory;
pub mod observability;
pub mod sbom;
pub mod scanner;
pub mod security;
pub mod shell;
pub mod skills;
pub mod storage;

// Re-export all commands so `commands::func` paths in lib.rs still work.
pub use ai::*;
pub use ai_deep::*;
pub use ai_extra::*;
pub use core::*;
pub use cron::*;
pub use forward::*;
pub use helm::*;
pub use memory::*;
pub use observability::*;
pub use sbom::*;
pub use scanner::*;
pub use security::*;
pub use shell::*;
pub use skills::*;
pub use storage::*;

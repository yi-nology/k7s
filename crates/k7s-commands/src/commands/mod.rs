//! Tauri commands invoked by the frontend. These are the only entry points from
//! the webview into Kubernetes. Live data (tables, metrics, status, logs) is
//! pushed back via events; these commands cover the one-shot request/response
//! operations plus starting/stopping log streams.
//!
//! Platform surface (mirrors the historical per-shell trimmed lists):
//! - all platforms: core, storage, shell, forward, observability
//! - desktop + android: the AI assistant surface and Helm marketplace
//! - desktop only: SBOM / scanner (external CLI tools)

pub mod core;
pub mod storage;

// All platforms.
pub mod forward;
pub mod observability;
pub mod shell;

// AI assistant surface — iPadOS excludes it (binary size + trimmed feature set).
#[cfg(not(target_os = "ios"))]
pub mod ai;
#[cfg(not(target_os = "ios"))]
pub mod ai_deep;
#[cfg(not(target_os = "ios"))]
pub mod ai_extra;
#[cfg(not(target_os = "ios"))]
pub mod cron;
#[cfg(not(target_os = "ios"))]
pub mod memory;
#[cfg(not(target_os = "ios"))]
pub mod security;
#[cfg(not(target_os = "ios"))]
pub mod skills;

// Helm marketplace — desktop and android only.
#[cfg(not(target_os = "ios"))]
pub mod helm;

// SBOM / scanner — desktop only (CLI tools unavailable on mobile targets).
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod sbom;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod scanner;

// Flat re-exports so `commands::<fn>` paths keep working.
#[cfg(not(target_os = "ios"))]
pub use ai::*;
#[cfg(not(target_os = "ios"))]
pub use ai_deep::*;
#[cfg(not(target_os = "ios"))]
pub use ai_extra::*;
pub use core::*;
#[cfg(not(target_os = "ios"))]
pub use cron::*;
pub use forward::*;
#[cfg(not(target_os = "ios"))]
pub use helm::*;
#[cfg(not(target_os = "ios"))]
pub use memory::*;
pub use observability::*;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub use sbom::*;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub use scanner::*;
#[cfg(not(target_os = "ios"))]
pub use security::*;
pub use shell::*;
#[cfg(not(target_os = "ios"))]
pub use skills::*;
pub use storage::*;

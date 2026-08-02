//! Transport-agnostic command handlers.
//!
//! Each public function in this module is the inner body of a Tauri command
//! (called from `crate::commands`) and an axum route (called from
//! `crate::web::handlers`). Tauri and the web shell are the only callers;
//! the core's own background tasks don't go through here.
//!
//! For now the actual command bodies live in `crate::commands` as `#[tauri::command]`
//! wrappers — extracting them is phase 3 of the web-mode work. The web shell's
//! axum routes call into `crate::kube` (the business logic) directly while the
//! refactor is in progress.

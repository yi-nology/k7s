//! Tauri command handlers — the API surface exposed to the React UI.
//!
//! Split by **domain**, not by file size. Each file owns one concern:
//!
//!   - [`context`]  — kubeconfig context list / import
//!   - [`connect`]  — connect to a context, disconnect
//!   - [`resources`]— list / get_yaml / apply_yaml / delete for every kind
//!   - [`actions`]  — scale / restart / cordon / drain
//!   - [`logs`]     — pod log streaming (start / stop)
//!   - [`shell`]    — container exec
//!   - [`portforward`] — port-forward start / stop / list
//!   - [`events`]   — Kubernetes events listing
//!
//! Every command returns `AppResult<T>` (i.e. `Result<T, AppError>`).
//! The frontend sees a string error message — keep the `Display` impl
//! useful.

pub mod actions;
pub mod connect;
pub mod context;
pub mod events;
pub mod logs;
pub mod portforward;
pub mod resources;
pub mod shell;

//! CoreState — the one handle every command receives.
//!
//! Tauri commands used to take `State<'_, Arc<ClientManager>>` directly. Web
//! commands will take the same `CoreState` (via axum's `State` extractor). The
//! point of this wrapper is to be the future-proof seam: when a new piece of
//! shared state shows up (e.g. a settings cache, a metrics ring buffer), it
//! gets a field here, and every shell picks it up for free.
//!
//! Right now it carries:
//! - the [`ClientManager`] (the connection, all background tasks, and — via
//!   the manager's sink — every event source the user sees)
//! - the data directory for persisted prefs and any future state files.
//!   Tauri picks this from `app.path().app_config_dir()`; the web shell picks
//!   a platform-appropriate fallback (`$XDG_CONFIG_HOME/k7s` etc.).

use std::path::PathBuf;
use std::sync::Arc;

use crate::kube::ClientManager;

/// What every command closure closes over.
///
/// Cheap to clone (it's a single `Arc` deref). Both shells pass it as their
/// state — the Tauri adapter registers it via `app.manage(core_state)`, the
/// web shell builds it once in `web/server.rs`.
pub struct CoreState {
    pub manager: Arc<ClientManager>,
    /// Directory for `prefs.json` and any other persistent app state.
    ///
    /// Tauri: `app.path().app_config_dir()` (e.g. `~/Library/Application
    /// Support/com.k7s.app` on macOS).
    /// Web: `~/.config/k7s` (or `$XDG_CONFIG_HOME/k7s`) on Linux/macOS,
    /// `%APPDATA%\k7s` on Windows.
    pub data_dir: PathBuf,
}

impl CoreState {
    pub fn new(manager: Arc<ClientManager>, data_dir: PathBuf) -> Arc<Self> {
        Arc::new(Self { manager, data_dir })
    }
}

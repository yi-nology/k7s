//! k7s-ios Tauri application entry point (library crate).
//!
//! The frontend talks to Kubernetes exclusively through the Tauri commands
//! registered here; it never speaks to the API server directly. Live data is
//! pushed back to the webview via Tauri events (see the `kube` module).

pub use k7s_core::{core, error, kube};

use k7s_core::core::CoreState;
use k7s_core::kube::ClientManager;
use std::sync::Arc;
// Brings `.manage()` into scope for the App in the setup hook.
use tauri::Manager;

/// Build and run the Tauri application.
///
/// Kept in the library crate so integration tests can construct pieces of it
/// without spawning a real window.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Structured logs to stderr; level controlled by RUST_LOG (defaults to info).
    k7s_deps::tracing_subscriber::fmt()
        .with_env_filter(
            k7s_deps::tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| k7s_deps::tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        // The shell plugin backs the capability that lets us open external URLs
        // (e.g. links in the UI) in the user's default browser.
        .plugin(tauri_plugin_shell::init())
        // The dialog plugin backs the native file picker for "Import kubeconfig".
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // The ClientManager owns the active client and all connection-scoped
            // tasks. It takes an `EventSink` (not a Tauri `AppHandle`) so the
            // same manager can serve the standalone web shell in the future —
            // TauriEventSink here, WebEventSink over there.
            let sink = core::events::tauri_sink(app.handle().clone());
            let manager = Arc::new(ClientManager::new(sink));
            // Where `prefs.json` (and any future persistent state) lives. The
            // web shell uses a XDG-style fallback — see `web/state.rs`.
            let data_dir = app
                .path()
                .app_config_dir()
                .map_err(|e| format!("no config dir: {e}"))?;
            let state = CoreState::new(manager, data_dir);
            app.manage(state);
            Ok(())
        })
        .invoke_handler(k7s_commands::register_commands!())
        .run(tauri::generate_context!())
        .expect("error while running k7s application");
}

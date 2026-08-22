//! k7s Android application entry point (library crate).

pub use k7s_core::ai;
pub use k7s_core::core;
pub use k7s_core::error;
pub use k7s_core::kube;

use k7s_core::core::CoreState;
use k7s_core::kube::ClientManager;
use std::sync::Arc;
use tauri::Manager;

/// Android JNI entry point. Replaces tauri::mobile_entry_point which is
/// gated behind cfg(mobile) — a flag that the Tauri Gradle plugin cannot
/// reliably inject. This always-compiled export provides the same
/// JNI_OnLoad symbol that Tauri's validation checks for in the .so.
/// On non-Android targets the symbol is unused but harmless.
#[no_mangle]
unsafe extern "C" fn JNI_OnLoad(_env: *mut std::ffi::c_void, _klass: *mut std::ffi::c_void) -> i32 {
    6 // JNI_VERSION_1_6
}

/// Tauri's Android plugin response handler — the symbol that the Tauri CLI
/// actually validates for in the .so (not JNI_OnLoad). The macro
/// mobile_entry_point generates this under cfg(mobile); we provide it
/// directly to bypass the cfg injection problem.
#[no_mangle]
unsafe extern "C" fn Java_app_tauri_plugin_PluginManager_handlePluginResponse(
    _env: *mut std::ffi::c_void,
    _klass: *mut std::ffi::c_void,
    _response: *mut std::ffi::c_void,
) {
}

/// Build and run the Tauri application for Android.
pub fn run() {
    k7s_deps::tracing_subscriber::fmt()
        .with_env_filter(
            k7s_deps::tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| k7s_deps::tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let sink = core::events::tauri_sink(app.handle().clone());
            let manager = Arc::new(ClientManager::new(sink));
            let data_dir = app
                .path()
                .app_config_dir()
                .map_err(|e| format!("no config dir: {e}"))?;
            let state = CoreState::new(manager, data_dir);
            app.manage(state);
            app.manage(Arc::new(k7s_commands::commands::ai::AiRuntime::new()));
            Ok(())
        })
        .invoke_handler(k7s_commands::register_commands!())
        .run(tauri::generate_context!())
        .expect("error while running k7s-android application");
}

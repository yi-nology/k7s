//! k7s-ios Tauri application entry point (library crate).
//!
//! The frontend talks to Kubernetes exclusively through the Tauri commands
//! registered here; it never speaks to the API server directly. Live data is
//! pushed back to the webview via Tauri events (see the `kube` module).

mod commands;

pub use k7s_core::{error, kube, core};

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
        .invoke_handler(tauri::generate_handler![
            // ── Cluster & kubeconfig ──────────────────────────────────
            commands::list_contexts,
            commands::default_kubeconfig_path,
            commands::import_kubeconfig,
            commands::restore_imports,
            commands::load_prefs,
            commands::save_prefs,
            commands::connect,
            // ── Resource CRUD ─────────────────────────────────────────
            commands::get_yaml,
            commands::apply_yaml,
            commands::dry_run_yaml,
            commands::delete_resource,
            commands::scale_resource,
            commands::set_cordon,
            commands::restart_pod,
            commands::diagnose_pod,
            commands::restart_rollout,
            commands::list_revisions,
            commands::undo_rollout,
            commands::drain_node,
            commands::get_events,
            commands::get_secret_data,
            commands::configmap_snapshots,
            commands::secret_snapshots,
            commands::configmap_snapshot_yaml,
            commands::get_properties,
            commands::watch_custom_kind,
            commands::unwatch_custom_kind,
            commands::dependency_graph,
            commands::debug_ingress,
            commands::simulate_connectivity,
            commands::node_history,
            commands::pod_history,
            commands::watch_node_stats,
            commands::unwatch_node_stats,
            // ── Logs & Shell ──────────────────────────────────────────
            commands::start_log_stream,
            commands::export_logs,
            commands::stop_log_stream,
            commands::start_shell,
            commands::shell_input,
            commands::shell_resize,
            commands::stop_shell,
            commands::start_node_shell,
            commands::stop_node_shell,
            // ── Port forwarding ───────────────────────────────────────
            commands::start_port_forward,
            commands::start_service_port_forward,
            commands::stop_port_forward,
            commands::list_port_forwards,
            // ── Endpoints ─────────────────────────────────────────────
            commands::list_endpoints,
            commands::list_endpoints_for_service,
            commands::list_endpoint_addresses,
            // ── CronJob ───────────────────────────────────────────────
            commands::trigger_cronjob,
            // ── Multi-document YAML (templates) ───────────────────────
            commands::apply_yaml_bundle,
            commands::dry_run_yaml_bundle,
            // ── Metrics / Prometheus ──────────────────────────────────
            commands::metrics_list,
            commands::metrics_upsert,
            commands::metrics_remove,
            commands::metrics_test,
            commands::metrics_query,
            commands::metrics_query_range,
            // ── AlertManager ──────────────────────────────────────────
            commands::alertmanager_list,
            commands::alertmanager_upsert,
            commands::alertmanager_remove,
            commands::alertmanager_test,
            commands::alertmanager_alerts,
            commands::alertmanager_silences,
            commands::alertmanager_create_silence,
            commands::alertmanager_delete_silence,
            commands::prometheus_rules,
            // ── Loki / K8s Audit log ─────────────────────────────────
            commands::loki_list,
            commands::loki_upsert,
            commands::loki_remove,
            commands::loki_test,
            commands::audit_events,
            // ── Saved PromQL queries ──────────────────────────────────
            commands::saved_queries_list,
            commands::saved_queries_upsert,
            commands::saved_queries_remove,
            commands::saved_queries_clear_cache,
            commands::saved_queries_run,
            // ── Removed from iPadOS build: ────────────────────────────
            // Helm marketplace (heavy wizard, poor touch ergonomics)
            // Pod file management (upload/download limited on iPad)
            // Image registry / transfer / export (desktop toolchain)
            // SBOM generation (heavy background task)
            // RBAC security audit (report-oriented)
            // Scanner status (trivy/grype not available on iOS)
            // Grafana embed (iframe, poor iPad experience)
            // AI assistant (ReAct loop, keyboard-intensive)
        ])
        .run(tauri::generate_context!())
        .expect("error while running k7s application");
}

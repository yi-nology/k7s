//! k7s Android application entry point (library crate).

mod commands;

pub use k7s_core::error;
pub use k7s_core::kube;
pub use k7s_core::ai;
pub use k7s_core::core;

use k7s_core::core::CoreState;
use k7s_core::kube::ClientManager;
use std::sync::Arc;
use tauri::Manager;

/// Android JNI entry point. Replaces tauri::mobile_entry_point which is
/// gated behind cfg(mobile) — a flag that the Tauri Gradle plugin cannot
/// reliably inject (RUSTFLAGS, .cargo/config.toml, CARGO_ENCODED_RUSTFLAGS
/// are all overridden by the cargo-ndk environment). This hand-written
/// export provides the same JNI_OnLoad symbol that Tauri's validation
/// checks for in the .so.
#[cfg(target_os = "android")]
#[no_mangle]
unsafe extern "C" fn JNI_OnLoad(
    _env: *mut std::ffi::c_void,
    _klass: *mut std::ffi::c_void,
) -> i32 {
    6 // JNI_VERSION_1_6
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
            app.manage(Arc::new(commands::ai::AiRuntime::new()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_contexts,
            commands::default_kubeconfig_path,
            commands::import_kubeconfig,
            commands::restore_imports,
            commands::load_prefs,
            commands::save_prefs,
            commands::connect,
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
            commands::dependency_graph,
            commands::debug_ingress,
            commands::simulate_connectivity,
            commands::node_history,
            commands::pod_history,
            commands::watch_node_stats,
            commands::unwatch_node_stats,
            commands::unwatch_custom_kind,
            commands::start_log_stream,
            commands::export_logs,
            commands::stop_log_stream,
            commands::start_shell,
            commands::shell_input,
            commands::shell_resize,
            commands::stop_shell,
            commands::start_node_shell,
            commands::stop_node_shell,
            commands::start_port_forward,
            commands::start_service_port_forward,
            commands::stop_port_forward,
            commands::list_port_forwards,
            commands::helm_seed_repos,
            commands::helm_list_repos,
            commands::helm_add_repo,
            commands::helm_remove_repo,
            commands::helm_update_repo,
            commands::helm_update_all_repos,
            commands::helm_search_charts,
            commands::helm_chart_versions,
            commands::helm_export_chart,
            commands::helm_import_chart,
            commands::helm_local_charts,
            commands::helm_render_default_values,
            commands::helm_run_op,
            commands::helm_release_history,
            commands::helm_manifest_revision,
            commands::helm_values_revision,
            commands::pod_files_list,
            commands::pod_files_read,
            commands::pod_files_write,
            commands::pod_files_download,
            commands::pod_files_upload,
            commands::image_registry_list,
            commands::image_registry_upsert,
            commands::image_registry_remove,
            commands::image_registry_test,
            commands::image_registry_repos,
            commands::image_registry_tags,
            commands::apply_yaml_bundle,
            commands::dry_run_yaml_bundle,
            commands::import_image_to_node,
            commands::image_sync_status,
            commands::image_copy,
            commands::image_inspect_archive,
            commands::export_from_node,
            commands::list_node_images,
            commands::export_from_registry,
            commands::list_endpoints,
            commands::list_endpoints_for_service,
            commands::list_endpoint_addresses,
            commands::trigger_cronjob,
            commands::metrics_list,
            commands::metrics_upsert,
            commands::metrics_remove,
            commands::metrics_test,
            commands::metrics_query,
            commands::metrics_query_range,
            commands::grafana_list,
            commands::grafana_upsert,
            commands::grafana_remove,
            commands::grafana_test,
            commands::grafana_presets,
            commands::grafana_dashboard_url,
            commands::grafana_search_dashboards,
            commands::alertmanager_list,
            commands::alertmanager_upsert,
            commands::alertmanager_remove,
            commands::alertmanager_test,
            commands::alertmanager_alerts,
            commands::alertmanager_silences,
            commands::alertmanager_create_silence,
            commands::alertmanager_delete_silence,
            commands::prometheus_rules,
            commands::loki_list,
            commands::loki_upsert,
            commands::loki_remove,
            commands::loki_test,
            commands::audit_events,
            commands::saved_queries_list,
            commands::saved_queries_upsert,
            commands::saved_queries_remove,
            commands::saved_queries_clear_cache,
            commands::saved_queries_run,
            commands::image_registry_manifest,
            commands::sbom_generate_image,
            commands::sbom_generate_cluster,
            commands::sbom_list_history,
            commands::sbom_get,
            commands::sbom_export,
            commands::security_audit_run,
            commands::rbac_permission_matrix,
            commands::scanner_status,
            commands::ai_get_context,
            commands::ai_get_config,
            commands::ai_save_config,
            commands::ai_save_api_key,
            commands::ai_test_connection,
            commands::ai_chat,
            commands::ai_approve_tool_call,
            commands::ai_cancel,
            commands::ai_list_skills,
            commands::ai_memory_list,
            commands::ai_memory_search,
            commands::ai_memory_search_vault,
            commands::ai_memory_add,
            commands::ai_memory_delete,
            commands::ai_memory_clear,
            commands::ai_memory_add_runbook,
            commands::ai_memory_preferences,
            commands::ai_cron_list,
            commands::ai_cron_presets,
            commands::ai_cron_add,
            commands::ai_cron_update,
            commands::ai_cron_delete,
            commands::ai_cron_toggle,
            commands::ai_cron_history,
            commands::ai_discover_local_models,
            commands::ai_local_model_presets,
            commands::ai_check_local_model,
            commands::ai_fetch_url,
            commands::ai_web_search,
            commands::ai_session_list,
            commands::ai_session_create,
            commands::ai_session_delete,
            commands::ai_session_queue_size,
            commands::ai_evolution_strategies,
            commands::ai_evolution_record_run,
            commands::ai_evolution_delete_strategy,
            commands::ai_sandbox_presets,
            commands::ai_knowledge_sync,
            commands::ai_knowledge_import,
        ])
        .run(tauri::generate_context!())
        .expect("error while running k7s-android application");
}

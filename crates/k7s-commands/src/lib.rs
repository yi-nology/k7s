//! k7s-commands — the single source of the Tauri command surface.
//!
//! Every shell (desktop, iOS, Android) registers the same command set through
//! [`register_commands`]; platform differences are expressed with `cfg`
//! attributes so each target compiles exactly its historical feature set.

pub mod commands;
pub mod registry;

/// Expand to the full `tauri::generate_handler!` list for the current target.
///
/// Invoke inside a shell crate:
///
/// ```ignore
/// .invoke_handler(k7s_commands::register_commands!())
/// ```
#[macro_export]
macro_rules! register_commands {
    () => {
        tauri::generate_handler![
            $crate::commands::list_contexts,
            $crate::commands::default_kubeconfig_path,
            $crate::commands::import_kubeconfig,
            $crate::commands::restore_imports,
            $crate::commands::load_prefs,
            $crate::commands::save_prefs,
            $crate::commands::connect,
            $crate::commands::get_yaml,
            $crate::commands::apply_yaml,
            $crate::commands::dry_run_yaml,
            $crate::commands::delete_resource,
            $crate::commands::scale_resource,
            $crate::commands::set_cordon,
            $crate::commands::restart_pod,
            $crate::commands::diagnose_pod,
            $crate::commands::restart_rollout,
            $crate::commands::list_revisions,
            $crate::commands::undo_rollout,
            $crate::commands::drain_node,
            $crate::commands::get_events,
            $crate::commands::get_secret_data,
            $crate::commands::configmap_snapshots,
            $crate::commands::secret_snapshots,
            $crate::commands::configmap_snapshot_yaml,
            $crate::commands::get_properties,
            $crate::commands::watch_custom_kind,
            $crate::commands::dependency_graph,
            $crate::commands::debug_ingress,
            $crate::commands::simulate_connectivity,
            $crate::commands::node_history,
            $crate::commands::pod_history,
            $crate::commands::watch_node_stats,
            $crate::commands::unwatch_node_stats,
            $crate::commands::unwatch_custom_kind,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::custom_kind_counts,
            $crate::commands::start_log_stream,
            $crate::commands::export_logs,
            $crate::commands::stop_log_stream,
            $crate::commands::start_shell,
            $crate::commands::shell_input,
            $crate::commands::shell_resize,
            $crate::commands::stop_shell,
            $crate::commands::start_node_shell,
            $crate::commands::stop_node_shell,
            $crate::commands::start_port_forward,
            $crate::commands::start_service_port_forward,
            $crate::commands::stop_port_forward,
            $crate::commands::list_port_forwards,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_seed_repos,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_list_repos,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_add_repo,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_remove_repo,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_update_repo,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_update_all_repos,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_search_charts,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_chart_versions,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_export_chart,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_import_chart,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_local_charts,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_render_default_values,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_run_op,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_release_history,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_manifest_revision,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::helm_values_revision,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::pod_files_list,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::pod_files_read,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::pod_files_write,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::pod_files_download,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::pod_files_upload,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::image_registry_list,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::image_registry_upsert,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::image_registry_remove,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::image_registry_test,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::image_registry_repos,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::image_registry_tags,
            $crate::commands::apply_yaml_bundle,
            $crate::commands::dry_run_yaml_bundle,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::import_image_to_node,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::image_sync_status,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::image_copy,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::image_inspect_archive,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::export_from_node,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::list_node_images,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::export_from_registry,
            $crate::commands::list_endpoints,
            $crate::commands::list_endpoints_for_service,
            $crate::commands::list_endpoint_addresses,
            $crate::commands::trigger_cronjob,
            $crate::commands::metrics_list,
            $crate::commands::metrics_upsert,
            $crate::commands::metrics_remove,
            $crate::commands::metrics_test,
            $crate::commands::metrics_query,
            $crate::commands::metrics_query_range,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::grafana_list,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::grafana_upsert,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::grafana_remove,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::grafana_test,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::grafana_presets,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::grafana_dashboard_url,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::grafana_search_dashboards,
            $crate::commands::alertmanager_list,
            $crate::commands::alertmanager_upsert,
            $crate::commands::alertmanager_remove,
            $crate::commands::alertmanager_test,
            $crate::commands::alertmanager_alerts,
            $crate::commands::alertmanager_silences,
            $crate::commands::alertmanager_create_silence,
            $crate::commands::alertmanager_delete_silence,
            $crate::commands::prometheus_rules,
            $crate::commands::loki_list,
            $crate::commands::loki_upsert,
            $crate::commands::loki_remove,
            $crate::commands::loki_test,
            $crate::commands::audit_events,
            $crate::commands::saved_queries_list,
            $crate::commands::saved_queries_upsert,
            $crate::commands::saved_queries_remove,
            $crate::commands::saved_queries_clear_cache,
            $crate::commands::saved_queries_run,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::image_registry_manifest,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::sbom_generate_image,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::sbom_generate_cluster,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::sbom_list_history,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::sbom_get,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::sbom_export,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::security_audit_run,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::rbac_permission_matrix,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::scanner_status,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_get_context,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_get_config,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_save_config,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_save_api_key,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_test_connection,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_chat,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_approve_tool_call,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_cancel,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_list_skills,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_memory_list,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_memory_search,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_memory_search_vault,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_memory_add,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_memory_delete,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_memory_clear,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_memory_add_runbook,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_memory_preferences,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_cron_list,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_cron_presets,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_cron_add,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_cron_update,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_cron_delete,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_cron_toggle,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_cron_history,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_discover_local_models,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_local_model_presets,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_check_local_model,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_fetch_url,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_web_search,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_session_list,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_session_create,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_session_delete,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_session_queue_size,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_evolution_strategies,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_evolution_record_run,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_evolution_delete_strategy,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_sandbox_presets,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_knowledge_sync,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::ai_knowledge_import,
        ]
    };
}

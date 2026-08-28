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
#[cfg(feature = "ipc")]
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
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
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
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_seed_repos,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_list_repos,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_add_repo,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_remove_repo,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_update_repo,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_update_all_repos,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_search_charts,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_chart_versions,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_export_chart,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_render_default_values,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_render_preview,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_run_op,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_release_history,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_manifest_revision,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_values_revision,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_profile_list,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_profile_save,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::helm_profile_delete,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::local_charts_list,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::local_chart_detail,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::local_chart_file,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::local_chart_import_content,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::local_chart_lint,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::local_chart_remove,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::local_chart_verify,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::local_chart_package,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::local_chart_deps,
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
            #[cfg(not(target_os = "ios"))]
            $crate::commands::apply_yaml_bundle,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::dry_run_yaml_bundle,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::import_image_to_node,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::image_sync_status,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::image_copy,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::image_inspect_archive,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::export_from_node,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::list_node_images,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
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
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::sbom_generate_image,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::sbom_generate_cluster,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::sbom_list_history,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::sbom_get,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            $crate::commands::sbom_export,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::security_audit_run,
            #[cfg(not(target_os = "ios"))]
            $crate::commands::rbac_permission_matrix,
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
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

/// Every command in the `register_commands!` macro list — the complete
/// Tauri-IPC surface. Hand-maintained next to the macro; kept honest by
/// `tests/reconciliation.rs`, which cross-checks it against BOTH the macro
/// source and the `#[tauri::command]` functions, so adding a command
/// without updating this list (or vice versa) fails the build.
pub const COMMAND_NAMES: &[&str] = &[
    "ai_approve_tool_call",
    "ai_cancel",
    "ai_chat",
    "ai_check_local_model",
    "ai_cron_add",
    "ai_cron_delete",
    "ai_cron_history",
    "ai_cron_list",
    "ai_cron_presets",
    "ai_cron_toggle",
    "ai_cron_update",
    "ai_discover_local_models",
    "ai_evolution_delete_strategy",
    "ai_evolution_record_run",
    "ai_evolution_strategies",
    "ai_fetch_url",
    "ai_get_config",
    "ai_get_context",
    "ai_knowledge_import",
    "ai_knowledge_sync",
    "ai_list_skills",
    "ai_local_model_presets",
    "ai_memory_add",
    "ai_memory_add_runbook",
    "ai_memory_clear",
    "ai_memory_delete",
    "ai_memory_list",
    "ai_memory_preferences",
    "ai_memory_search",
    "ai_memory_search_vault",
    "ai_sandbox_presets",
    "ai_save_api_key",
    "ai_save_config",
    "ai_session_create",
    "ai_session_delete",
    "ai_session_list",
    "ai_session_queue_size",
    "ai_test_connection",
    "ai_web_search",
    "alertmanager_alerts",
    "alertmanager_create_silence",
    "alertmanager_delete_silence",
    "alertmanager_list",
    "alertmanager_remove",
    "alertmanager_silences",
    "alertmanager_test",
    "alertmanager_upsert",
    "apply_yaml",
    "apply_yaml_bundle",
    "audit_events",
    "configmap_snapshot_yaml",
    "configmap_snapshots",
    "connect",
    "custom_kind_counts",
    "debug_ingress",
    "default_kubeconfig_path",
    "delete_resource",
    "dependency_graph",
    "diagnose_pod",
    "drain_node",
    "dry_run_yaml",
    "dry_run_yaml_bundle",
    "export_from_node",
    "export_from_registry",
    "export_logs",
    "get_events",
    "get_properties",
    "get_secret_data",
    "get_yaml",
    "grafana_dashboard_url",
    "grafana_list",
    "grafana_presets",
    "grafana_remove",
    "grafana_search_dashboards",
    "grafana_test",
    "grafana_upsert",
    "helm_add_repo",
    "helm_chart_versions",
    "helm_export_chart",
    "helm_list_repos",
    "helm_manifest_revision",
    "helm_profile_delete",
    "helm_profile_list",
    "helm_profile_save",
    "helm_release_history",
    "helm_remove_repo",
    "helm_render_default_values",
    "helm_render_preview",
    "helm_run_op",
    "helm_search_charts",
    "helm_seed_repos",
    "helm_update_all_repos",
    "helm_update_repo",
    "helm_values_revision",
    "image_copy",
    "image_inspect_archive",
    "image_registry_list",
    "image_registry_manifest",
    "image_registry_remove",
    "image_registry_repos",
    "image_registry_tags",
    "image_registry_test",
    "image_registry_upsert",
    "image_sync_status",
    "import_image_to_node",
    "import_kubeconfig",
    "list_contexts",
    "list_endpoint_addresses",
    "list_endpoints",
    "list_endpoints_for_service",
    "list_node_images",
    "list_port_forwards",
    "list_revisions",
    "load_prefs",
    "local_chart_deps",
    "local_chart_detail",
    "local_chart_file",
    "local_chart_import_content",
    "local_chart_lint",
    "local_chart_package",
    "local_chart_remove",
    "local_chart_verify",
    "local_charts_list",
    "loki_list",
    "loki_remove",
    "loki_test",
    "loki_upsert",
    "metrics_list",
    "metrics_query",
    "metrics_query_range",
    "metrics_remove",
    "metrics_test",
    "metrics_upsert",
    "node_history",
    "pod_files_download",
    "pod_files_list",
    "pod_files_read",
    "pod_files_upload",
    "pod_files_write",
    "pod_history",
    "prometheus_rules",
    "rbac_permission_matrix",
    "restart_pod",
    "restart_rollout",
    "restore_imports",
    "save_prefs",
    "saved_queries_clear_cache",
    "saved_queries_list",
    "saved_queries_remove",
    "saved_queries_run",
    "saved_queries_upsert",
    "sbom_export",
    "sbom_generate_cluster",
    "sbom_generate_image",
    "sbom_get",
    "sbom_list_history",
    "scale_resource",
    "scanner_status",
    "secret_snapshots",
    "security_audit_run",
    "set_cordon",
    "shell_input",
    "shell_resize",
    "simulate_connectivity",
    "start_log_stream",
    "start_node_shell",
    "start_port_forward",
    "start_service_port_forward",
    "start_shell",
    "stop_log_stream",
    "stop_node_shell",
    "stop_port_forward",
    "stop_shell",
    "trigger_cronjob",
    "undo_rollout",
    "unwatch_custom_kind",
    "unwatch_node_stats",
    "watch_custom_kind",
    "watch_node_stats",
];

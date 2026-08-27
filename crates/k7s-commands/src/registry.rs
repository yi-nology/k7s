//! The command registry — the single source the web shell's
//! `POST /api/invoke/{cmd}` route dispatches through.
//!
//! Every non-AI command is registered here next to its `#[tauri::command]`
//! wrapper in `commands/`. The INTERACTIVE AI surface (ai_chat, ai_cancel,
//! ai_approve_tool_call, ai_poll_events) keeps its bespoke web handlers —
//! ReadOnly enforcement, SSE streaming and the approval flow need the
//! WebState, not just the CoreState — while the non-interactive ai_*
//! helpers (presets, discovery, sessions, cron CRUD, memory runbooks,
//! knowledge sync, fetch/search) go through the registry like everything
//! else, so they are reachable from both transports.
//!
//! `tests/reconciliation.rs` locks the invariant: every command in the
//! `register_commands!` macro list is invocable on the web — either through
//! this registry or through a dedicated route in k7s-server.

use crate::commands;
use k7s_core::core::commands::CommandRegistry;

/// Wire shape for commands that take no arguments.
#[derive(serde::Deserialize)]
struct NoArgs {}

/// Build the full registry. Cheap to call once per process.
pub fn build_registry() -> CommandRegistry {
    let mut r = CommandRegistry::default();

    r.register("default_kubeconfig_path", |_mgr, _a: NoArgs| async move {
        commands::core::default_kubeconfig_path_impl().await
    });
    r.register("list_contexts", |mgr, _a: NoArgs| async move {
        commands::core::list_contexts_impl(mgr).await
    });
    r.register(
        "restore_imports",
        |mgr, a: commands::core::RestoreImportsArgs| async move {
            commands::core::restore_imports_impl(mgr, a.paths).await
        },
    );
    r.register(
        "import_kubeconfig",
        |mgr, a: commands::core::ImportKubeconfigArgs| async move {
            commands::core::import_kubeconfig_impl(mgr, a.path).await
        },
    );
    r.register(
        "connect",
        |mgr, a: commands::core::ConnectArgs| async move {
            commands::core::connect_impl(mgr, a.context).await
        },
    );
    r.register(
        "get_yaml",
        |mgr, a: commands::core::GetYamlArgs| async move {
            commands::core::get_yaml_impl(mgr, a.kind, a.namespace, a.name).await
        },
    );
    r.register(
        "apply_yaml",
        |mgr, a: commands::core::ApplyYamlArgs| async move {
            commands::core::apply_yaml_impl(mgr, a.kind, a.namespace, a.name, a.yaml).await
        },
    );
    r.register(
        "dry_run_yaml",
        |mgr, a: commands::core::DryRunYamlArgs| async move {
            commands::core::dry_run_yaml_impl(mgr, a.kind, a.namespace, a.name, a.yaml).await
        },
    );
    r.register(
        "delete_resource",
        |mgr, a: commands::core::DeleteResourceArgs| async move {
            commands::core::delete_resource_impl(mgr, a.kind, a.namespace, a.name).await
        },
    );
    r.register(
        "scale_resource",
        |mgr, a: commands::core::ScaleResourceArgs| async move {
            commands::core::scale_resource_impl(mgr, a.kind, a.namespace, a.name, a.replicas).await
        },
    );
    r.register(
        "set_cordon",
        |mgr, a: commands::core::SetCordonArgs| async move {
            commands::core::set_cordon_impl(mgr, a.name, a.unschedulable).await
        },
    );
    r.register(
        "restart_pod",
        |mgr, a: commands::core::RestartPodArgs| async move {
            commands::core::restart_pod_impl(mgr, a.namespace, a.name).await
        },
    );
    r.register(
        "restart_rollout",
        |mgr, a: commands::core::RestartRolloutArgs| async move {
            commands::core::restart_rollout_impl(mgr, a.kind, a.namespace, a.name).await
        },
    );
    r.register(
        "list_revisions",
        |mgr, a: commands::core::ListRevisionsArgs| async move {
            commands::core::list_revisions_impl(mgr, a.kind, a.namespace, a.name).await
        },
    );
    r.register(
        "undo_rollout",
        |mgr, a: commands::core::UndoRolloutArgs| async move {
            commands::core::undo_rollout_impl(mgr, a.kind, a.namespace, a.name, a.to_revision).await
        },
    );
    r.register(
        "watch_custom_kind",
        |mgr, a: commands::core::WatchCustomKindArgs| async move {
            commands::core::watch_custom_kind_impl(mgr, a.kind).await
        },
    );
    r.register(
        "unwatch_custom_kind",
        |mgr, a: commands::core::UnwatchCustomKindArgs| async move {
            commands::core::unwatch_custom_kind_impl(mgr, a.kind).await
        },
    );
    #[cfg(not(target_os = "android"))]
    r.register("custom_kind_counts", |mgr, _a: NoArgs| async move {
        commands::core::custom_kind_counts_impl(mgr).await
    });
    r.register(
        "drain_node",
        |mgr, a: commands::core::DrainNodeArgs| async move {
            commands::core::drain_node_impl(mgr, a.name).await
        },
    );
    r.register(
        "node_history",
        |mgr, a: commands::core::NodeHistoryArgs| async move {
            commands::core::node_history_impl(mgr, a.node).await
        },
    );
    r.register(
        "pod_history",
        |mgr, a: commands::core::PodHistoryArgs| async move {
            commands::core::pod_history_impl(mgr, a.namespace, a.pod).await
        },
    );
    r.register(
        "watch_node_stats",
        |mgr, a: commands::core::WatchNodeStatsArgs| async move {
            commands::core::watch_node_stats_impl(mgr, a.node).await
        },
    );
    r.register(
        "unwatch_node_stats",
        |mgr, a: commands::core::UnwatchNodeStatsArgs| async move {
            commands::core::unwatch_node_stats_impl(mgr, a.node).await
        },
    );
    r.register(
        "diagnose_pod",
        |mgr, a: commands::core::DiagnosePodArgs| async move {
            commands::core::diagnose_pod_impl(mgr, a.namespace, a.pod).await
        },
    );
    r.register(
        "get_secret_data",
        |mgr, a: commands::core::GetSecretDataArgs| async move {
            commands::core::get_secret_data_impl(mgr, a.namespace, a.name).await
        },
    );
    r.register(
        "configmap_snapshots",
        |mgr, a: commands::core::ConfigmapSnapshotsArgs| async move {
            commands::core::configmap_snapshots_impl(mgr, a.namespace, a.name).await
        },
    );
    r.register(
        "secret_snapshots",
        |mgr, a: commands::core::SecretSnapshotsArgs| async move {
            commands::core::secret_snapshots_impl(mgr, a.namespace, a.name).await
        },
    );
    r.register(
        "configmap_snapshot_yaml",
        |mgr, a: commands::core::ConfigmapSnapshotYamlArgs| async move {
            commands::core::configmap_snapshot_yaml_impl(
                mgr,
                a.kind,
                a.namespace,
                a.name,
                a.resource_version,
            )
            .await
        },
    );
    r.register("dependency_graph", |mgr, _a: NoArgs| async move {
        commands::core::dependency_graph_impl(mgr).await
    });
    r.register(
        "debug_ingress",
        |mgr, a: commands::core::DebugIngressArgs| async move {
            commands::core::debug_ingress_impl(mgr, a.namespace, a.name).await
        },
    );
    r.register(
        "get_properties",
        |mgr, a: commands::core::GetPropertiesArgs| async move {
            commands::core::get_properties_impl(mgr, a.kind, a.namespace, a.name).await
        },
    );
    r.register(
        "get_events",
        |mgr, a: commands::core::GetEventsArgs| async move {
            commands::core::get_events_impl(mgr, a.namespace, a.name).await
        },
    );
    r.register(
        "export_logs",
        |mgr, a: commands::core::ExportLogsArgs| async move {
            commands::core::export_logs_impl(
                mgr,
                a.namespace,
                a.pod,
                a.container,
                a.since_seconds,
                a.previous,
                a.path,
            )
            .await
        },
    );
    r.register(
        "stop_log_stream",
        |mgr, a: commands::core::StopLogStreamArgs| async move {
            commands::core::stop_log_stream_impl(mgr, a.stream_id).await
        },
    );
    r.register(
        "pod_files_list",
        |mgr, a: commands::storage::PodFilesListArgs| async move {
            commands::storage::pod_files_list_impl(mgr, a.namespace, a.pod, a.container, a.path)
                .await
        },
    );
    r.register(
        "pod_files_read",
        |mgr, a: commands::storage::PodFilesReadArgs| async move {
            commands::storage::pod_files_read_impl(mgr, a.namespace, a.pod, a.container, a.path)
                .await
        },
    );
    r.register(
        "pod_files_write",
        |mgr, a: commands::storage::PodFilesWriteArgs| async move {
            commands::storage::pod_files_write_impl(
                mgr,
                a.namespace,
                a.pod,
                a.container,
                a.path,
                a.content,
            )
            .await
        },
    );
    r.register(
        "pod_files_download",
        |mgr, a: commands::storage::PodFilesDownloadArgs| async move {
            commands::storage::pod_files_download_impl(mgr, a.namespace, a.pod, a.container, a.path)
                .await
        },
    );
    r.register(
        "pod_files_upload",
        |mgr, a: commands::storage::PodFilesUploadArgs| async move {
            commands::storage::pod_files_upload_impl(
                mgr,
                a.namespace,
                a.pod,
                a.container,
                a.dest_dir,
                a.tar_b64,
            )
            .await
        },
    );
    r.register(
        "image_registry_test",
        |_mgr, a: commands::storage::ImageRegistryTestArgs| async move {
            commands::storage::image_registry_test_impl(a.name).await
        },
    );
    r.register(
        "image_registry_repos",
        |_mgr, a: commands::storage::ImageRegistryReposArgs| async move {
            commands::storage::image_registry_repos_impl(a.name).await
        },
    );
    r.register(
        "image_registry_tags",
        |_mgr, a: commands::storage::ImageRegistryTagsArgs| async move {
            commands::storage::image_registry_tags_impl(a.name, a.repo).await
        },
    );
    r.register(
        "apply_yaml_bundle",
        |mgr, a: commands::storage::ApplyYamlBundleArgs| async move {
            commands::storage::apply_yaml_bundle_impl(mgr, a.yaml).await
        },
    );
    r.register(
        "dry_run_yaml_bundle",
        |mgr, a: commands::storage::DryRunYamlBundleArgs| async move {
            commands::storage::dry_run_yaml_bundle_impl(mgr, a.yaml).await
        },
    );
    // Image import/export/sync — the underlying k7s-core image modules are
    // desktop/iOS only (skopeo, docker-archive tooling is absent on Android).
    #[cfg(not(target_os = "android"))]
    r.register(
        "import_image_to_node",
        |mgr, a: commands::storage::ImportImageToNodeArgs| async move {
            commands::storage::import_image_to_node_impl(mgr, a.node, a.path).await
        },
    );
    #[cfg(not(target_os = "android"))]
    r.register("image_sync_status", |_mgr, _a: NoArgs| async move {
        commands::storage::image_sync_status_impl().await
    });
    #[cfg(not(target_os = "android"))]
    r.register(
        "image_inspect_archive",
        |_mgr, a: commands::storage::ImageInspectArchiveArgs| async move {
            commands::storage::image_inspect_archive_impl(a.tar_path).await
        },
    );
    #[cfg(not(target_os = "android"))]
    r.register(
        "export_from_node",
        |mgr, a: commands::storage::ExportFromNodeArgs| async move {
            commands::storage::export_from_node_impl(mgr, a.node, a.image_ref, a.save_path).await
        },
    );
    #[cfg(not(target_os = "android"))]
    r.register(
        "list_node_images",
        |mgr, a: commands::storage::ListNodeImagesArgs| async move {
            commands::storage::list_node_images_impl(mgr, a.node).await
        },
    );
    #[cfg(not(target_os = "android"))]
    r.register(
        "export_from_registry",
        |mgr, a: commands::storage::ExportFromRegistryArgs| async move {
            commands::storage::export_from_registry_impl(
                mgr,
                a.registry_name,
                a.repo,
                a.tag,
                a.save_path,
                a.insecure_src,
            )
            .await
        },
    );
    r.register(
        "image_registry_manifest",
        |_mgr, a: commands::storage::ImageRegistryManifestArgs| async move {
            commands::storage::image_registry_manifest_impl(a.name, a.repo, a.tag).await
        },
    );
    // Helm marketplace — module is desktop + android only (see commands/mod.rs).
    #[cfg(not(target_os = "ios"))]
    r.register(
        "helm_update_repo",
        |_mgr, a: commands::helm::HelmUpdateRepoArgs| async move {
            commands::helm::helm_update_repo_impl(a.name).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register("helm_update_all_repos", |_mgr, _a: NoArgs| async move {
        commands::helm::helm_update_all_repos_impl().await
    });
    #[cfg(not(target_os = "ios"))]
    r.register(
        "helm_export_chart",
        |_mgr, a: commands::helm::HelmExportChartArgs| async move {
            commands::helm::helm_export_chart_impl(a.repo, a.chart, a.version, a.output_dir).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "helm_render_default_values",
        |_mgr, a: commands::helm::HelmRenderDefaultValuesArgs| async move {
            commands::helm::helm_render_default_values_impl(a.chart, a.version, a.kubeconfig).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "helm_run_op",
        |mgr, a: commands::helm::HelmRunOpArgs| async move {
            commands::helm::helm_run_op_impl(mgr, a.op).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "helm_release_history",
        |_mgr, a: commands::helm::HelmReleaseHistoryArgs| async move {
            commands::helm::helm_release_history_impl(a.release, a.namespace, a.kubeconfig).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "helm_manifest_revision",
        |mgr, a: commands::helm::HelmManifestRevisionArgs| async move {
            commands::helm::helm_manifest_revision_impl(mgr, a.namespace, a.name, a.revision).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "helm_values_revision",
        |mgr, a: commands::helm::HelmValuesRevisionArgs| async move {
            commands::helm::helm_values_revision_impl(mgr, a.namespace, a.name, a.revision).await
        },
    );
    r.register(
        "start_shell",
        |mgr, a: commands::shell::StartShellArgs| async move {
            commands::shell::start_shell_impl(mgr, a.namespace, a.pod, a.container).await
        },
    );
    r.register(
        "start_node_shell",
        |mgr, a: commands::shell::StartNodeShellArgs| async move {
            commands::shell::start_node_shell_impl(mgr, a.node).await
        },
    );
    r.register(
        "stop_node_shell",
        |mgr, a: commands::shell::StopNodeShellArgs| async move {
            commands::shell::stop_node_shell_impl(mgr, a.stream_id, a.pod).await
        },
    );
    r.register(
        "shell_input",
        |mgr, a: commands::shell::ShellInputArgs| async move {
            commands::shell::shell_input_impl(mgr, a.stream_id, a.data).await
        },
    );
    r.register(
        "shell_resize",
        |mgr, a: commands::shell::ShellResizeArgs| async move {
            commands::shell::shell_resize_impl(mgr, a.stream_id, a.cols, a.rows).await
        },
    );
    r.register(
        "stop_shell",
        |mgr, a: commands::shell::StopShellArgs| async move {
            commands::shell::stop_shell_impl(mgr, a.stream_id).await
        },
    );
    r.register(
        "start_port_forward",
        |mgr, a: commands::forward::StartPortForwardArgs| async move {
            commands::forward::start_port_forward_impl(mgr, a.namespace, a.pod, a.remote_port).await
        },
    );
    r.register(
        "start_service_port_forward",
        |mgr, a: commands::forward::StartServicePortForwardArgs| async move {
            commands::forward::start_service_port_forward_impl(
                mgr,
                a.namespace,
                a.service,
                a.remote_port,
            )
            .await
        },
    );
    r.register(
        "stop_port_forward",
        |mgr, a: commands::forward::StopPortForwardArgs| async move {
            commands::forward::stop_port_forward_impl(mgr, a.id).await
        },
    );
    r.register("list_port_forwards", |mgr, _a: NoArgs| async move {
        commands::forward::list_port_forwards_impl(mgr).await
    });
    r.register("list_endpoints", |mgr, _a: NoArgs| async move {
        commands::observability::list_endpoints_impl(mgr).await
    });
    r.register(
        "list_endpoints_for_service",
        |mgr, a: commands::observability::ListEndpointsForServiceArgs| async move {
            commands::observability::list_endpoints_for_service_impl(mgr, a.namespace, a.name).await
        },
    );
    r.register(
        "list_endpoint_addresses",
        |mgr, a: commands::observability::ListEndpointAddressesArgs| async move {
            commands::observability::list_endpoint_addresses_impl(mgr, a.namespace, a.name).await
        },
    );
    r.register(
        "trigger_cronjob",
        |mgr, a: commands::observability::TriggerCronjobArgs| async move {
            commands::observability::trigger_cronjob_impl(mgr, a.namespace, a.name).await
        },
    );
    r.register(
        "metrics_test",
        |_mgr, a: commands::observability::MetricsTestArgs| async move {
            commands::observability::metrics_test_impl(a.name).await
        },
    );
    r.register(
        "metrics_query",
        |_mgr, a: commands::observability::MetricsQueryArgs| async move {
            commands::observability::metrics_query_impl(a.name, a.promql).await
        },
    );
    r.register(
        "metrics_query_range",
        |_mgr, a: commands::observability::MetricsQueryRangeArgs| async move {
            commands::observability::metrics_query_range_impl(
                a.name,
                a.promql,
                a.start_ms,
                a.end_ms,
                a.step_seconds,
            )
            .await
        },
    );
    // Grafana — module is excluded from iPadOS build (see commands/mod.rs).
    #[cfg(not(target_os = "ios"))]
    r.register("grafana_list", |_mgr, _a: NoArgs| async move {
        commands::observability::grafana_list()
    });
    #[cfg(not(target_os = "ios"))]
    r.register(
        "grafana_upsert",
        |_mgr, a: commands::observability::GrafanaUpsertArgs| async move {
            commands::observability::grafana_upsert(
                a.name,
                a.url,
                a.username,
                a.password,
                a.api_token,
                a.default_datasource,
                a.description,
            )
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "grafana_remove",
        |_mgr, a: commands::observability::GrafanaRemoveArgs| async move {
            commands::observability::grafana_remove(a.name)
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "grafana_test",
        |_mgr, a: commands::observability::GrafanaTestArgs| async move {
            commands::observability::grafana_test_impl(a.name).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register("grafana_presets", |_mgr, _a: NoArgs| async move {
        Ok(commands::observability::grafana_presets())
    });
    #[cfg(not(target_os = "ios"))]
    r.register(
        "grafana_dashboard_url",
        |_mgr, a: commands::observability::GrafanaDashboardUrlArgs| async move {
            commands::observability::grafana_dashboard_url(a.name, a.uid, a.from_ms, a.to_ms)
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "grafana_search_dashboards",
        |_mgr, a: commands::observability::GrafanaSearchDashboardsArgs| async move {
            commands::observability::grafana_search_dashboards_impl(a.name, a.query).await
        },
    );
    r.register(
        "alertmanager_test",
        |_mgr, a: commands::observability::AlertmanagerTestArgs| async move {
            commands::observability::alertmanager_test_impl(a.name).await
        },
    );
    r.register(
        "alertmanager_alerts",
        |_mgr, a: commands::observability::AlertmanagerAlertsArgs| async move {
            commands::observability::alertmanager_alerts_impl(a.name).await
        },
    );
    r.register(
        "alertmanager_silences",
        |_mgr, a: commands::observability::AlertmanagerSilencesArgs| async move {
            commands::observability::alertmanager_silences_impl(a.name).await
        },
    );
    r.register(
        "alertmanager_create_silence",
        |_mgr, a: commands::observability::AlertmanagerCreateSilenceArgs| async move {
            commands::observability::alertmanager_create_silence_impl(a.instance, a.request).await
        },
    );
    r.register(
        "alertmanager_delete_silence",
        |_mgr, a: commands::observability::AlertmanagerDeleteSilenceArgs| async move {
            commands::observability::alertmanager_delete_silence_impl(a.instance, a.silence_id)
                .await
        },
    );
    r.register(
        "prometheus_rules",
        |_mgr, a: commands::observability::PrometheusRulesArgs| async move {
            commands::observability::prometheus_rules_impl(a.instance).await
        },
    );
    r.register(
        "loki_test",
        |_mgr, a: commands::observability::LokiTestArgs| async move {
            commands::observability::loki_test_impl(a.name).await
        },
    );
    r.register(
        "audit_events",
        |_mgr, a: commands::observability::AuditEventsArgs| async move {
            commands::observability::audit_events_impl(a.query).await
        },
    );
    r.register(
        "saved_queries_run",
        |_mgr, a: commands::observability::SavedQueriesRunArgs| async move {
            commands::observability::saved_queries_run_impl(a.query, a.instance, a.force_refresh)
                .await
        },
    );
    // SBOM / scanner — desktop only (external CLI tools; module cfg mirrors
    // commands/mod.rs).
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    r.register(
        "sbom_generate_image",
        |mgr, a: commands::sbom::SbomGenerateImageArgs| async move {
            commands::sbom::sbom_generate_image_impl(mgr, a.image_ref, a.format).await
        },
    );
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    r.register(
        "sbom_generate_cluster",
        |mgr, a: commands::sbom::SbomGenerateClusterArgs| async move {
            commands::sbom::sbom_generate_cluster_impl(mgr, a.format).await
        },
    );
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    r.register("sbom_list_history", |mgr, _a: NoArgs| async move {
        commands::sbom::sbom_list_history_impl(mgr).await
    });
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    r.register(
        "sbom_get",
        |mgr, a: commands::sbom::SbomGetArgs| async move {
            commands::sbom::sbom_get_impl(mgr, a.id).await
        },
    );
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    r.register(
        "sbom_export",
        |mgr, a: commands::sbom::SbomExportArgs| async move {
            commands::sbom::sbom_export_impl(mgr, a.id, a.output_path).await
        },
    );
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    r.register("scanner_status", |mgr, _a: NoArgs| async move {
        commands::scanner::scanner_status_impl(mgr).await
    });
    // Security audit — module is desktop + android only.
    #[cfg(not(target_os = "ios"))]
    r.register("security_audit_run", |mgr, _a: NoArgs| async move {
        commands::security::security_audit_run_impl(mgr).await
    });
    #[cfg(not(target_os = "ios"))]
    r.register("rbac_permission_matrix", |mgr, _a: NoArgs| async move {
        commands::security::rbac_permission_matrix_impl(mgr).await
    });
    r.register("alertmanager_list", |_mgr, _a: NoArgs| async move {
        commands::observability::alertmanager_list()
    });
    r.register(
        "alertmanager_remove",
        |_mgr, a: commands::observability::AlertmanagerRemoveArgs| async move {
            commands::observability::alertmanager_remove(a.name)
        },
    );
    r.register(
        "alertmanager_upsert",
        |_mgr, a: commands::observability::AlertmanagerUpsertArgs| async move {
            commands::observability::alertmanager_upsert(
                a.name,
                a.url,
                a.bearer_token,
                a.description,
            )
        },
    );
    // Helm marketplace — module is desktop + android only (see commands/mod.rs).
    #[cfg(not(target_os = "ios"))]
    r.register(
        "helm_add_repo",
        |_mgr, a: commands::helm::HelmAddRepoArgs| async move {
            commands::helm::helm_add_repo(a.name, a.url, a.description)
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "helm_chart_versions",
        |_mgr, a: commands::helm::HelmChartVersionsArgs| async move {
            commands::helm::helm_chart_versions(a.repo, a.chart)
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "helm_import_chart",
        |_mgr, a: commands::helm::HelmImportChartArgs| async move {
            commands::helm::helm_import_chart(a.file_path, a.repo_name)
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register("helm_list_repos", |_mgr, _a: NoArgs| async move {
        commands::helm::helm_list_repos()
    });
    #[cfg(not(target_os = "ios"))]
    r.register(
        "helm_local_charts",
        |_mgr, a: commands::helm::HelmLocalChartsArgs| async move {
            commands::helm::helm_local_charts(a.repo_name)
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "helm_remove_repo",
        |_mgr, a: commands::helm::HelmRemoveRepoArgs| async move {
            commands::helm::helm_remove_repo(a.name)
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "helm_search_charts",
        |_mgr, a: commands::helm::HelmSearchChartsArgs| async move {
            commands::helm::helm_search_charts(a.query)
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register("helm_seed_repos", |_mgr, _a: NoArgs| async move {
        commands::helm::helm_seed_repos()
    });
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    r.register(
        "image_copy",
        |mgr, a: commands::storage::ImageCopyArgs| async move {
            commands::storage::image_copy_impl(
                mgr,
                a.source,
                a.dest_registry,
                a.dest_repo,
                a.dest_tag,
                a.src_creds,
                a.insecure_src,
                a.insecure_dest,
            )
            .await
        },
    );
    r.register("image_registry_list", |_mgr, _a: NoArgs| async move {
        commands::storage::image_registry_list()
    });
    r.register(
        "image_registry_remove",
        |_mgr, a: commands::storage::ImageRegistryRemoveArgs| async move {
            commands::storage::image_registry_remove(a.name)
        },
    );
    r.register(
        "image_registry_upsert",
        |_mgr, a: commands::storage::ImageRegistryUpsertArgs| async move {
            commands::storage::image_registry_upsert(
                a.name,
                a.url,
                a.username,
                a.password,
                a.insecure,
                a.description,
            )
        },
    );
    r.register("loki_list", |_mgr, _a: NoArgs| async move {
        commands::observability::loki_list()
    });
    r.register(
        "loki_remove",
        |_mgr, a: commands::observability::LokiRemoveArgs| async move {
            commands::observability::loki_remove(a.name)
        },
    );
    r.register(
        "loki_upsert",
        |_mgr, a: commands::observability::LokiUpsertArgs| async move {
            commands::observability::loki_upsert(
                a.name,
                a.url,
                a.username,
                a.password,
                a.description,
            )
        },
    );
    r.register("metrics_list", |_mgr, _a: NoArgs| async move {
        commands::observability::metrics_list()
    });
    r.register(
        "metrics_remove",
        |_mgr, a: commands::observability::MetricsRemoveArgs| async move {
            commands::observability::metrics_remove(a.name)
        },
    );
    r.register(
        "metrics_upsert",
        |_mgr, a: commands::observability::MetricsUpsertArgs| async move {
            commands::observability::metrics_upsert(
                a.name,
                a.url,
                a.username,
                a.password,
                a.description,
            )
        },
    );
    r.register("saved_queries_clear_cache", |_mgr, _a: NoArgs| async move {
        {
            commands::observability::saved_queries_clear_cache();
            Ok(())
        }
    });
    r.register("saved_queries_list", |_mgr, _a: NoArgs| async move {
        commands::observability::saved_queries_list()
    });
    r.register(
        "saved_queries_remove",
        |_mgr, a: commands::observability::SavedQueriesRemoveArgs| async move {
            commands::observability::saved_queries_remove(a.name)
        },
    );
    r.register(
        "saved_queries_upsert",
        |_mgr, a: commands::observability::SavedQueriesUpsertArgs| async move {
            commands::observability::saved_queries_upsert(a.query)
        },
    );
    r.register(
        "simulate_connectivity",
        |mgr, a: commands::core::SimulateConnectivityArgs| async move {
            commands::core::simulate_connectivity_impl(
                mgr,
                a.src_namespace,
                a.src_pod,
                a.dst_namespace,
                a.dst_pod,
                a.port,
                a.protocol,
            )
            .await
        },
    );
    r.register(
        "start_log_stream",
        |mgr, a: commands::core::StartLogStreamArgs| async move {
            commands::core::start_log_stream_impl(
                mgr,
                a.namespace,
                a.pod,
                a.container,
                a.tail,
                a.since_time,
                a.since_seconds,
                a.previous,
            )
            .await
        },
    );

    // ------------------------------------------------------------------
    // Non-interactive AI helpers. Registered like any other command so the
    // web shell reaches them via /api/invoke/{cmd}; the interactive AI
    // surface (chat/approve/cancel/poll) stays on dedicated handlers.
    // iOS excludes the whole ai/cron/memory modules (see commands/mod.rs).
    // ------------------------------------------------------------------
    #[cfg(not(target_os = "ios"))]
    r.register("ai_sandbox_presets", |_mgr, _a: NoArgs| async move {
        Ok(commands::ai_deep::ai_sandbox_presets_impl().await)
    });
    #[cfg(not(target_os = "ios"))]
    r.register("ai_local_model_presets", |_mgr, _a: NoArgs| async move {
        Ok(commands::ai_extra::ai_local_model_presets_impl().await)
    });
    #[cfg(not(target_os = "ios"))]
    r.register(
        "ai_discover_local_models",
        |_mgr, a: commands::ai_extra::AiDiscoverLocalModelsArgs| async move {
            commands::ai_extra::ai_discover_local_models_impl(a.base_url).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "ai_check_local_model",
        |_mgr, a: commands::ai_extra::AiCheckLocalModelArgs| async move {
            commands::ai_extra::ai_check_local_model_impl(a.base_url, a.model).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "ai_fetch_url",
        |_mgr, a: commands::ai_extra::AiFetchUrlArgs| async move {
            commands::ai_extra::ai_fetch_url_impl(a.url, a.max_chars).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "ai_web_search",
        |_mgr, a: commands::ai_extra::AiWebSearchArgs| async move {
            commands::ai_extra::ai_web_search_impl(a.query).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register("ai_session_list", |mgr, _a: NoArgs| async move {
        commands::ai_extra::ai_session_list_impl(mgr).await
    });
    #[cfg(not(target_os = "ios"))]
    r.register(
        "ai_session_create",
        |mgr, a: commands::ai_extra::AiSessionCreateArgs| async move {
            commands::ai_extra::ai_session_create_impl(mgr, a.name, a.kube_context).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "ai_session_delete",
        |mgr, a: commands::ai_extra::AiSessionDeleteArgs| async move {
            commands::ai_extra::ai_session_delete_impl(mgr, a.id).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register("ai_session_queue_size", |mgr, _a: NoArgs| async move {
        commands::ai_extra::ai_session_queue_size_impl(mgr).await
    });
    #[cfg(not(target_os = "ios"))]
    r.register(
        "ai_memory_add_runbook",
        |mgr, a: commands::memory::AiMemoryAddRunbookArgs| async move {
            commands::memory::ai_memory_add_runbook_impl(
                mgr,
                a.kube_context,
                a.title,
                a.content,
                a.tags,
            )
            .await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register("ai_knowledge_sync", |mgr, _a: NoArgs| async move {
        commands::ai_deep::ai_knowledge_sync_impl(mgr).await
    });
    #[cfg(not(target_os = "ios"))]
    r.register(
        "ai_knowledge_import",
        |mgr, a: commands::ai_deep::AiKnowledgeImportArgs| async move {
            commands::ai_deep::ai_knowledge_import_impl(mgr, a.source_dir).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "ai_cron_update",
        |mgr, a: commands::cron::AiCronUpdateArgs| async move {
            commands::cron::ai_cron_update_impl(mgr, a.task).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "ai_cron_history",
        |mgr, a: commands::cron::AiCronHistoryArgs| async move {
            commands::cron::ai_cron_history_impl(mgr, a.task_id).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "ai_evolution_record_run",
        |mgr, a: commands::ai_deep::AiEvolutionRecordRunArgs| async move {
            commands::ai_deep::ai_evolution_record_run_impl(mgr, a.outcome).await
        },
    );
    #[cfg(not(target_os = "ios"))]
    r.register(
        "ai_evolution_delete_strategy",
        |mgr, a: commands::ai_deep::AiEvolutionDeleteStrategyArgs| async move {
            commands::ai_deep::ai_evolution_delete_strategy_impl(mgr, a.id).await
        },
    );

    r
}

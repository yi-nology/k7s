//! Core Tauri commands: prefs, contexts, connect, YAML CRUD, scale, cordon,
//! restart, rollout, custom kinds, drain, node stats, events, secrets,
//! properties, and log streams.

use k7s_core::core::prefs::{self, Prefs};
use k7s_core::core::shell_common;
use k7s_core::core::CoreState;
use k7s_core::error::{AppError, AppResult};
use k7s_core::kube::client::{self, ClusterInfo, ContextInfo};
use k7s_core::kube::manager::{ClientManager, ImportedContext};
use k7s_core::kube::{
    config_snapshots, drain, exporter, ingress_debug, logs, mappers, metrics, nodestats, promql,
    properties, rollout, watchers,
};
use k7s_deps::k8s_openapi::api::core::v1::{Event, Secret};
use k7s_deps::kube::api::{Api, ListParams};
use k7s_deps::kube::ResourceExt;
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

/// Path to the app config dir (Tauri-specific). Used by prefs I/O.
pub(crate) fn app_data_dir(app: &tauri::AppHandle) -> AppResult<std::path::PathBuf> {
    use tauri::Manager;
    app.path()
        .app_config_dir()
        .map_err(|e| AppError::Other(format!("no config dir: {e}")))
}

/// Load persisted preferences, or None if absent/unreadable.
#[tauri::command]
pub fn load_prefs(app: tauri::AppHandle) -> Option<Prefs> {
    let dir = app_data_dir(&app).ok()?;
    prefs::load_prefs_json(&dir)
}

/// Save preferences (best-effort; creates the config dir if needed).
#[tauri::command]
pub fn save_prefs(app: tauri::AppHandle, prefs: Prefs) -> AppResult<()> {
    let dir = app_data_dir(&app)?;
    prefs::save_prefs(&dir, &prefs)
}

/// List contexts for the cluster switcher: the default kubeconfig's plus any
/// imported ones (B17 — imports are restored on boot, so this must be merged or
/// they'd vanish on relaunch).
#[tauri::command]
pub async fn list_contexts(mgr: State<'_, Arc<CoreState>>) -> AppResult<Vec<ContextInfo>> {
    Ok(shell_common::merged_contexts(&mgr.manager).await)
}

/// Re-register kubeconfig files imported in a previous session (B17), returning
/// the paths that still parse.
///
/// Files that have moved or become unreadable are dropped rather than failing the
/// boot: the user deleting a kubeconfig shouldn't leave the app stuck on an error
/// about it. The caller persists the returned list, which prunes them for good.
#[tauri::command]
pub async fn restore_imports(
    paths: Vec<String>,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<String>> {
    let manager: Arc<ClientManager> = mgr.manager.clone();
    let mut alive = Vec::new();
    for path in paths {
        match client::contexts_from_file(&path) {
            Ok(contexts) => {
                for ctx in contexts {
                    manager
                        .add_import(
                            ctx.name.clone(),
                            ImportedContext {
                                path: path.clone(),
                                cluster: ctx.cluster.clone(),
                                kubeconfig: None,
                            },
                        )
                        .await;
                }
                alive.push(path);
            }
            Err(e) => k7s_deps::tracing::warn!("dropping imported kubeconfig {path}: {e}"),
        }
    }
    Ok(alive)
}

/// The default kubeconfig path (kubectl's), used to pre-point the import dialog.
#[tauri::command]
pub fn default_kubeconfig_path() -> String {
    client::default_kubeconfig_path()
}

/// Import contexts from a kubeconfig file at `path`. Records each context's source
/// file so it can be connected to later, and returns the merged switcher list
/// (default kubeconfig contexts + all imported ones, de-duplicated by name).
#[tauri::command]
pub async fn import_kubeconfig(
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<ContextInfo>> {
    let manager: Arc<ClientManager> = mgr.manager.clone();

    // Parse the file and remember where each of its contexts came from.
    let imported = client::contexts_from_file(&path)?;
    for ctx in &imported {
        manager
            .add_import(
                ctx.name.clone(),
                ImportedContext {
                    path: path.clone(),
                    cluster: ctx.cluster.clone(),
                    kubeconfig: None,
                },
            )
            .await;
    }

    Ok(shell_common::merged_contexts(&manager).await)
}

/// Connect to a context: tear down any previous connection, build a client, probe
/// the version, then start all watchers and the metric/status pollers.
#[tauri::command]
pub async fn connect(context: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<ClusterInfo> {
    let manager: Arc<ClientManager> = mgr.manager.clone();

    // Shared connection sequence: reset -> build client -> probe version ->
    // discover CRDs. The Tauri shell reads `import_path`; kubeconfig-bytes
    // is not used here (files live on disk).
    let import_path = manager.import_path(&context).await;
    let cr = shell_common::connect_core(&manager, None, import_path, &context).await?;

    // Start watchers for all kinds and register their tasks.
    let watcher_count = watchers::spawn_all(&manager, cr.client.clone()).await;

    // Start the metrics + status pollers and register them too.
    // Poll intervals come from the user's settings (B23). Read at connect, so a
    // change takes effect on the next connection rather than restarting live
    // pollers for a value measured in seconds.
    let dir = mgr.data_dir.clone();
    let prefs = k7s_deps::tokio::task::spawn_blocking(move || prefs::read_prefs(&dir))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;
    let pi = prefs::poll_intervals(&prefs);
    let (metrics_task, status_task) = metrics::spawn_pollers(manager.sink(), cr.client.clone(), pi);
    manager.push_task(metrics_task).await;
    manager.push_task(status_task).await;

    // Tell the frontend about CRD-backed kinds (discovered inside connect_core).
    manager
        .sink()
        .emit(k7s_core::kube::events::CUSTOM_KINDS, &cr.custom_kinds);

    // Record the live connection with the real watcher count.
    manager
        .set_connected(
            cr.client.clone(),
            k7s_core::kube::manager::ConnectionInfo {
                context: context.clone(),
                server: cr.server.clone(),
                version: cr.version.clone(),
            },
            watcher_count,
        )
        .await;

    // Auto-sync knowledge from the cluster (ConfigMaps, pod annotations)
    // in the background. Non-blocking — the connect response returns
    // immediately while sync runs behind the scenes.
    let sync_manager = manager.clone();
    let sync_data_dir = mgr.data_dir.clone();
    let sync_context = context.clone();
    k7s_deps::tokio::spawn(async move {
        match k7s_core::ai::knowledge_sync::sync_from_cluster(
            &sync_manager,
            &sync_data_dir,
            &sync_context,
        )
        .await
        {
            Ok(report) => {
                if report.config_maps + report.pod_annotations + report.deploy_annotations > 0 {
                    k7s_deps::tracing::info!(
                        cm = report.config_maps,
                        pods = report.pod_annotations,
                        deps = report.deploy_annotations,
                        "knowledge sync completed"
                    );
                }
            }
            Err(e) => k7s_deps::tracing::debug!("knowledge sync skipped: {e}"),
        }
    });

    Ok(ClusterInfo {
        context: context.clone(),
        cluster_name: context,
        server: cr.server,
        version: cr.version,
    })
}

/// Fetch an object's YAML for the detail panel (any kind). Strips
/// `metadata.managedFields`; Secret values are redacted (see below).
#[tauri::command]
pub async fn get_yaml(
    kind: String,
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<String> {
    let client = require_client(&mgr.manager).await?;
    shell_common::fetch_object_yaml(client, &kind, &namespace, &name, &mgr.manager).await
}

/// Apply edited YAML back to the cluster via replace (preserving resourceVersion
/// from the edited text). API errors are returned verbatim for inline display.
#[tauri::command]
pub async fn apply_yaml(
    kind: String,
    namespace: String,
    name: String,
    yaml: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    let client = require_client(&mgr.manager).await?;
    shell_common::apply_yaml_core(client, &kind, &namespace, &name, &yaml, &mgr.manager).await
}

/// Send an edit as a server-side dry run and return both sides for a diff (B36).
///
/// `dryRun=All` runs the whole admission chain — validation, defaulting, mutating
/// webhooks — and returns the object that *would* be persisted, without
/// persisting it. That's the only way to show what an apply will really do:
/// defaulted fields and webhook rewrites are invisible in the text you typed.
///
/// Both sides are serialized through the same path as `get_yaml` (managedFields
/// dropped, same serializer) so the diff shows real changes rather than
/// formatting noise.
#[tauri::command]
pub async fn dry_run_yaml(
    kind: String,
    namespace: String,
    name: String,
    yaml: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<shell_common::YamlDiff> {
    let client = require_client(&mgr.manager).await?;
    shell_common::dry_run_yaml_core(client, &kind, &namespace, &name, &yaml, &mgr.manager).await
}

/// Delete a resource of any kind. The frontend confirms first; API errors are
/// returned verbatim.
#[tauri::command]
pub async fn delete_resource(
    kind: String,
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    let client = require_client(&mgr.manager).await?;
    shell_common::delete_resource_core(client, &kind, &namespace, &name, &mgr.manager).await
}

/// Scale a Deployment/StatefulSet by patching `spec.replicas`.
#[tauri::command]
pub async fn scale_resource(
    kind: String,
    namespace: String,
    name: String,
    replicas: i32,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    let client = require_client(&mgr.manager).await?;
    shell_common::scale_resource_core(client, &kind, &namespace, &name, replicas, &mgr.manager)
        .await
}

/// Cordon or uncordon a node by patching `spec.unschedulable`.
#[tauri::command]
pub async fn set_cordon(
    name: String,
    unschedulable: bool,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    let client = require_client(&mgr.manager).await?;
    shell_common::set_cordon_core(client, &name, unschedulable, &mgr.manager).await
}

/// Restart a pod (B34) by deleting it so its controller recreates a fresh one.
///
/// Refuses a pod with no controlling owner: deleting *that* would just remove it,
/// which is a delete, not a restart. The check happens here, where we have the
/// full object, rather than trusting the frontend to have hidden the action.
#[tauri::command]
pub async fn restart_pod(
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    let client = require_client(&mgr.manager).await?;
    shell_common::restart_pod_core(client, &namespace, &name).await
}

/// Rollout-restart a Deployment/StatefulSet/DaemonSet (B34) the way `kubectl
/// rollout restart` does: patch the pod template's `restartedAt` annotation to
/// now, which the controller rolls through its normal update strategy.
#[tauri::command]
pub async fn restart_rollout(
    kind: String,
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    let client = require_client(&mgr.manager).await?;
    shell_common::restart_rollout_core(client, &kind, &namespace, &name, &mgr.manager).await
}

/// List the revision history of a Deployment/StatefulSet/DaemonSet — the data
/// behind the Revisions detail tab. Newest revision first. RBAC denials degrade
/// to an empty list rather than failing the tab (see `rollout::list_revisions`).
#[tauri::command]
pub async fn list_revisions(
    kind: String,
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<rollout::Revision>> {
    if !rollout::is_rollout_kind(&kind) {
        return Err(AppError::Other(format!("{kind} has no revision history")));
    }
    let client = require_client(&mgr.manager).await?;
    rollout::list_revisions(client, &kind, &namespace, &name).await
}

/// Roll a workload back to `to_revision`, or to the previous revision when
/// `to_revision` is `None` — the `kubectl rollout undo` default. This is the
/// engine behind the Revisions tab's "rollback to here" button and the row-menu
/// "rollback to last" action.
#[tauri::command]
pub async fn undo_rollout(
    kind: String,
    namespace: String,
    name: String,
    to_revision: Option<i64>,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    if !rollout::is_rollout_kind(&kind) {
        return Err(AppError::Other(format!("{kind} cannot be rolled back")));
    }
    let client = require_client(&mgr.manager).await?;
    rollout::undo_to(client, &kind, &namespace, &name, to_revision).await
}

/// Start watching a custom (CRD-backed) kind (B15), if it isn't already watched.
///
/// Called when the user opens a custom kind. Watching is lazy and reference-free:
/// a cluster can define hundreds of CRDs, and watching them all on connect would
/// open a stream per CRD for data nobody is looking at.
#[tauri::command]
pub async fn watch_custom_kind(kind: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    let manager: Arc<ClientManager> = mgr.manager.clone();
    // Already open — nothing to do (navigating back to a kind is common).
    if manager.has_custom_watcher(&kind).await {
        return Ok(());
    }
    let client = require_client(&manager).await?;
    let ck = manager
        .custom_kind(&kind)
        .await
        .ok_or_else(|| AppError::Other(format!("unknown custom kind: {kind}")))?;
    watchers::spawn_custom(&manager, client, &ck).await;
    Ok(())
}

/// Stop watching a custom kind (B15). Idempotent: unknown ids are a no-op, so the
/// frontend can call this unconditionally when navigating away.
#[tauri::command]
pub async fn unwatch_custom_kind(kind: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    mgr.manager.remove_custom_watcher(&kind).await;
    Ok(())
}

/// Instance counts for every discovered CRD-backed kind (B15).
///
/// One cheap LIST per kind (limit=1, remainingItemCount), bounded concurrency.
/// Best-effort: RBAC-denied or failed kinds report count 0.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn custom_kind_counts(
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<k7s_core::kube::CustomKindCount>> {
    let client = require_client(&mgr.manager).await?;
    k7s_core::kube::custom_kind_counts(&client).await
}

/// Drain a node (B20): cordon it, then evict its pods in the background.
///
/// Cordoning happens inline so an RBAC/not-found failure surfaces as a rejected
/// command rather than a silent no-op. The eviction pass then runs as a
/// connection-scoped task reporting via [`k7s_deps::kube::events::DRAIN_PROGRESS`] — it can
/// take minutes, so blocking the command on it would freeze the UI.
#[tauri::command]
pub async fn drain_node(name: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    let client = require_client(&mgr.manager).await?;
    let manager: Arc<ClientManager> = mgr.manager.clone();

    // Cordon first: without it the scheduler could refill the node as we drain it.
    drain::cordon(client.clone(), &name).await?;

    let app = manager.sink();
    let task = k7s_deps::tokio::spawn(async move {
        drain::run_drain(client, app, name).await;
    });
    manager.push_task(task).await;
    Ok(())
}

/// Backfill a node's charts from Prometheus (B38), or an empty list when the
/// cluster has no Prometheus we recognise.
///
/// Empty is a normal answer, not an error: B27's live scraper is the source of
/// truth and works without any of this, so a cluster with no Prometheus (or one
/// whose scrape targets have drifted) simply opens the charts empty and fills
/// them as it goes, exactly as before.
#[tauri::command]
pub async fn node_history(
    node: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<exporter::NodeSample>> {
    let client = require_client(&mgr.manager).await?;
    let Some(svc) = promql::discover(&client).await else {
        return Ok(Vec::new());
    };
    let now = k7s_deps::chrono::Utc::now().timestamp();
    // An hour at 30s is 120 points — enough to open with a populated chart
    // without crowding out the live samples that follow (the series is capped).
    promql::node_history(&client, &svc, &node, now, 3600, 30).await
}

/// Backfill a pod's CPU/memory charts from Prometheus, or an empty list when
/// the cluster has no Prometheus we recognise.
///
/// Like `node_history`, empty is normal — the live metrics poller is the
/// primary source and this just pre-populates the trend chart.
#[tauri::command]
pub async fn pod_history(
    namespace: String,
    pod: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<metrics::PodSample>> {
    let client = require_client(&mgr.manager).await?;
    promql::pod_history(&client, &namespace, &pod, 3600).await
}

/// Start scraping a node's node-exporter for plots (B27), if not already running.
///
/// Called when a node's Metrics tab opens. Lazy for the same reason CRD watchers
/// are: each scrape moves a few hundred KB and holds a port-forward, which is not
/// something to run for every node in the background.
#[tauri::command]
pub async fn watch_node_stats(node: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    let manager: Arc<ClientManager> = mgr.manager.clone();
    if manager.has_node_scraper(&node).await {
        return Ok(());
    }
    let client = require_client(&manager).await?;
    let app = manager.sink();
    // Reuses the metrics poll interval from settings (B23): it's the same question
    // ("how often should we ask the cluster how it's doing"), so it would be odd
    // for the plots to march to a different drum than the table's CPU column.
    let dir = mgr.data_dir.clone();
    let prefs = k7s_deps::tokio::task::spawn_blocking(move || prefs::read_prefs(&dir))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;
    let every = prefs::poll_intervals(&prefs).metrics;
    let n = node.clone();
    let task = k7s_deps::tokio::spawn(async move {
        nodestats::run_node_stats(client, app, n, every).await;
    });
    manager.add_node_scraper(node, task).await;
    Ok(())
}

/// Stop scraping a node (B27). Idempotent, so the frontend can call it
/// unconditionally when the tab closes; drops the port-forward with it.
#[tauri::command]
pub async fn unwatch_node_stats(node: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    mgr.manager.remove_node_scraper(&node).await;
    Ok(())
}

/// Analyze a Pod's termination state and return a structured diagnosis.
///
/// Inspects container statuses for well-known failure patterns (OOMKilled,
/// CrashLoopBackOff, ImagePullBackOff, segfault, etc.) and produces a
/// human-readable summary with severity.
#[tauri::command]
pub async fn diagnose_pod(
    namespace: String,
    pod: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<k7s_deps::serde_json::Value> {
    let client = require_client(&mgr.manager).await?;
    let diagnosis = k7s_core::kube::pod_diagnosis::diagnose_pod(client, &namespace, &pod).await?;
    k7s_deps::serde_json::to_value(diagnosis)
        .map_err(|e| AppError::Other(format!("serialize error: {e}")))
}

/// An event as shown in the detail panel's Events tab.
#[derive(Serialize)]
pub struct EventItem {
    #[serde(rename = "type")]
    type_: String,
    reason: String,
    message: String,
    count: i32,
    age: String,
}

/// Decoded secret data entry.
#[derive(Serialize, Clone)]
pub struct SecretEntry {
    pub key: String,
    pub value: String,
}

/// Return decoded Secret data (base64 -> UTF-8). Deliberately separate from
/// `get_yaml` which redacts values — this is an explicit user action.
#[tauri::command]
pub async fn get_secret_data(
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<SecretEntry>> {
    let client = require_client(&mgr.manager).await?;
    let api: Api<Secret> = Api::namespaced(client, &namespace);
    let sec = api
        .get(&name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let mut entries = Vec::new();
    if let Some(data) = &sec.data {
        for (k, v) in data {
            let decoded = String::from_utf8_lossy(&v.0).to_string();
            entries.push(SecretEntry {
                key: k.clone(),
                value: decoded,
            });
        }
    }
    Ok(entries)
}

/// Snapshot a ConfigMap's current state and return all available snapshots.
///
/// Each call captures the current `resourceVersion` into a ring buffer (max 20).
/// Deduplicates by version: calling this twice without the ConfigMap changing
/// returns the same list. The `yaml` field in each snapshot is ready for diffing
/// (managedFields stripped, same serializer as `get_yaml`).
#[tauri::command]
pub async fn configmap_snapshots(
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<config_snapshots::ConfigSnapshot>> {
    let client = require_client(&mgr.manager).await?;
    config_snapshots::snapshot_configmap(mgr.manager.snapshot_store(), client, &namespace, &name)
        .await
}

/// Snapshot a Secret's current state and return all available snapshots.
///
/// Like `configmap_snapshots` but for Secrets. Values are redacted in the YAML
/// field (same as `get_yaml`), so this is safe to display in the UI.
#[tauri::command]
pub async fn secret_snapshots(
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<config_snapshots::ConfigSnapshot>> {
    let client = require_client(&mgr.manager).await?;
    config_snapshots::snapshot_secret(mgr.manager.snapshot_store(), client, &namespace, &name).await
}

/// Get a specific snapshot's YAML by resource version.
///
/// Returns the stored YAML for a previously-captured snapshot, or None if the
/// version is unknown or has been evicted from the ring buffer. Useful for
/// showing the "old" side of a diff without re-fetching from the cluster.
#[tauri::command]
pub async fn configmap_snapshot_yaml(
    kind: String,
    namespace: String,
    name: String,
    resource_version: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Option<String>> {
    let key = format!("{kind}:{namespace}/{name}");
    Ok(mgr
        .manager
        .snapshot_store()
        .get(&key, &resource_version)
        .await
        .map(|s| s.yaml))
}

/// Build a dependency graph of resources: Deployments -> ReplicaSets -> Pods,
/// Services -> Pods (via selector), Ingresses -> Services (via backend rules).
#[tauri::command]
pub async fn dependency_graph(
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<k7s_deps::serde_json::Value> {
    let client = require_client(&mgr.manager).await?;
    let graph = k7s_core::kube::dependency_graph::build_dependency_graph(client).await?;
    k7s_deps::serde_json::to_value(graph)
        .map_err(|e| AppError::Other(format!("serialize error: {e}")))
}

/// Debug an Ingress's routing chain: trace rules through Services to endpoint
/// Pods and report the health of each hop.
#[tauri::command]
pub async fn debug_ingress(
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<ingress_debug::IngressDebugResult> {
    let client = require_client(&mgr.manager).await?;
    ingress_debug::debug_ingress(client, &namespace, &name).await
}

/// Simulate connectivity between two pods based on NetworkPolicies.
///
/// Answers "can pod A in namespace X talk to pod B in namespace Y on port Z?"
/// by evaluating all applicable NetworkPolicies for both egress and ingress.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn simulate_connectivity(
    src_namespace: String,
    src_pod: String,
    dst_namespace: String,
    dst_pod: String,
    port: Option<i32>,
    protocol: Option<String>,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<k7s_core::kube::netpol_sim::SimulationResult> {
    let client = require_client(&mgr.manager).await?;
    k7s_core::kube::netpol_sim::simulate_connectivity(
        client,
        &src_namespace,
        &src_pod,
        &dst_namespace,
        &dst_pod,
        port,
        protocol,
    )
    .await
}

/// Gather an object's properties as a generic section document (B13, B18).
/// Errors for kinds with no gatherer — the frontend only offers the tab for the
/// kinds that have one.
#[tauri::command]
pub async fn get_properties(
    kind: String,
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<properties::Properties> {
    let client = require_client(&mgr.manager).await?;
    properties::gather(client, &kind, &namespace, &name).await
}

/// List events for an object, newest first, field-selected by involvedObject.
#[tauri::command]
pub async fn get_events(
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<EventItem>> {
    let client = require_client(&mgr.manager).await?;
    let api: Api<Event> = Api::namespaced(client, &namespace);
    let lp = ListParams::default().fields(&format!(
        "involvedObject.name={name},involvedObject.namespace={namespace}"
    ));
    let mut list = api.list(&lp).await?;

    // Sort newest-first by last-seen time (Reverse for descending).
    list.items.sort_by_key(|e| std::cmp::Reverse(last_seen(e)));

    let items = list
        .items
        .iter()
        .map(|e| EventItem {
            type_: e.type_.clone().unwrap_or_else(|| "Normal".into()),
            reason: e.reason.clone().unwrap_or_default(),
            message: e.message.clone().unwrap_or_default(),
            count: e.count.unwrap_or(1),
            age: event_age(e),
        })
        .collect();
    Ok(items)
}

/// Start following a container's logs; returns the new stream id.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_log_stream(
    namespace: String,
    pod: String,
    container: String,
    tail: Option<i64>,
    since_time: Option<String>,
    since_seconds: Option<i64>,
    previous: bool,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<String> {
    let client = require_client(&mgr.manager).await?;
    let opts = logs::LogStreamOptions {
        tail,
        since_time,
        since_seconds,
        previous,
    };
    Ok(shell_common::spawn_log_stream(&mgr.manager, client, namespace, pod, container, opts).await)
}

/// Write a pod's full logs to `path` (B29).
///
/// Deliberately not "save what's on screen": the view holds a ring buffer of the
/// last few hundred lines, and the reason you're exporting is usually that you
/// want the part that scrolled away. This re-reads with no tail cap.
///
/// The backend writes the file itself rather than handing the text back for the
/// frontend to save — a container's whole log can be tens of megabytes, and
/// there's no reason to move that through the IPC bridge and into the webview's
/// heap just to write it straight back out to disk.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn export_logs(
    namespace: String,
    pod: String,
    container: String,
    since_seconds: Option<i64>,
    previous: bool,
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<usize> {
    let client = require_client(&mgr.manager).await?;
    let containers = if container.is_empty() {
        vec![]
    } else {
        vec![container]
    };
    let (out, lines) = logs::fetch_export_logs(
        client,
        &namespace,
        &pod,
        containers,
        since_seconds,
        previous,
    )
    .await?;
    std::fs::write(&path, out)
        .map_err(|e| AppError::Other(format!("could not write {path}: {e}")))?;
    Ok(lines)
}

/// Stop a log stream (idempotent). Called on pause and panel close.
#[tauri::command]
pub async fn stop_log_stream(stream_id: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    mgr.manager.remove_log(&stream_id).await;
    Ok(())
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/// Get the active client or a friendly "not connected" error.
pub(crate) async fn require_client(mgr: &ClientManager) -> AppResult<k7s_deps::kube::Client> {
    mgr.client()
        .await
        .ok_or_else(|| AppError::NotFound("not connected to a cluster".into()))
}

/// Best "last seen" time for sorting: last_timestamp, else event_time, else epoch.
fn last_seen(e: &Event) -> k7s_deps::k8s_openapi::jiff::Timestamp {
    if let Some(t) = &e.last_timestamp {
        return t.0;
    }
    if let Some(t) = &e.event_time {
        return t.0;
    }
    // Fall back to creation time or the epoch.
    e.creation_timestamp().map(|t| t.0).unwrap_or_default()
}

/// Humanized age of an event's last occurrence (e.g. "2m").
fn event_age(e: &Event) -> String {
    let now = k7s_deps::k8s_openapi::jiff::Timestamp::now();
    let seen = last_seen(e);
    let secs = now.duration_since(seen).as_secs().max(0);
    mappers::humanize_duration(secs)
}

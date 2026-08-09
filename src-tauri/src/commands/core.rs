//! Core Tauri commands: prefs, contexts, connect, YAML CRUD, scale, cordon,
//! restart, rollout, custom kinds, drain, node stats, events, secrets,
//! properties, and log streams.

use crate::core::prefs::{self, Prefs};
use crate::core::shell_common::{self, STREAM_SEQ};
use crate::core::CoreState;
use crate::error::{AppError, AppResult};
use crate::kube::client::{self, ClusterInfo, ContextInfo};
use crate::kube::manager::{ClientManager, ImportedContext};
use crate::kube::{
    discovery, drain, exporter, logs, mappers, metrics, nodestats, promql, properties, restart,
    rollout, watchers, ResourceKind,
};
use k8s_openapi::api::core::v1::{Event, Secret};
use kube::api::{Api, DeleteParams, DynamicObject, ListParams, Patch, PatchParams, PostParams};
use kube::ResourceExt;
use serde::Serialize;
use std::sync::atomic::Ordering;
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
            Err(e) => tracing::warn!("dropping imported kubeconfig {path}: {e}"),
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

    // Abort every task from the previous connection first (Story 6.1).
    manager.reset().await;

    // If this context was imported from a specific file, build the client from
    // that file; otherwise use the default kubeconfig resolution.
    let (kube_client, server) = match manager.import_path(&context).await {
        Some(path) => client::build_client_from_file(&path, &context).await?,
        None => client::build_client(&context).await?,
    };
    let version = client::probe_version(&kube_client).await?;

    // Start watchers for all kinds and register their tasks.
    let watcher_count = watchers::spawn_all(&manager, kube_client.clone()).await;

    // Start the metrics + status pollers and register them too.
    // Poll intervals come from the user's settings (B23). Read at connect, so a
    // change takes effect on the next connection rather than restarting live
    // pollers for a value measured in seconds.
    let pi = prefs::poll_intervals(&prefs::read_prefs(&mgr.data_dir));
    let (metrics_task, status_task) =
        metrics::spawn_pollers(manager.sink(), kube_client.clone(), pi);
    manager.push_task(metrics_task).await;
    manager.push_task(status_task).await;

    // Discover CRD-backed kinds and tell the frontend about them (B15). Their
    // watchers start lazily when the user opens one, so this only populates the
    // nav — a cluster with dozens of CRDs costs nothing until a kind is opened.
    let custom = discovery::discover(&kube_client).await;
    manager.set_custom_kinds(custom.clone()).await;
    manager
        .sink()
        .emit(crate::kube::events::CUSTOM_KINDS, &custom);

    // Record the live connection (also emits the initial watch-status count).
    // `ConnectionInfo` is what `manager.connection_info()` (and the web
    // shell's `GET /api/status`) reads to identify the cluster to the
    // user — keep it in sync with what we return below.
    manager
        .set_connected(
            kube_client.clone(),
            crate::kube::manager::ConnectionInfo {
                context: context.clone(),
                server: server.clone(),
                version: version.clone(),
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
    tokio::spawn(async move {
        match crate::ai::knowledge_sync::sync_from_cluster(
            &sync_manager,
            &sync_data_dir,
            &sync_context,
        )
        .await
        {
            Ok(report) => {
                if report.config_maps + report.pod_annotations + report.deploy_annotations > 0 {
                    tracing::info!(
                        cm = report.config_maps,
                        pods = report.pod_annotations,
                        deps = report.deploy_annotations,
                        "knowledge sync completed"
                    );
                }
            }
            Err(e) => tracing::debug!("knowledge sync skipped: {e}"),
        }
    });

    Ok(ClusterInfo {
        context: context.clone(),
        cluster_name: context,
        server,
        version,
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
    // A Helm release isn't an API object, so there's nothing to GET: its YAML is
    // the manifest the chart rendered, which is what you actually want to read
    // (B26). Secret values in it are already redacted by the decoder.
    if kind == ResourceKind::Helm.id() {
        return shell_common::helm_manifest(client, &namespace, &name).await;
    }
    let (api, _is_helm) =
        shell_common::dynamic_api(client, &kind, &namespace, &mgr.manager).await?;
    let mut obj = api.get(&name).await?;
    // Drop server-managed noise before rendering.
    obj.metadata.managed_fields = None;
    // Never surface Secret values; redact them for display (Secrets are read-only,
    // see apply_yaml). Documented in docs/verification.md.
    if kind == "secrets" {
        shell_common::redact_secret(&mut obj);
    }
    Ok(serde_yaml::to_string(&obj)?)
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
    shell_common::ensure_writable(&kind)?;
    let obj: DynamicObject = serde_yaml::from_str(&yaml)?;
    let (api, _is_helm) =
        shell_common::dynamic_api(client, &kind, &namespace, &mgr.manager).await?;
    // replace() requires the resourceVersion present in the fetched/edited object;
    // a stale value yields a 409 whose message we pass straight through.
    api.replace(&name, &PostParams::default(), &obj).await?;
    Ok(())
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
    shell_common::ensure_writable(&kind)?;
    let obj: DynamicObject = serde_yaml::from_str(&yaml)?;
    let (api, _is_helm) =
        shell_common::dynamic_api(client, &kind, &namespace, &mgr.manager).await?;

    let mut current = api.get(&name).await?;
    current.metadata.managed_fields = None;

    // A rejected dry run is the point, not a failure of this command: the caller
    // shows the server's message instead of a diff, and nothing was written.
    let pp = PostParams {
        dry_run: true,
        ..Default::default()
    };
    let mut proposed = api.replace(&name, &pp, &obj).await?;
    proposed.metadata.managed_fields = None;

    Ok(shell_common::YamlDiff {
        current: serde_yaml::to_string(&current)?,
        proposed: serde_yaml::to_string(&proposed)?,
    })
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
    let (api, _is_helm) =
        shell_common::dynamic_api(client, &kind, &namespace, &mgr.manager).await?;
    api.delete(&name, &DeleteParams::default()).await?;
    Ok(())
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
    let (api, _is_helm) =
        shell_common::dynamic_api(client, &kind, &namespace, &mgr.manager).await?;
    let patch = Patch::Merge(serde_json::json!({ "spec": { "replicas": replicas } }));
    api.patch(&name, &PatchParams::default(), &patch).await?;
    Ok(())
}

/// Cordon or uncordon a node by patching `spec.unschedulable`.
#[tauri::command]
pub async fn set_cordon(
    name: String,
    unschedulable: bool,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    let client = require_client(&mgr.manager).await?;
    let (api, _is_helm) = shell_common::dynamic_api(client, "nodes", "", &mgr.manager).await?;
    let patch = Patch::Merge(serde_json::json!({ "spec": { "unschedulable": unschedulable } }));
    api.patch(&name, &PatchParams::default(), &patch).await?;
    Ok(())
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
    let api: Api<k8s_openapi::api::core::v1::Pod> = Api::namespaced(client, &namespace);
    let pod = api.get(&name).await?;
    if !restart::has_controller(&pod) {
        return Err(AppError::Other(format!(
            "{name} has no controller — deleting it would not recreate it. Use Delete instead."
        )));
    }
    api.delete(&name, &DeleteParams::default()).await?;
    Ok(())
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
    if !restart::is_rollout_kind(&kind) {
        return Err(AppError::Other(format!(
            "{kind} cannot be rollout-restarted"
        )));
    }
    let client = require_client(&mgr.manager).await?;
    let (api, _is_helm) =
        shell_common::dynamic_api(client, &kind, &namespace, &mgr.manager).await?;
    let now = chrono::Utc::now().to_rfc3339();
    let patch = Patch::Merge(restart::restart_patch(&now));
    api.patch(&name, &PatchParams::default(), &patch).await?;
    Ok(())
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

/// Drain a node (B20): cordon it, then evict its pods in the background.
///
/// Cordoning happens inline so an RBAC/not-found failure surfaces as a rejected
/// command rather than a silent no-op. The eviction pass then runs as a
/// connection-scoped task reporting via [`kube::events::DRAIN_PROGRESS`] — it can
/// take minutes, so blocking the command on it would freeze the UI.
#[tauri::command]
pub async fn drain_node(name: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    let client = require_client(&mgr.manager).await?;
    let manager: Arc<ClientManager> = mgr.manager.clone();

    // Cordon first: without it the scheduler could refill the node as we drain it.
    drain::cordon(client.clone(), &name).await?;

    let app = manager.sink();
    let task = tokio::spawn(async move {
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
    let now = chrono::Utc::now().timestamp();
    // An hour at 30s is 120 points — enough to open with a populated chart
    // without crowding out the live samples that follow (the series is capped).
    promql::node_history(&client, &svc, &node, now, 3600, 30).await
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
    let every = prefs::poll_intervals(&prefs::read_prefs(&mgr.data_dir)).metrics;
    let n = node.clone();
    let task = tokio::spawn(async move {
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
    let manager: Arc<ClientManager> = mgr.manager.clone();

    // Unique id per stream (pod name + sequence).
    let stream_id = format!("{}-{}", pod, STREAM_SEQ.fetch_add(1, Ordering::Relaxed));
    let app = manager.sink();

    let opts = logs::LogStreamOptions {
        tail,
        since_time,
        since_seconds,
        previous,
    };
    let id_for_task = stream_id.clone();
    let handle = tokio::spawn(async move {
        logs::run_log_stream(client, app, id_for_task, namespace, pod, container, opts).await;
    });

    manager.add_log(stream_id.clone(), handle).await;
    Ok(stream_id)
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
    let api: Api<k8s_openapi::api::core::v1::Pod> = Api::namespaced(client.clone(), &namespace);

    // No tail: the whole thing. No follow: this must terminate.
    let opts = logs::LogStreamOptions {
        tail: None,
        since_time: None,
        since_seconds,
        previous,
    };

    // An empty container means "all of them" (B7), so the export mirrors what the
    // view interleaves — one block per container, labelled, rather than a soup of
    // lines whose origin the file can't show.
    let containers = if container.is_empty() {
        let p = api
            .get(&pod)
            .await
            .map_err(|e| AppError::Kube(e.to_string()))?;
        p.spec
            .map(|s| s.containers.into_iter().map(|c| c.name).collect::<Vec<_>>())
            .unwrap_or_default()
    } else {
        vec![container]
    };

    let mut out = String::new();
    for name in &containers {
        let mut lp = logs::log_params(name, &opts);
        // log_params follows unless reading `previous`; an export must always end.
        lp.follow = false;
        let text = api
            .logs(&pod, &lp)
            .await
            .map_err(|e| AppError::Kube(e.to_string()))?;
        if containers.len() > 1 {
            out.push_str(&format!("===== container: {name} =====\n"));
        }
        out.push_str(&text);
        if !text.ends_with('\n') {
            out.push('\n');
        }
    }

    let lines = out.lines().count();
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
pub(crate) async fn require_client(mgr: &ClientManager) -> AppResult<kube::Client> {
    mgr.client()
        .await
        .ok_or_else(|| AppError::NotFound("not connected to a cluster".into()))
}

/// Best "last seen" time for sorting: last_timestamp, else event_time, else epoch.
fn last_seen(e: &Event) -> chrono::DateTime<chrono::Utc> {
    if let Some(t) = &e.last_timestamp {
        return t.0;
    }
    if let Some(t) = &e.event_time {
        return t.0;
    }
    // Fall back to creation time or the epoch.
    e.creation_timestamp()
        .map(|t| t.0)
        .unwrap_or_else(|| chrono::DateTime::<chrono::Utc>::UNIX_EPOCH)
}

/// Humanized age of an event's last occurrence (e.g. "2m").
fn event_age(e: &Event) -> String {
    let secs = (chrono::Utc::now() - last_seen(e)).num_seconds().max(0);
    mappers::humanize_duration(secs)
}

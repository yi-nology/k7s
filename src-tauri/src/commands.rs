//! Tauri commands invoked by the frontend. These are the only entry points from
//! the webview into Kubernetes. Live data (tables, metrics, status, logs) is
//! pushed back via events (see kube::events); these commands cover the one-shot
//! request/response operations plus starting/stopping log streams.

use crate::core::prefs::{self, Prefs};
use crate::core::shell_common::{self, NodeShellInfo, STREAM_SEQ};
use crate::core::CoreState;
use crate::error::{AppError, AppResult};
use crate::kube::client::{self, ClusterInfo, ContextInfo};
use crate::kube::manager::{ForwardDto, ImportedContext, ShellSession};
use crate::kube::{
    alerting, audit, discovery, drain, endpoints, exec, exporter, grafana, helm_market, helm_ops,
    image_archive, image_sync, imageimport, imagerepo, logs, mappers, metrics, metrics_config,
    nodeshell, nodestats, pod_files, portforward, promql, properties, restart, rollout,
    saved_queries,
    templates, watchers, ClientManager, ResourceKind,
};
use tokio::sync::{mpsc, oneshot};
use k8s_openapi::api::core::v1::{Event, Secret};
use kube::api::{
    Api, DeleteParams, DynamicObject, ListParams, Patch, PatchParams, PostParams,
};
use kube::ResourceExt;
use serde::Serialize;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::State;

/// Path to the app config dir (Tauri-specific). Used by prefs I/O.
fn app_data_dir(app: &tauri::AppHandle) -> AppResult<std::path::PathBuf> {
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
    Ok(shell_common::merged_contexts(&(*mgr).manager).await)
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
    let manager: Arc<ClientManager> = (&(*mgr)).manager.clone();
    let mut alive = Vec::new();
    for path in paths {
        match client::contexts_from_file(&path) {
            Ok(contexts) => {
                for ctx in contexts {
                    manager
                        .add_import(
                            ctx.name.clone(),
                            ImportedContext { path: path.clone(), cluster: ctx.cluster.clone(), kubeconfig: None },
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
    let manager: Arc<ClientManager> = (&(*mgr)).manager.clone();

    // Parse the file and remember where each of its contexts came from.
    let imported = client::contexts_from_file(&path)?;
    for ctx in &imported {
        manager
            .add_import(
                ctx.name.clone(),
                ImportedContext { path: path.clone(), cluster: ctx.cluster.clone(), kubeconfig: None },
            )
            .await;
    }

    Ok(shell_common::merged_contexts(&manager).await)
}

/// Connect to a context: tear down any previous connection, build a client, probe
/// the version, then start all watchers and the metric/status pollers.
#[tauri::command]
pub async fn connect(
    context: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<ClusterInfo> {
    let manager: Arc<ClientManager> = (&(*mgr)).manager.clone();

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
    let pi = prefs::poll_intervals(&prefs::read_prefs(&(*mgr).data_dir));
    let (metrics_task, status_task) =
        metrics::spawn_pollers(manager.sink(), kube_client.clone(), pi);
    manager.push_task(metrics_task).await;
    manager.push_task(status_task).await;

    // Discover CRD-backed kinds and tell the frontend about them (B15). Their
    // watchers start lazily when the user opens one, so this only populates the
    // nav — a cluster with dozens of CRDs costs nothing until a kind is opened.
    let custom = discovery::discover(&kube_client).await;
    manager.set_custom_kinds(custom.clone()).await;
    let _ = manager.sink().emit(crate::kube::events::CUSTOM_KINDS, &custom);

    // Record the live connection (also emits the initial watch-status count).
    // `ConnectionInfo` is what `manager.connection_info()` (and the web
    // shell's `GET /api/status`) reads to identify the cluster to the
    // user — keep it in sync with what we return below.
    manager
        .set_connected(
            kube_client,
            crate::kube::manager::ConnectionInfo {
                context: context.clone(),
                server: server.clone(),
                version: version.clone(),
            },
            watcher_count,
        )
        .await;

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
    let client = require_client(&(*mgr).manager).await?;
    // A Helm release isn't an API object, so there's nothing to GET: its YAML is
    // the manifest the chart rendered, which is what you actually want to read
    // (B26). Secret values in it are already redacted by the decoder.
    if kind == ResourceKind::Helm.id() {
        return shell_common::helm_manifest(client, &namespace, &name).await;
    }
    let (api, _is_helm) = shell_common::dynamic_api(client, &kind, &namespace, &(*mgr).manager).await?;
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
    let client = require_client(&(*mgr).manager).await?;
    shell_common::ensure_writable(&kind)?;
    let obj: DynamicObject = serde_yaml::from_str(&yaml)?;
    let (api, _is_helm) = shell_common::dynamic_api(client, &kind, &namespace, &(*mgr).manager).await?;
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
    let client = require_client(&(*mgr).manager).await?;
    shell_common::ensure_writable(&kind)?;
    let obj: DynamicObject = serde_yaml::from_str(&yaml)?;
    let (api, _is_helm) = shell_common::dynamic_api(client, &kind, &namespace, &(*mgr).manager).await?;

    let mut current = api.get(&name).await?;
    current.metadata.managed_fields = None;

    // A rejected dry run is the point, not a failure of this command: the caller
    // shows the server's message instead of a diff, and nothing was written.
    let pp = PostParams { dry_run: true, ..Default::default() };
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
    let client = require_client(&(*mgr).manager).await?;
    let (api, _is_helm) = shell_common::dynamic_api(client, &kind, &namespace, &(*mgr).manager).await?;
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
    let client = require_client(&(*mgr).manager).await?;
    let (api, _is_helm) = shell_common::dynamic_api(client, &kind, &namespace, &(*mgr).manager).await?;
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
    let client = require_client(&(*mgr).manager).await?;
    let (api, _is_helm) = shell_common::dynamic_api(client, "nodes", "", &(*mgr).manager).await?;
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
    let client = require_client(&(*mgr).manager).await?;
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
        return Err(AppError::Other(format!("{kind} cannot be rollout-restarted")));
    }
    let client = require_client(&(*mgr).manager).await?;
    let (api, _is_helm) = shell_common::dynamic_api(client, &kind, &namespace, &(*mgr).manager).await?;
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
    let client = require_client(&(*mgr).manager).await?;
    Ok(rollout::list_revisions(client, &kind, &namespace, &name).await?)
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
    let client = require_client(&(*mgr).manager).await?;
    rollout::undo_to(client, &kind, &namespace, &name, to_revision).await
}

/// Start watching a custom (CRD-backed) kind (B15), if it isn't already watched.
///
/// Called when the user opens a custom kind. Watching is lazy and reference-free:
/// a cluster can define hundreds of CRDs, and watching them all on connect would
/// open a stream per CRD for data nobody is looking at.
#[tauri::command]
pub async fn watch_custom_kind(kind: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    let manager: Arc<ClientManager> = (&(*mgr)).manager.clone();
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
    (*mgr).manager.remove_custom_watcher(&kind).await;
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
    let client = require_client(&(*mgr).manager).await?;
    let manager: Arc<ClientManager> = (&(*mgr)).manager.clone();

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
    let client = require_client(&(*mgr).manager).await?;
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
    let manager: Arc<ClientManager> = (&(*mgr)).manager.clone();
    if manager.has_node_scraper(&node).await {
        return Ok(());
    }
    let client = require_client(&manager).await?;
    let app = manager.sink();
    // Reuses the metrics poll interval from settings (B23): it's the same question
    // ("how often should we ask the cluster how it's doing"), so it would be odd
    // for the plots to march to a different drum than the table's CPU column.
    let every = prefs::poll_intervals(&prefs::read_prefs(&(*mgr).data_dir)).metrics;
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
    (*mgr).manager.remove_node_scraper(&node).await;
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
    let client = require_client(&(*mgr).manager).await?;
    let api: Api<Secret> = Api::namespaced(client, &namespace);
    let sec = api.get(&name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let mut entries = Vec::new();
    if let Some(data) = &sec.data {
        for (k, v) in data {
            let decoded = String::from_utf8_lossy(&v.0).to_string();
            entries.push(SecretEntry { key: k.clone(), value: decoded });
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
    let client = require_client(&(*mgr).manager).await?;
    properties::gather(client, &kind, &namespace, &name).await
}

/// List events for an object, newest first, field-selected by involvedObject.
#[tauri::command]
pub async fn get_events(
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<EventItem>> {
    let client = require_client(&(*mgr).manager).await?;
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
    let client = require_client(&(*mgr).manager).await?;
    let manager: Arc<ClientManager> = (&(*mgr)).manager.clone();

    // Unique id per stream (pod name + sequence).
    let stream_id = format!("{}-{}", pod, STREAM_SEQ.fetch_add(1, Ordering::Relaxed));
    let app = manager.sink();

    let opts = logs::LogStreamOptions { tail, since_time, since_seconds, previous };
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
    let client = require_client(&(*mgr).manager).await?;
    let api: Api<k8s_openapi::api::core::v1::Pod> = Api::namespaced(client.clone(), &namespace);

    // No tail: the whole thing. No follow: this must terminate.
    let opts = logs::LogStreamOptions { tail: None, since_time: None, since_seconds, previous };

    // An empty container means "all of them" (B7), so the export mirrors what the
    // view interleaves — one block per container, labelled, rather than a soup of
    // lines whose origin the file can't show.
    let containers = if container.is_empty() {
        let p = api.get(&pod).await.map_err(|e| AppError::Kube(e.to_string()))?;
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
        let text = api.logs(&pod, &lp).await.map_err(|e| AppError::Kube(e.to_string()))?;
        if containers.len() > 1 {
            out.push_str(&format!("===== container: {name} =====\n"));
        }
        out.push_str(&text);
        if !text.ends_with('\n') {
            out.push('\n');
        }
    }

    let lines = out.lines().count();
    std::fs::write(&path, out).map_err(|e| AppError::Other(format!("could not write {path}: {e}")))?;
    Ok(lines)
}

/// Stop a log stream (idempotent). Called on pause and panel close.
#[tauri::command]
pub async fn stop_log_stream(
    stream_id: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    (*mgr).manager.remove_log(&stream_id).await;
    Ok(())
}

// --------------------------------------------------------------------------
// Shell / exec (B4)
// --------------------------------------------------------------------------

/// Start an interactive shell in a pod container; returns the session id.
#[tauri::command]
pub async fn start_shell(
    namespace: String,
    pod: String,
    container: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<String> {
    let client = require_client(&(*mgr).manager).await?;
    let manager: Arc<ClientManager> = (&(*mgr)).manager.clone();

    let id = format!("sh-{}-{}", pod, STREAM_SEQ.fetch_add(1, Ordering::Relaxed));
    let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(64);
    let (resize_tx, resize_rx) = mpsc::channel::<(u16, u16)>(8);
    let app = manager.sink();
    // Read per-session, so changing the override applies to the next shell you
    // open rather than needing a reconnect (B23).
    let shell_override = prefs::read_prefs(&(*mgr).data_dir).shell_command.unwrap_or_default();
    let id_for_task = id.clone();
    let task = tokio::spawn(async move {
        exec::run_shell(
            client,
            app,
            id_for_task,
            namespace,
            pod,
            container,
            shell_override,
            input_rx,
            resize_rx,
        )
        .await;
    });

    manager
        .add_shell(id.clone(), ShellSession { task, input_tx, resize_tx })
        .await;
    Ok(id)
}

// --------------------------------------------------------------------------
// Node debug shell (B53)
// --------------------------------------------------------------------------



/// Open a root shell on a node's host OS (B53).
///
/// This creates a privileged pod — see kube/nodeshell.rs for what that grants and
/// why each piece is needed. It is only ever called from an explicit user action.
#[tauri::command]
pub async fn start_node_shell(
    node: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<NodeShellInfo> {
    let client = require_client(&(*mgr).manager).await?;
    let manager: Arc<ClientManager> = (&(*mgr)).manager.clone();
    let api: Api<k8s_openapi::api::core::v1::Pod> =
        Api::namespaced(client.clone(), nodeshell::DEBUG_NAMESPACE);

    // Sweep this node's leftovers first. A previous session that died without
    // cleaning up would otherwise collide on the name or, worse, quietly leave a
    // privileged pod running alongside the new one.
    if let Ok(old) = api
        .list(&ListParams::default().labels(&nodeshell::node_selector(&node)))
        .await
    {
        for pod in old.items {
            nodeshell::delete_debug_pod(&api, &pod.name_any()).await;
        }
    }

    let seq = STREAM_SEQ.fetch_add(1, Ordering::Relaxed);
    let pod_name = nodeshell::pod_name(&node, seq);
    let app = manager.sink();
    let image = prefs::read_prefs(&(*mgr).data_dir)
        .node_shell_image
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| nodeshell::DEFAULT_IMAGE.to_string());

    api.create(&PostParams::default(), &nodeshell::debug_pod_spec(&node, &image, &pod_name))
        .await?;

    // From here on the pod exists, so any failure must clean up after itself rather
    // than leave a privileged pod behind on the strength of an error return.
    if let Err(e) = nodeshell::await_debug_pod(&api, &pod_name).await {
        nodeshell::delete_debug_pod(&api, &pod_name).await;
        return Err(e);
    }

    let id = format!("nsh-{pod_name}");
    let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(64);
    let (resize_tx, resize_rx) = mpsc::channel::<(u16, u16)>(8);
    let id_for_task = id.clone();
    let pod_for_task = pod_name.clone();
    let task = tokio::spawn(async move {
        exec::run_argv(
            client,
            app,
            id_for_task,
            nodeshell::DEBUG_NAMESPACE.to_string(),
            pod_for_task,
            "debug".to_string(),
            nodeshell::nsenter_cmd(),
            input_rx,
            resize_rx,
        )
        .await;
    });

    manager.add_shell(id.clone(), ShellSession { task, input_tx, resize_tx }).await;
    Ok(NodeShellInfo {
        stream_id: id,
        namespace: nodeshell::DEBUG_NAMESPACE.to_string(),
        pod: pod_name,
    })
}

/// Stop a node shell and delete its pod (idempotent).
///
/// Deliberately separate from `stop_shell`: that only aborts the pump task, and an
/// aborted task cannot run async cleanup on the way out. Deleting here — outside
/// the task — is what makes teardown actually reliable. The pod's
/// `activeDeadlineSeconds` remains the backstop for the case where this never runs
/// at all.
#[tauri::command]
pub async fn stop_node_shell(
    stream_id: String,
    pod: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    (*mgr).manager.remove_shell(&stream_id).await;
    if let Some(client) = (*mgr).manager.client().await {
        let api: Api<k8s_openapi::api::core::v1::Pod> =
            Api::namespaced(client, nodeshell::DEBUG_NAMESPACE);
        nodeshell::delete_debug_pod(&api, &pod).await;
    }
    Ok(())
}

/// Send keystrokes to a shell session.
#[tauri::command]
pub async fn shell_input(
    stream_id: String,
    data: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    (*mgr).manager.shell_input(&stream_id, data.into_bytes()).await;
    Ok(())
}

/// Resize a shell session's terminal.
#[tauri::command]
pub async fn shell_resize(
    stream_id: String,
    cols: u16,
    rows: u16,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    (*mgr).manager.shell_resize(&stream_id, cols, rows).await;
    Ok(())
}

/// Stop a shell session (idempotent).
#[tauri::command]
pub async fn stop_shell(stream_id: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    (*mgr).manager.remove_shell(&stream_id).await;
    Ok(())
}

// --------------------------------------------------------------------------
// Port-forwarding (B6, B16)
// --------------------------------------------------------------------------

/// Start forwarding a pod port to a local TCP port; returns the forward (with the
/// chosen local port). Errors if the pod doesn't exist or the listener can't bind.
#[tauri::command]
pub async fn start_port_forward(
    namespace: String,
    pod: String,
    remote_port: u16,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<ForwardDto> {
    let client = require_client(&(*mgr).manager).await?;
    let manager: Arc<ClientManager> = (&(*mgr)).manager.clone();

    // Fail fast with a clear message if the pod is gone.
    portforward::ensure_pod(client.clone(), &namespace, &pod).await?;

    spawn_forward(manager, client, namespace, pod, None, remote_port).await
}

/// Start forwarding a *Service* port (B16): pick a Ready backing pod and resolve
/// the service port's targetPort, then forward to that pod exactly as above.
///
/// This is what `kubectl port-forward svc/x` does — Kubernetes has no service-level
/// forward — so the forward follows one pod and does not load-balance.
#[tauri::command]
pub async fn start_service_port_forward(
    namespace: String,
    service: String,
    remote_port: u16,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<ForwardDto> {
    let client = require_client(&(*mgr).manager).await?;
    let manager: Arc<ClientManager> = (&(*mgr)).manager.clone();

    let (pod, target_port) =
        portforward::resolve_service(client.clone(), &namespace, &service, remote_port).await?;

    spawn_forward(manager, client, namespace, pod, Some((service, remote_port)), target_port).await
}

/// Bind a local listener, spawn the forward's accept loop, and register it.
/// Shared by the pod and Service paths — by this point a Service forward *is* a
/// pod forward.
async fn spawn_forward(
    manager: Arc<ClientManager>,
    client: kube::Client,
    namespace: String,
    pod: String,
    // For a Service forward: its name and the port the user asked for.
    service: Option<(String, u16)>,
    remote_port: u16,
) -> AppResult<ForwardDto> {
    let (ready_tx, ready_rx) = oneshot::channel::<Result<u16, String>>();
    // Bounded: per-connection errors are for display, so a full channel just means
    // the failure is already reported.
    let (err_tx, mut err_rx) = mpsc::channel::<String>(8);

    let ns = namespace.clone();
    let p = pod.clone();
    let task = tokio::spawn(async move {
        portforward::run_port_forward(client, ns, p, remote_port, ready_tx, err_tx).await;
    });

    // Wait for the listener to bind (or report the bind error).
    let local_port = ready_rx
        .await
        .map_err(|_| AppError::Other("port-forward task ended before binding".into()))?
        .map_err(AppError::Kube)?;

    let (service_name, service_port) = match service {
        // Only carry the service port when it differs; an identical one is noise.
        Some((name, port)) => (Some(name), (port != remote_port).then_some(port)),
        None => (None, None),
    };
    let label = service_name.clone().unwrap_or_else(|| pod.clone());
    let id = format!("pf-{}-{}", label, STREAM_SEQ.fetch_add(1, Ordering::Relaxed));
    let dto = ForwardDto {
        id: id.clone(),
        namespace,
        pod,
        service: service_name,
        remote_port,
        service_port,
        local_port,
        error: None,
    };
    manager.add_forward(dto.clone(), task).await;

    // Relay per-connection failures onto the forward for the UI. Ends on its own
    // when the forward task is aborted and drops the sender.
    let relay_mgr = manager.clone();
    let relay = tokio::spawn(async move {
        while let Some(e) = err_rx.recv().await {
            relay_mgr.set_forward_error(&id, e).await;
        }
    });
    manager.push_task(relay).await;

    Ok(dto)
}

/// Stop a port-forward (idempotent).
#[tauri::command]
pub async fn stop_port_forward(id: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    (*mgr).manager.remove_forward(&id).await;
    Ok(())
}

/// List active port-forwards.
#[tauri::command]
pub async fn list_port_forwards(mgr: State<'_, Arc<CoreState>>) -> AppResult<Vec<ForwardDto>> {
    Ok((*mgr).manager.list_forwards().await)
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

/// Get the active client or a friendly "not connected" error.
async fn require_client(mgr: &ClientManager) -> AppResult<kube::Client> {
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
    e.creation_timestamp().map(|t| t.0).unwrap_or_else(|| chrono::DateTime::<chrono::Utc>::UNIX_EPOCH)
}

/// Humanized age of an event's last occurrence (e.g. "2m").
fn event_age(e: &Event) -> String {
    let secs = (chrono::Utc::now() - last_seen(e)).num_seconds().max(0);
    mappers::humanize_duration(secs)
}

// ---------------------------------------------------------------------------
// Helm marketplace (Phase 1 of KubePi parity) — repo CRUD + chart search.
// ---------------------------------------------------------------------------

/// Seed the default chart repos on first launch. Called from `setup`.
#[tauri::command]
pub fn helm_seed_repos() -> AppResult<()> {
    helm_market::seed_default_repos()
}

/// List the user's helm chart repositories (sorted most-recently-touched first).
#[tauri::command]
pub fn helm_list_repos() -> AppResult<Vec<helm_market::HelmRepo>> {
    helm_market::list_repos()
}

/// Add a new chart repo. Returns the freshly-created entry.
#[tauri::command]
pub fn helm_add_repo(
    name: String,
    url: String,
    description: String,
) -> AppResult<helm_market::HelmRepo> {
    helm_market::add_repo(&name, &url, &description)
}

/// Remove a chart repo and its cached index.
#[tauri::command]
pub fn helm_remove_repo(name: String) -> AppResult<()> {
    helm_market::remove_repo(&name)
}

/// Re-fetch one repo's index from its URL. On failure the repo's
/// `last_error` is set and the error is returned to the caller so the UI
/// can surface a red dot.
#[tauri::command]
pub async fn helm_update_repo(name: String) -> AppResult<helm_market::HelmRepo> {
    helm_market::update_repo_index(&name).await
}

/// Re-fetch every repo's index, in parallel. Per-repo failures are logged
/// but do not short-circuit the rest.
#[tauri::command]
pub async fn helm_update_all_repos() -> AppResult<Vec<helm_market::HelmRepo>> {
    helm_market::update_all_indexes().await
}

/// Search across every cached index. Empty query returns everything
/// (the "browse" view). Results are sorted by version desc, name asc.
#[tauri::command]
pub fn helm_search_charts(query: String) -> AppResult<Vec<helm_market::ChartSummary>> {
    helm_market::search_charts(&query)
}

/// All known versions of one (repo, chart) pair, newest first.
#[tauri::command]
pub fn helm_chart_versions(
    repo: String,
    chart: String,
) -> AppResult<Vec<helm_market::ChartVersionEntry>> {
    helm_market::chart_versions(&repo, &chart)
}

/// Export a chart .tgz to a local directory (air-gap / offline).
#[tauri::command]
pub async fn helm_export_chart(
    repo: String,
    chart: String,
    version: String,
    output_dir: String,
) -> AppResult<String> {
    let path = helm_market::export_chart(&repo, &chart, &version, &output_dir).await?;
    Ok(path.to_string_lossy().to_string())
}

/// Import a local chart .tgz into the chart cache.
#[tauri::command]
pub fn helm_import_chart(
    file_path: String,
    repo_name: String,
) -> AppResult<String> {
    let path = helm_market::import_chart(&file_path, &repo_name)?;
    Ok(path.to_string_lossy().to_string())
}

/// List locally imported chart archives for a repo.
#[tauri::command]
pub fn helm_local_charts(repo_name: String) -> AppResult<Vec<String>> {
    helm_market::list_local_charts(&repo_name)
}

/// Default values.yaml for a chart at a given version. Delegates to
/// `helm show values` so we don't re-implement chart parsing in Rust.
#[tauri::command]
pub async fn helm_render_default_values(
    chart: String,
    version: String,
    kubeconfig: Option<String>,
) -> AppResult<String> {
    helm_ops::render_default_values(&chart, &version, kubeconfig.as_deref()).await
}

// ---------------------------------------------------------------------------
// Helm release ops (install/upgrade/uninstall/rollback + history).
// ---------------------------------------------------------------------------

/// Run a helm operation (install/upgrade/uninstall/rollback) to completion.
/// Streams `helm-op-log` and `helm-op-done` events for the UI to render live.
#[tauri::command]
pub async fn helm_run_op(
    op: helm_ops::HelmOp,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<helm_ops::HelmOpResult> {
    // The frontend doesn't track a per-connection EventSink directly; pull it
    // off the manager. The Tauri sink in `core::events` is what the manager
    // already uses, so re-using it here means helm log lines reach the same
    // webview that called us.
    let sink = (*mgr).manager.sink().clone();
    helm_ops::run_op(op, sink).await
}

/// Fetch the revision history for a release.
#[tauri::command]
pub async fn helm_release_history(
    release: String,
    namespace: String,
    kubeconfig: Option<String>,
) -> AppResult<Vec<helm_ops::RevisionEntry>> {
    helm_ops::release_history(&release, &namespace, kubeconfig.as_deref()).await
}

// ---------------------------------------------------------------------------
// Pod file management (Phase 2 of KubePi parity) — browse / read / write /
// download / upload inside a running pod's container.
// ---------------------------------------------------------------------------

/// List a directory inside a pod's container. Returns file / dir / symlink
/// entries with sizes, mtimes, and POSIX modes.
#[tauri::command]
pub async fn pod_files_list(
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<pod_files::FileEntry>> {
    let client = require_client(&(*mgr).manager).await?;
    pod_files::list_dir(client, &namespace, &pod, container.as_deref(), &path).await
}

/// Read a file's text contents. Returns UTF-8 lossy so logs/configs work
/// even if the bytes aren't valid UTF-8 (e.g. UTF-16 BOM'd files).
#[tauri::command]
pub async fn pod_files_read(
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<String> {
    let client = require_client(&(*mgr).manager).await?;
    pod_files::read_file(client, &namespace, &pod, container.as_deref(), &path).await
}

/// Write a file's contents inside a container. Creates parent directories
/// as needed.
#[tauri::command]
pub async fn pod_files_write(
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
    content: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    let client = require_client(&(*mgr).manager).await?;
    pod_files::write_file(client, &namespace, &pod, container.as_deref(), &path, &content).await
}

/// Download a path as a tar archive. The frontend turns the bytes into a
/// user-saved file.
#[tauri::command]
pub async fn pod_files_download(
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<u8>> {
    let client = require_client(&(*mgr).manager).await?;
    pod_files::download_path(client, &namespace, &pod, container.as_deref(), &path).await
}

/// Upload a tar archive (bytes) into a directory inside a container.
#[tauri::command]
pub async fn pod_files_upload(
    namespace: String,
    pod: String,
    container: Option<String>,
    dest_dir: String,
    tar_b64: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&tar_b64)
        .map_err(|e| AppError::Other(format!("base64 decode: {e}")))?;
    let client = require_client(&(*mgr).manager).await?;
    pod_files::upload_path(client, &namespace, &pod, container.as_deref(), &dest_dir, &bytes).await
}

// ---------------------------------------------------------------------------
// Image registry management (Phase 5 of KubePi parity).
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn image_registry_list() -> AppResult<Vec<imagerepo::ImageRegistry>> {
    imagerepo::list_registries()
}

#[tauri::command]
pub fn image_registry_upsert(
    name: String,
    url: String,
    username: String,
    password: String,
    insecure: bool,
    description: String,
) -> AppResult<imagerepo::ImageRegistry> {
    imagerepo::upsert_registry(&name, &url, &username, &password, insecure, &description)
}

#[tauri::command]
pub fn image_registry_remove(name: String) -> AppResult<()> {
    imagerepo::remove_registry(&name)
}

#[tauri::command]
pub async fn image_registry_test(name: String) -> AppResult<()> {
    let reg = imagerepo::list_registries()?
        .into_iter()
        .find(|r| r.name == name)
        .ok_or_else(|| AppError::NotFound(format!("registry '{name}' not found")))?;
    imagerepo::test_connect(&reg).await
}

#[tauri::command]
pub async fn image_registry_repos(name: String) -> AppResult<Vec<imagerepo::RepoEntry>> {
    let reg = imagerepo::list_registries()?
        .into_iter()
        .find(|r| r.name == name)
        .ok_or_else(|| AppError::NotFound(format!("registry '{name}' not found")))?;
    imagerepo::list_repositories(&reg).await
}

#[tauri::command]
pub async fn image_registry_tags(
    name: String,
    repo: String,
) -> AppResult<Vec<imagerepo::TagEntry>> {
    let reg = imagerepo::list_registries()?
        .into_iter()
        .find(|r| r.name == name)
        .ok_or_else(|| AppError::NotFound(format!("registry '{name}' not found")))?;
    imagerepo::list_tags(&reg, &repo).await
}

// ---------------------------------------------------------------------------
// Multi-document YAML apply (Phase 4 — used by the templates feature).
// ---------------------------------------------------------------------------

/// Apply a multi-document YAML bundle. Returns one `ApplyResult` per doc,
/// with `action` set to "created", "updated", or "failed" and a per-doc
/// error message on failure.
#[tauri::command]
pub async fn apply_yaml_bundle(
    yaml: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<templates::ApplyResult>> {
    let client = require_client(&(*mgr).manager).await?;
    templates::multi_apply(&yaml, client, &(*mgr).manager).await
}

/// Dry-run a multi-document YAML bundle without writing (YAML-import create
/// mode's Preview step). The single-doc `dry_run_yaml` can't handle a
/// multi-kind create bundle, so this reuses `templates::multi_dry_run`.
#[tauri::command]
pub async fn dry_run_yaml_bundle(
    yaml: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<templates::DocDryRun>> {
    let client = require_client(&(*mgr).manager).await?;
    templates::multi_dry_run(&yaml, client).await
}

// ---------------------------------------------------------------------------
// Image import (air-gapped clusters) — load a local .tar into a node's
// container runtime via a temporary privileged pod. Desktop only (the file
// path comes from the native picker); the web shell has no local-disk access.
// ---------------------------------------------------------------------------

/// Soft cap on a single import's tar size. Real images rarely exceed a few GB;
/// this guards against a typo'd path to a disk image OOMing the app. Tunable
/// later via prefs if real-world images are larger.
const IMAGE_IMPORT_MAX_BYTES: u64 = 8 * 1024 * 1024 * 1024; // 8 GiB

/// Import a local `.tar` image archive into a node's container runtime.
///
/// `path` is an absolute filesystem path from `tauri-plugin-dialog`'s native
/// picker. The file is read server-side (not base64 over IPC) because a tar
/// can be gigabytes; streaming one through the frontend would balloon memory.
#[tauri::command]
pub async fn import_image_to_node(
    node: String,
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<imageimport::ImportResult> {
    let client = require_client(&(*mgr).manager).await?;
    // Stat first so a path to a huge file fails fast with a clear message
    // rather than reading 8 GiB into RAM before refusing.
    let meta = std::fs::metadata(&path)
        .map_err(|e| AppError::Other(format!("read file '{}': {e}", path)))?;
    if meta.len() > IMAGE_IMPORT_MAX_BYTES {
        return Err(AppError::Other(format!(
            "file is {} bytes, exceeds the {} byte import cap",
            meta.len(),
            IMAGE_IMPORT_MAX_BYTES
        )));
    }
    let tar_bytes = std::fs::read(&path)
        .map_err(|e| AppError::Other(format!("read file '{}': {e}", path)))?;
    imageimport::import_to_node(client, &node, &tar_bytes).await
}

// ---------------------------------------------------------------------------
// Image sync (skopeo) — copy an image into a configured private registry.
// Air-gapped clusters with an internal registry use this; the per-node
// `import_image_to_node` above is for clusters with no registry at all. These
// bridge the MCP-only `image_sync` module to the Tauri UI. Progress streams
// over the shared event sink as `image-sync-log` / `image-sync-done` events.
// ---------------------------------------------------------------------------

/// Whether skopeo is installed and usable on this host. Cheap (`skopeo
/// --version`), so the UI can call it on panel open to gate the To-Registry
/// tab.
#[tauri::command]
pub async fn image_sync_status() -> AppResult<image_sync::SkopeoAvailability> {
    Ok(image_sync::check_skopeo().await)
}

/// Copy an image into a configured destination registry via `skopeo copy`.
/// `source` is any skopeo transport (`docker://nginx:1.25`,
/// `docker-archive:/tmp/img.tar`, `oci:…`); the destination registry is
/// resolved by name from the stored image-registries config (its credentials
/// are used automatically). Streams each stdout/stderr line as an
/// `image-sync-log` event so the UI can render a live progress log.
#[tauri::command]
pub async fn image_copy(
    source: String,
    dest_registry: String,
    dest_repo: String,
    dest_tag: String,
    src_creds: Option<String>,
    insecure_src: bool,
    insecure_dest: bool,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<image_sync::ImageSyncResult> {
    let sink = (*mgr).manager.sink();
    image_sync::copy_image(
        &source,
        &dest_registry,
        &dest_repo,
        &dest_tag,
        src_creds.as_deref(),
        insecure_src,
        insecure_dest,
        sink,
    )
    .await
}

/// Inspect a local `docker save` tarball before copying it: returns the image
/// name, tags, digest, architecture, os, and total size. Lets the user confirm
/// a tar's contents (and that it's linux/amd64) before pushing.
#[tauri::command]
pub async fn image_inspect_archive(tar_path: String) -> AppResult<image_archive::ArchiveInfo> {
    image_archive::inspect_archive(&tar_path).await
}

// ---------------------------------------------------------------------------
// Endpoints (Phase 1 Tier-2 of KubePi parity) — drilling into "Service has
// no endpoints" is the canonical 503 debugging path, and the Endpoints
// object is the thing to look at.
// ---------------------------------------------------------------------------

/// List EndpointSlices cluster-wide. One row per slice, with the
/// ready/total address count so 503s are obvious at a glance.
#[tauri::command]
pub async fn list_endpoints(mgr: State<'_, Arc<CoreState>>) -> AppResult<Vec<endpoints::EndpointRow>> {
    let client = require_client(&(*mgr).manager).await?;
    endpoints::list_all(&client).await
}

/// EndpointSlices for a single Service — the row context menu's
/// "View endpoints" action.
#[tauri::command]
pub async fn list_endpoints_for_service(
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<endpoints::EndpointRow>> {
    let client = require_client(&(*mgr).manager).await?;
    endpoints::list_for_service(&client, &namespace, &name).await
}

/// Per-address detail for one EndpointSlice.
#[tauri::command]
pub async fn list_endpoint_addresses(
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<endpoints::EndpointAddress>> {
    let client = require_client(&(*mgr).manager).await?;
    endpoints::addresses_for(&client, &namespace, &name).await
}

// ---------------------------------------------------------------------------
// CronJob manual trigger (Phase 2 Tier-2 of KubePi parity) — KubePi has a
// "Run now" action for jobs whose schedule doesn't align with the moment
// you need them.
// ---------------------------------------------------------------------------

/// Manually create a Job from a CronJob. Mirrors what
/// `kubectl create job --from=cronjob/<name>` does, and returns the new
/// Job's name so the UI can navigate to it.
#[tauri::command]
pub async fn trigger_cronjob(
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<String> {
    use k8s_openapi::api::batch::v1::{CronJob, Job};
    use k8s_openapi::apimachinery::pkg::apis::meta::v1::{ObjectMeta, OwnerReference};
    use kube::api::PostParams;

    let client = require_client(&(*mgr).manager).await?;
    let cj_api: Api<CronJob> = Api::namespaced(client.clone(), &namespace);
    let cj = cj_api.get(&name).await?;
    let job_name = format!("{name}-manual-{}", chrono::Utc::now().timestamp());
    let job = Job {
        metadata: ObjectMeta {
            name: Some(job_name.clone()),
            namespace: Some(namespace.clone()),
            annotations: Some({
                let mut m = std::collections::BTreeMap::new();
                m.insert(
                    "cronjob.kubernetes.io/instantiate".to_string(),
                    "manual".to_string(),
                );
                m
            }),
            owner_references: Some(vec![OwnerReference {
                api_version: "batch/v1".to_string(),
                kind: "CronJob".to_string(),
                name,
                uid: cj.metadata.uid.unwrap_or_default(),
                controller: Some(true),
                ..Default::default()
            }]),
            ..Default::default()
        },
        spec: cj.spec.and_then(|s| s.job_template.spec),
        ..Default::default()
    };
    let job_api: Api<Job> = Api::namespaced(client, &namespace);
    job_api
        .create(&PostParams::default(), &job)
        .await
        .map_err(|e| AppError::Kube(format!("create job: {e}")))?;
    Ok(job_name)
}

// ---------------------------------------------------------------------------
// Metrics / Prometheus multi-instance (Phase 1 Tier-2 of KubePi parity).
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn metrics_list() -> AppResult<Vec<metrics_config::MetricsConfig>> {
    metrics_config::list()
}

#[tauri::command]
pub fn metrics_upsert(
    name: String,
    url: String,
    username: String,
    password: String,
    description: String,
) -> AppResult<metrics_config::MetricsConfig> {
    metrics_config::upsert(&name, &url, &username, &password, &description)
}

#[tauri::command]
pub fn metrics_remove(name: String) -> AppResult<()> {
    metrics_config::remove(&name)
}

#[tauri::command]
pub async fn metrics_test(name: String) -> AppResult<()> {
    metrics_config::test_connect(&name).await
}

#[tauri::command]
pub async fn metrics_query(name: String, promql: String) -> AppResult<metrics_config::QueryResult> {
    metrics_config::query(&name, &promql).await
}

#[tauri::command]
pub async fn metrics_query_range(
    name: String,
    promql: String,
    start_ms: i64,
    end_ms: i64,
    step_seconds: i64,
) -> AppResult<metrics_config::QueryResult> {
    metrics_config::query_range(&name, &promql, start_ms, end_ms, step_seconds).await
}

// ---------------------------------------------------------------------------
// Grafana (Phase 1 Tier-2 of KubePi parity).
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn grafana_list() -> AppResult<Vec<grafana::GrafanaConfig>> {
    grafana::list()
}

#[tauri::command]
pub fn grafana_upsert(
    name: String,
    url: String,
    username: String,
    password: String,
    api_token: String,
    default_datasource: String,
    description: String,
) -> AppResult<grafana::GrafanaConfig> {
    grafana::upsert(
        &name,
        &url,
        &username,
        &password,
        &api_token,
        &default_datasource,
        &description,
    )
}

#[tauri::command]
pub fn grafana_remove(name: String) -> AppResult<()> {
    grafana::remove(&name)
}

#[tauri::command]
pub async fn grafana_test(name: String) -> AppResult<()> {
    grafana::test_connect(&name).await
}

#[tauri::command]
pub fn grafana_presets() -> Vec<grafana::DashboardPreset> {
    grafana::preset_dashboards()
}

#[tauri::command]
pub fn grafana_dashboard_url(
    name: String,
    uid: String,
    from_ms: i64,
    to_ms: i64,
) -> AppResult<String> {
    grafana::dashboard_url(&name, &uid, from_ms, to_ms)
}

#[tauri::command]
pub async fn grafana_search_dashboards(
    name: String,
    query: String,
) -> AppResult<Vec<grafana::DashboardSearchResult>> {
    grafana::search_dashboards(&name, &query).await
}

// ---------------------------------------------------------------------------
// AlertManager (Phase 1 Tier-2 of KubePi parity).
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn alertmanager_list() -> AppResult<Vec<alerting::AlertManager>> {
    alerting::list()
}

#[tauri::command]
pub fn alertmanager_upsert(
    name: String,
    url: String,
    bearer_token: String,
    description: String,
) -> AppResult<alerting::AlertManager> {
    alerting::upsert(&name, &url, &bearer_token, &description)
}

#[tauri::command]
pub fn alertmanager_remove(name: String) -> AppResult<()> {
    alerting::remove(&name)
}

#[tauri::command]
pub async fn alertmanager_test(name: String) -> AppResult<()> {
    alerting::test_connect(&name).await
}

#[tauri::command]
pub async fn alertmanager_alerts(name: String) -> AppResult<Vec<alerting::Alert>> {
    alerting::list_alerts(&name).await
}

#[tauri::command]
pub async fn alertmanager_silences(name: String) -> AppResult<Vec<alerting::Silence>> {
    alerting::list_silences(&name).await
}

#[tauri::command]
pub async fn alertmanager_create_silence(
    instance: String,
    request: alerting::CreateSilenceRequest,
) -> AppResult<String> {
    alerting::create_silence(&instance, &request).await
}

#[tauri::command]
pub async fn alertmanager_delete_silence(
    instance: String,
    silence_id: String,
) -> AppResult<()> {
    alerting::delete_silence(&instance, &silence_id).await
}

#[tauri::command]
pub async fn prometheus_rules(
    instance: String,
) -> AppResult<Vec<alerting::RuleGroup>> {
    alerting::prometheus_rules(&instance).await
}

// ---------------------------------------------------------------------------
// Loki / K8s Audit log (Phase 3 — KubePi parity).
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn loki_list() -> AppResult<Vec<audit::LokiConfig>> {
    audit::list()
}

#[tauri::command]
pub fn loki_upsert(
    name: String,
    url: String,
    username: String,
    password: String,
    description: String,
) -> AppResult<audit::LokiConfig> {
    audit::upsert(&name, &url, &username, &password, &description)
}

#[tauri::command]
pub fn loki_remove(name: String) -> AppResult<()> {
    audit::remove(&name)
}

#[tauri::command]
pub async fn loki_test(name: String) -> AppResult<()> {
    audit::test_connect(&name).await
}

#[tauri::command]
pub async fn audit_events(query: audit::AuditQuery) -> AppResult<Vec<audit::AuditEvent>> {
    audit::query_audit_events(&query).await
}

// ---------------------------------------------------------------------------
// Saved PromQL queries (Phase 2 — named queries + in-memory cache).
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn saved_queries_list() -> AppResult<Vec<saved_queries::SavedQuery>> {
    saved_queries::list()
}

#[tauri::command]
pub fn saved_queries_upsert(query: saved_queries::SavedQuery) -> AppResult<saved_queries::SavedQuery> {
    saved_queries::upsert(query)
}

#[tauri::command]
pub fn saved_queries_remove(name: String) -> AppResult<()> {
    saved_queries::remove(&name)
}

#[tauri::command]
pub fn saved_queries_clear_cache() {
    saved_queries::clear_cache();
}

#[tauri::command]
pub async fn saved_queries_run(
    query: saved_queries::SavedQuery,
    instance: String,
    force_refresh: bool,
) -> AppResult<metrics_config::QueryResult> {
    saved_queries::run_saved(&query, &instance, force_refresh).await
}

// ---------------------------------------------------------------------------
// Image manifest drill-down.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn image_registry_manifest(
    name: String,
    repo: String,
    tag: String,
) -> AppResult<imagerepo::ImageManifest> {
    let reg = imagerepo::list_registries()?
        .into_iter()
        .find(|r| r.name == name)
        .ok_or_else(|| AppError::NotFound(format!("registry '{name}' not found")))?;
    imagerepo::manifest(&reg, &repo, &tag).await
}


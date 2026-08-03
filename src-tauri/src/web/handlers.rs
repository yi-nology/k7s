//! HTTP handlers — the read-mostly command surface for the browser.
//!
//! Every command is a thin wrapper that calls into the same `core::kube::*`
//! business logic the Tauri shell uses, just behind a `POST /invoke/{cmd}`
//! route instead of a `#[tauri::command]` attribute. The wire payload is
//! JSON in / JSON out; types match `crate::kube::dto::*` 1:1 so the
//! front-end can use the same TypeScript types it already has for the
//! Tauri shell.
//!
//! ## What's implemented
//!
//! Read-mostly commands: `list_contexts`, `connect`, `get_yaml`, `get_events`,
//! `get_properties`, `load_prefs`, `save_prefs`, `default_kubeconfig_path`.
//!
//! ## What's stubbed (501)
//!
//! Mutations and long-lived sessions: `apply_yaml`, `delete_resource`,
//! `scale_resource`, `*_shell*`, `*_port_forward*`, `start_log_stream`, etc.
//! These are non-trivial to bridge through HTTP+SSE (websocket vs SSE, stop
//! signals, server-side deadlines) and weren't on the critical path for
//! "see a real cluster in the browser". They get added in the next pass —
//! the stubs make the unimplemented state obvious to the front-end.

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use kube::ResourceExt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::core::CoreState;
use crate::error::{AppError, AppResult};
use crate::kube::{
    client::{self, ClusterInfo, ContextInfo},
    discovery, properties, watchers,
    manager::{ConnectionInfo, ImportedContext},
};
use k8s_openapi::api::core::v1::Event;
use kube::api::{Api, ListParams};
use kube::config::Kubeconfig;

use super::state::WebState;

// ---------------------------------------------------------------------------
// Shared types: every command has the same shape on the wire.
// ---------------------------------------------------------------------------

/// The shape every successful `POST /invoke/{cmd}` returns. `data` is a
/// per-command JSON value; the front-end types assert on it.
#[derive(Serialize)]
pub struct InvokeResponse<T: Serialize> {
    pub ok: bool,
    pub data: T,
}

/// The shape every failed `POST /invoke/{cmd}` returns. `error` is the
/// message string the back-end gave us; the front-end displays it inline.
#[derive(Serialize)]
pub struct InvokeError {
    pub ok: bool,
    pub error: String,
}

impl<T: Serialize> IntoResponse for InvokeResponse<T> {
    fn into_response(self) -> axum::response::Response {
        Json(self).into_response()
    }
}

impl IntoResponse for InvokeError {
    fn into_response(self) -> axum::response::Response {
        // 200 with `{ ok: false, error }` so the front-end can deserialise
        // uniformly; some shells prefer 4xx for errors but k7s's existing
        // Tauri contract is to throw, which Tauri maps to a rejected promise
        // — the front-end handles both via `try/catch`. The HTTP analogue
        // here is "the request succeeded, the command didn't".
        (StatusCode::OK, Json(self)).into_response()
    }
}

/// Convenience: convert an `AppResult<T>` into the right response type.
fn respond<T: Serialize>(r: AppResult<T>) -> axum::response::Response {
    match r {
        Ok(data) => InvokeResponse { ok: true, data }.into_response(),
        Err(e) => InvokeError { ok: false, error: e.to_string() }.into_response(),
    }
}

// ---------------------------------------------------------------------------
// Body shapes (the JSON the front-end POSTs for each command).
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ConnectArgs {
    pub context: String,
}

#[derive(Deserialize)]
pub struct GetYamlArgs {
    pub kind: String,
    pub namespace: String,
    pub name: String,
}

#[derive(Deserialize)]
pub struct GetEventsArgs {
    pub kind: String,
    pub namespace: String,
    pub name: String,
}

#[derive(Deserialize)]
pub struct GetPropertiesArgs {
    pub kind: String,
    pub namespace: String,
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyYamlArgs {
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub yaml: String,
}

#[derive(Deserialize)]
pub struct SavePrefsArgs {
    pub prefs: prefs_io::Prefs,
}

/// `POST /invoke/import_kubeconfig_content` — body: a kubeconfig file's
/// filename and its raw YAML. The web shell sends the file's bytes after
/// reading it with the browser's `<input type="file">`; the desktop Tauri
/// shell reads the file path with its native dialog and goes through
/// `commands::import_kubeconfig` instead. Both register the imported
/// contexts in the manager so `connect` later can find which file a context
/// came from (B17).
#[derive(Deserialize)]
pub struct ImportKubeconfigContentArgs {
    /// Just the filename — the file's bytes are in `contents`, the path
    /// doesn't exist on the server. Used as the label in the switcher and
    /// for `restore_imports` on next boot.
    pub filename: String,
    pub contents: String,
}

#[derive(Deserialize, Default)]
pub struct EmptyArgs {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLogStreamArgs {
    pub namespace: String,
    pub pod: String,
    pub container: String,
    pub tail: Option<i64>,
    pub since_time: Option<String>,
    pub since_seconds: Option<i64>,
    pub previous: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopLogStreamArgs {
    pub stream_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportLogsArgs {
    pub namespace: String,
    pub pod: String,
    pub container: String,
    pub since_seconds: Option<i64>,
    pub previous: bool,
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResourceArgs {
    pub kind: String,
    pub namespace: String,
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaleResourceArgs {
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub replicas: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCordonArgs {
    pub name: String,
    pub unschedulable: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestartPodArgs {
    pub namespace: String,
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestartRolloutArgs {
    pub kind: String,
    pub namespace: String,
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrainNodeArgs {
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartShellArgs {
    pub namespace: String,
    pub pod: String,
    pub container: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellInputArgs {
    pub stream_id: String,
    pub data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellResizeArgs {
    pub stream_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopShellArgs {
    pub stream_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartNodeShellArgs {
    pub node: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopNodeShellArgs {
    pub stream_id: String,
    pub pod: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DryRunYamlArgs {
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub yaml: String,
}

/// Args for `dry_run_yaml_bundle` — just the multi-doc YAML string. Each
/// document's apiVersion/kind/namespace/name are read from the doc itself.
#[derive(Debug, Deserialize)]
pub struct DryRunYamlBundleArgs {
    pub yaml: String,
}

// ---------------------------------------------------------------------------
// list_contexts
// ---------------------------------------------------------------------------

/// `POST /invoke/list_contexts` — list kubeconfig contexts (with imports).
pub async fn list_contexts(
    State(state): State<WebState>,
) -> axum::response::Response {
    let core = state.core.clone();
    let result = merged_contexts(&core).await;
    respond(Ok(result))
}

async fn merged_contexts(core: &Arc<CoreState>) -> Vec<ContextInfo> {
    let mut merged = client::list_contexts().unwrap_or_default();
    let existing: std::collections::HashSet<String> =
        merged.iter().map(|c| c.name.clone()).collect();
    for (name, imp) in core.manager.imports().await {
        if !existing.contains(&name) {
            merged.push(ContextInfo { name, cluster: imp.cluster, current: false });
        }
    }
    merged
}

// ---------------------------------------------------------------------------
// default_kubeconfig_path
// ---------------------------------------------------------------------------

/// `POST /invoke/default_kubeconfig_path` — no body.
pub async fn default_kubeconfig_path() -> axum::response::Response {
    respond(Ok(client::default_kubeconfig_path()))
}

// ---------------------------------------------------------------------------
// status — what the connection banner reads on every poll. Cheaper than
// `try-read-then-handle-Disconnected` for the front-end: a single GET
// returns `connected` (bool) plus the cluster identity, regardless of
// whether anything is loaded yet.
// ---------------------------------------------------------------------------

/// `GET /api/status` — no body. The render side of the connection banner:
/// `connected: false` until `connect` has succeeded, then `connected: true`
/// with the context / server / version. The fields are `null` (not absent)
/// when disconnected so the client code can do a single destructuring with
/// defaults instead of branching on presence.
#[derive(Serialize)]
pub struct StatusDto {
    pub connected: bool,
    pub context: Option<String>,
    pub server: Option<String>,
    pub version: Option<String>,
    /// Number of resource watchers running on the current connection. The
    /// sidebar footer reads this; useful for diagnosing "connected but
    /// nothing is loading" before reaching for kubectl.
    pub watcher_count: usize,
}

pub async fn status(State(state): State<WebState>) -> axum::response::Response {
    let info = state.core.manager.connection_info().await;
    // `connected` is the *intersection* of "client is live" and "info is
    // populated". Both halves are set/cleared atomically with the same lock
    // in `set_connected` / `reset`, so in practice they're in lockstep —
    // but the intersection makes the invariant explicit: a half-state
    // (e.g. client leaked through `reset` due to a future refactor) would
    // surface as `connected: false` here rather than a phantom banner.
    let client_alive = state.core.manager.client().await.is_some();
    let dto = StatusDto {
        connected: client_alive && info.is_some(),
        context: info.as_ref().map(|i| i.context.clone()),
        server: info.as_ref().map(|i| i.server.clone()),
        version: info.as_ref().map(|i| i.version.clone()),
        watcher_count: if client_alive {
            // Reuse the read lock the client check just held. Cheap and
            // avoids a second write-side acquire.
            state.core.manager.watcher_count().await
        } else {
            0
        },
    };
    respond(Ok(dto))
}

// ---------------------------------------------------------------------------
// load_prefs / save_prefs
// ---------------------------------------------------------------------------

/// `POST /invoke/load_prefs` — read the prefs file under `state.core.data_dir`.
pub async fn load_prefs(State(state): State<WebState>) -> axum::response::Response {
    let path = state.core.data_dir.join("prefs.json");
    let text = std::fs::read_to_string(&path).ok();
    let prefs: Option<prefs_io::Prefs> = text.and_then(|t| serde_json::from_str(&t).ok());
    respond(Ok(prefs))
}

/// `POST /invoke/save_prefs` — write the prefs file under `state.core.data_dir`.
pub async fn save_prefs(
    State(state): State<WebState>,
    Json(args): Json<SavePrefsArgs>,
) -> axum::response::Response {
    let result: AppResult<()> = (|| -> AppResult<()> {
        let dir = &state.core.data_dir;
        std::fs::create_dir_all(dir).map_err(|e| AppError::Other(e.to_string()))?;
        let text = serde_json::to_string_pretty(&args.prefs)
            .map_err(|e| AppError::Other(e.to_string()))?;
        std::fs::write(dir.join("prefs.json"), text)
            .map_err(|e| AppError::Other(e.to_string()))?;
        Ok(())
    })();
    respond(result)
}

// ---------------------------------------------------------------------------
// import_kubeconfig_content — browser equivalent of the Tauri file dialog.
// ---------------------------------------------------------------------------

/// `POST /api/invoke/import_kubeconfig_content` — parse a kubeconfig the
/// user picked in the browser, register every context in the manager, and
/// return the merged switcher list.
pub async fn import_kubeconfig_content(
    State(state): State<WebState>,
    Json(args): Json<ImportKubeconfigContentArgs>,
) -> axum::response::Response {
    let core = state.core.clone();
    let result: AppResult<ImportResultWire> = (|| async {
        // Parse the YAML exactly like `client::contexts_from_file` does for
        // the Tauri path, so the two shells agree on the wire shape and
        // what "unparseable" looks like to the user.
        let kc = Kubeconfig::from_yaml(&args.contents)
            .map_err(|e| AppError::Kubeconfig(format!("couldn't parse {}: {e}", args.filename)))?;

        let imported: Vec<ContextInfo> = kc
            .contexts
            .iter()
            .map(|ctx| {
                let cluster = ctx
                    .context
                    .as_ref()
                    .map(|c| c.cluster.clone())
                    .unwrap_or_default();
                ContextInfo { name: ctx.name.clone(), cluster, current: false }
            })
            .collect();

        // Register each context so a later `connect` builds from this file.
        // We stash the parsed `Kubeconfig` (rather than the file path)
        // because the web shell has no real file on disk — the bytes came
        // from the user's `<input type="file">` and are gone the moment
        // they pick again.
        for ctx in &imported {
            core.manager
                .add_import(
                    ctx.name.clone(),
                    ImportedContext {
                        path: args.filename.clone(),
                        cluster: ctx.cluster.clone(),
                        kubeconfig: Some(kc.clone()),
                    },
                )
                .await;
        }

        let merged = merged_contexts(&core).await;
        Ok(ImportResultWire { contexts: merged, path: args.filename })
    })().await;
    respond(result)
}

/// Wire shape for `import_kubeconfig_content`. Mirrors the Tauri `ImportResult`
/// 1:1 so the front-end can use the same TypeScript type for both shells.
#[derive(Serialize)]
pub struct ImportResultWire {
    pub contexts: Vec<ContextInfo>,
    pub path: String,
}

/// `POST /invoke/connect` — tear down the current connection, build a
/// client for the requested context, start all watchers and pollers.
pub async fn connect(
    State(state): State<WebState>,
    Json(args): Json<ConnectArgs>,
) -> axum::response::Response {
    let core = state.core.clone();
    let result: AppResult<ClusterInfo> = (|| async {
        // Abort every task from the previous connection first.
        core.manager.reset().await;

        let context = args.context;
        // Three ways to build a client for `context`:
        //   1. It was imported from a file and the file still exists on
        //      disk (Tauri shell).
        //   2. It was imported from a file the web shell uploaded — we
        //      stashed the parsed `Kubeconfig` in the manager, use that.
        //   3. It's a context in the default kubeconfig.
        let (kube_client, server) = if let Some(kc) = core.manager.import_kubeconfig(&context).await {
            build_client_from_kubeconfig(kc, &context).await?
        } else if let Some(path) = core.manager.import_path(&context).await {
            client::build_client_from_file(&path, &context).await?
        } else {
            client::build_client(&context).await?
        };
        let version = client::probe_version(&kube_client).await?;

        // Watchers for all built-in kinds (B1).
        let watcher_count =
            watchers::spawn_all(&core.manager, kube_client.clone()).await;

        // Metrics + status pollers (B23). Default intervals — the web shell
        // doesn't have a TauriAppHandle to read prefs from. A user who tunes
        // the settings panel in the browser gets their value through the
        // next connect.
        let (metrics_task, status_task) = crate::kube::metrics::spawn_pollers(
            core.manager.sink(),
            kube_client.clone(),
            crate::kube::metrics::PollIntervals {
                metrics: crate::kube::metrics::METRICS_INTERVAL,
                status: crate::kube::metrics::STATUS_INTERVAL,
            },
        );
        let _ = core.manager.push_task(metrics_task).await;
        let _ = core.manager.push_task(status_task).await;

        // CRD discovery — the same as the Tauri `connect` does (B15).
        let custom = discovery::discover(&kube_client).await;
        core.manager.set_custom_kinds(custom.clone()).await;
        let _ = core.manager.sink().emit(crate::kube::events::CUSTOM_KINDS, &custom);

        let _ = core
            .manager
            .set_connected(
                kube_client,
                ConnectionInfo {
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
    })().await;
    respond(result)
}

// ---------------------------------------------------------------------------
// get_yaml — fetch an object's YAML. For Helm releases, decode from the
// release Secret (mirrors commands::get_yaml).
// ---------------------------------------------------------------------------

pub async fn get_yaml(
    State(state): State<WebState>,
    Json(args): Json<GetYamlArgs>,
) -> axum::response::Response {
    let result: AppResult<String> = (|| async {
        let client = core_client(&state.core).await?;
        let (api, is_helm) = dynamic_api(client.clone(), &args.kind, &args.namespace, &state.core).await?;
        if is_helm {
            return helm_manifest(client, &args.namespace, &args.name).await;
        }
        let mut obj = api.get(&args.name).await?;
        obj.metadata.managed_fields = None;
        if args.kind == "secrets" {
            redact_secret(&mut obj);
        }
        Ok(serde_yaml::to_string(&obj)?)
    })().await;
    respond(result)
}

// ---------------------------------------------------------------------------
// get_events — read events filtered by the involved object.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct WireEvent {
    #[serde(rename = "type")]
    pub ty: String,
    pub reason: String,
    pub message: String,
    pub count: i32,
    /// Pre-formatted age (e.g. "2m"); we don't try to be exact since the
    /// front-end just renders the string.
    pub age: String,
    /// Last-seen time (RFC3339), for the EventsTab time-range filter.
    #[serde(rename = "lastTimestamp", skip_serializing_if = "Option::is_none")]
    pub last_timestamp: Option<String>,
}

pub async fn get_events(
    State(state): State<WebState>,
    Json(args): Json<GetEventsArgs>,
) -> axum::response::Response {
    let result: AppResult<Vec<WireEvent>> = (|| async {
        let client = core_client(&state.core).await?;
        // Server-side field-selector, mirroring the MCP path (kube_api::get_events)
        // and `kubectl get event --field-selector`. The previous client-side
        // filter on a cluster-wide `Api::all().list()` was unreliable: it pulled
        // every event in the cluster and then dropped most of them, and on some
        // clusters returned an empty list entirely (the Dashboard/EventsTab
        // "always empty on the web path" symptom). A field-selected list is both
        // cheaper and correct.
        //
        // Map the plural kind the frontend sends to the singular Kubernetes Kind
        // the involvedObject carries. Same table the MCP path uses.
        let involved_kind = match args.kind.rsplit('/').next().unwrap_or(&args.kind) {
            "pods" => "Pod",
            "deployments" => "Deployment",
            "replicasets" => "ReplicaSet",
            "statefulsets" => "StatefulSet",
            "daemonsets" => "DaemonSet",
            "jobs" => "Job",
            "cronjobs" => "CronJob",
            "services" => "Service",
            "ingresses" => "Ingress",
            "configmaps" => "ConfigMap",
            "secrets" => "Secret",
            "persistentvolumeclaims" => "PersistentVolumeClaim",
            "nodes" => "Node",
            "namespaces" => "Namespace",
            other => other,
        };
        // Cluster-scoped kinds (nodes, namespaces, …) have no namespace; list
        // cluster-wide for them. `Api::namespaced(client, "")` would hit
        // `/api/v1/namespaces//events` and the 307 redirect breaks the kube
        // client's deserializer.
        let api: Api<Event> = if args.namespace.is_empty() {
            Api::all(client)
        } else {
            Api::namespaced(client, &args.namespace)
        };
        let lp = ListParams::default().fields(&format!(
            "involvedObject.name={},involvedObject.kind={}",
            args.name, involved_kind
        ));
        let list = api.list(&lp).await?;
        let mut out: Vec<WireEvent> = list
            .items
            .into_iter()
            .map(|e| {
                // last-seen for the EventsTab filter: prefer lastTimestamp, then
                // eventTime, then creationTimestamp. Same precedence as map_event.
                let last_ts = e
                    .last_timestamp
                    .as_ref()
                    .map(|t| t.0)
                    .or_else(|| e.event_time.as_ref().map(|t| t.0))
                    .or_else(|| e.creation_timestamp().map(|t| t.0))
                    .map(|dt| dt.to_rfc3339());
                WireEvent {
                    ty: e.type_.unwrap_or_else(|| "Normal".into()),
                    reason: e.reason.unwrap_or_default(),
                    message: e.message.unwrap_or_default(),
                    count: e.count.unwrap_or(1),
                    age: "—".into(),
                    last_timestamp: last_ts,
                }
            })
            .collect();
        // Newest first: the API server returns events in creation order (oldest
        // first), and the front-end renders them in arrival order.
        out.sort_by_key(|e| {
            // parse the RFC3339 we just built; fall back to 0 (sorts oldest) so a
            // missing timestamp can't crash the comparator.
            e.last_timestamp
                .as_deref()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.timestamp_millis())
                .unwrap_or(0)
        });
        out.reverse();
        Ok(out)
    })().await;
    respond(result)
}

// ---------------------------------------------------------------------------
// get_properties — delegate to the core helper. The shell never needs to
// know what's inside.
// ---------------------------------------------------------------------------

pub async fn get_properties(
    State(state): State<WebState>,
    Json(args): Json<GetPropertiesArgs>,
) -> axum::response::Response {
    let result: AppResult<crate::kube::properties::Properties> = (|| async {
        let client = core_client(&state.core).await?;
        properties::gather(client, &args.kind, &args.namespace, &args.name).await
    })().await;
    respond(result)
}

// ---------------------------------------------------------------------------
// Stubs for everything else: 501 Not Implemented
// ---------------------------------------------------------------------------

/// Catch-all for commands we haven't bridged yet. Returns a 501 + a clear
/// error so the front-end knows the call is unimplemented (rather than
/// silently mis-routing).
pub async fn not_implemented() -> axum::response::Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(InvokeError {
            ok: false,
            error: "this command isn't bridged through the web shell yet".to_string(),
        }),
    ).into_response()
}

// ---------------------------------------------------------------------------
// Mutation commands — share the same `dynamic_api` path the Tauri shell uses.
// The web shell reuses the same `kube` primitives (`delete`, `patch`,
// `replace`) so behaviour is identical, just with HTTP transport.
// ---------------------------------------------------------------------------

pub async fn apply_yaml(
    State(state): State<WebState>,
    Json(args): Json<ApplyYamlArgs>,
) -> axum::response::Response {
    use kube::api::{DynamicObject, PostParams};
    let result: AppResult<()> = (|| async {
        let client = core_client(&state.core).await?;
        ensure_writable(&args.kind)?;
        let obj: DynamicObject = serde_yaml::from_str(&args.yaml)?;
        let (api, _is_helm) = dynamic_api(client, &args.kind, &args.namespace, &state.core).await?;
        api.replace(&args.name, &PostParams::default(), &obj).await?;
        Ok(())
    })().await;
    respond(result)
}

pub async fn dry_run_yaml(
    State(state): State<WebState>,
    Json(args): Json<DryRunYamlArgs>,
) -> axum::response::Response {
    use kube::api::{DynamicObject, PostParams};
    let result: AppResult<commands_dto::YamlDiff> = (|| async {
        let client = core_client(&state.core).await?;
        ensure_writable(&args.kind)?;
        let obj: DynamicObject = serde_yaml::from_str(&args.yaml)?;
        let (api, _is_helm) = dynamic_api(client, &args.kind, &args.namespace, &state.core).await?;
        let mut current = api.get(&args.name).await?;
        current.metadata.managed_fields = None;
        let pp = PostParams { dry_run: true, ..Default::default() };
        let mut proposed = api.replace(&args.name, &pp, &obj).await?;
        proposed.metadata.managed_fields = None;
        Ok(commands_dto::YamlDiff {
            current: serde_yaml::to_string(&current)?,
            proposed: serde_yaml::to_string(&proposed)?,
        })
    })().await;
    respond(result)
}

/// `POST /invoke/dry_run_yaml_bundle` — multi-doc dry run for the create
/// overlay's YAML-import Preview. Delegates to `templates::multi_dry_run`.
pub async fn dry_run_yaml_bundle(
    State(state): State<WebState>,
    Json(args): Json<DryRunYamlBundleArgs>,
) -> axum::response::Response {
    let result: AppResult<Vec<crate::kube::templates::DocDryRun>> = (|| async {
        let client = core_client(&state.core).await?;
        crate::kube::templates::multi_dry_run(&args.yaml, client).await
    })()
    .await;
    respond(result)
}

pub async fn delete_resource(
    State(state): State<WebState>,
    Json(args): Json<DeleteResourceArgs>,
) -> axum::response::Response {
    use kube::api::DeleteParams;
    let result: AppResult<()> = (|| async {
        let client = core_client(&state.core).await?;
        let (api, _is_helm) = dynamic_api(client, &args.kind, &args.namespace, &state.core).await?;
        api.delete(&args.name, &DeleteParams::default()).await?;
        Ok(())
    })().await;
    respond(result)
}

pub async fn scale_resource(
    State(state): State<WebState>,
    Json(args): Json<ScaleResourceArgs>,
) -> axum::response::Response {
    use kube::api::{Patch, PatchParams};
    let result: AppResult<()> = (|| async {
        let client = core_client(&state.core).await?;
        let (api, _is_helm) = dynamic_api(client, &args.kind, &args.namespace, &state.core).await?;
        let patch = Patch::Merge(serde_json::json!({ "spec": { "replicas": args.replicas } }));
        api.patch(&args.name, &PatchParams::default(), &patch).await?;
        Ok(())
    })().await;
    respond(result)
}

pub async fn set_cordon(
    State(state): State<WebState>,
    Json(args): Json<SetCordonArgs>,
) -> axum::response::Response {
    use kube::api::{Patch, PatchParams};
    let result: AppResult<()> = (|| async {
        let client = core_client(&state.core).await?;
        let (api, _is_helm) = dynamic_api(client, "nodes", "", &state.core).await?;
        let patch = Patch::Merge(serde_json::json!({ "spec": { "unschedulable": args.unschedulable } }));
        api.patch(&args.name, &PatchParams::default(), &patch).await?;
        Ok(())
    })().await;
    respond(result)
}

pub async fn restart_pod(
    State(state): State<WebState>,
    Json(args): Json<RestartPodArgs>,
) -> axum::response::Response {
    use kube::api::{Api, DeleteParams};
    let result: AppResult<()> = (|| async {
        let client = core_client(&state.core).await?;
        let api: Api<k8s_openapi::api::core::v1::Pod> = Api::namespaced(client, &args.namespace);
        let pod = api.get(&args.name).await?;
        if !crate::kube::restart::has_controller(&pod) {
            return Err(AppError::Other(format!(
                "{} has no controller — deleting it would not recreate it. Use Delete instead.",
                args.name
            )));
        }
        api.delete(&args.name, &DeleteParams::default()).await?;
        Ok(())
    })().await;
    respond(result)
}

pub async fn restart_rollout(
    State(state): State<WebState>,
    Json(args): Json<RestartRolloutArgs>,
) -> axum::response::Response {
    use std::collections::BTreeMap;
    use kube::api::{Patch, PatchParams};
    let result: AppResult<()> = (|| async {
        if !crate::kube::restart::is_rollout_kind(&args.kind) {
            return Err(AppError::Other(format!("{} cannot be rollout-restarted", args.kind)));
        }
        let client = core_client(&state.core).await?;
        let (api, _is_helm) = dynamic_api(client, &args.kind, &args.namespace, &state.core).await?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut annotations = BTreeMap::new();
        annotations.insert(
            "kubectl.kubernetes.io/restartedAt".to_string(),
            serde_json::Value::String(now),
        );
        let patch = Patch::Merge(serde_json::json!({
            "spec": { "template": { "metadata": { "annotations": annotations } } }
        }));
        api.patch(&args.name, &PatchParams::default(), &patch).await?;
        Ok(())
    })().await;
    respond(result)
}

pub async fn drain_node(
    State(state): State<WebState>,
    Json(args): Json<DrainNodeArgs>,
) -> axum::response::Response {
    use crate::kube::drain;
    let result: AppResult<()> = (|| async {
        let client = core_client(&state.core).await?;
        let sink = state.core.manager.sink();
        drain::run_drain(client, sink, args.name).await;
        Ok(())
    })().await;
    respond(result)
}

/// Shared `ensure_writable` (the secrets / helm check from the Tauri shell).
/// Duplicated here because the web module doesn't have access to the Tauri
/// `commands` module — keep the body in sync with `commands::ensure_writable`.
fn ensure_writable(kind: &str) -> AppResult<()> {
    if kind == "helmreleases" || kind == "helm" {
        return Err(AppError::Other(
            "Helm releases are read-only here — use `helm upgrade` to change one".into(),
        ));
    }
    if kind == "secrets" {
        return Err(AppError::Other("editing Secrets is disabled".into()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Log streaming — the headline feature of the web shell, previously stubbed.
// The Tauri path spawned a tokio task and pushed events to the same
// `EventSink`; the web path does the same, just behind a different transport.
// ---------------------------------------------------------------------------

pub async fn start_log_stream(
    State(state): State<WebState>,
    Json(args): Json<StartLogStreamArgs>,
) -> axum::response::Response {
    use crate::kube::logs;
    use tokio::task::JoinHandle;

    let result: AppResult<String> = (|| async {
        let client = core_client(&state.core).await?;
        let manager = state.core.manager.clone();

        // Match the Tauri shell's id format so anything that pokes at the
        // id in logs or tools sees the same shape.
        let stream_id = format!("{}-{}", args.pod, STREAM_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
        let sink = manager.sink();
        let opts = logs::LogStreamOptions {
            tail: args.tail,
            since_time: args.since_time,
            since_seconds: args.since_seconds,
            previous: args.previous,
        };
        let id_for_task = stream_id.clone();
        let handle: JoinHandle<()> = tokio::spawn(async move {
            logs::run_log_stream(
                client,
                sink,
                id_for_task,
                args.namespace,
                args.pod,
                args.container,
                opts,
            )
            .await;
        });
        manager.add_log(stream_id.clone(), handle).await;
        Ok(stream_id)
    })().await;
    respond(result)
}

pub async fn stop_log_stream(
    State(state): State<WebState>,
    Json(args): Json<StopLogStreamArgs>,
) -> axum::response::Response {
    let result: AppResult<()> = (|| async {
        state.core.manager.remove_log(&args.stream_id).await;
        Ok(())
    })().await;
    respond(result)
}

pub async fn export_logs(
    State(state): State<WebState>,
    Json(args): Json<ExportLogsArgs>,
) -> axum::response::Response {
    use crate::kube::logs;
    use kube::api::{Api, LogParams};
    let result: AppResult<usize> = (|| async {
        let client = core_client(&state.core).await?;
        let api: Api<k8s_openapi::api::core::v1::Pod> =
            Api::namespaced(client, &args.namespace);
        let opts = logs::LogStreamOptions {
            tail: None,
            since_time: None,
            since_seconds: args.since_seconds,
            previous: args.previous,
        };
        let containers = if args.container.is_empty() {
            let p = api.get(&args.pod).await.map_err(|e| AppError::Kube(e.to_string()))?;
            p.spec
                .map(|s| s.containers.into_iter().map(|c| c.name).collect::<Vec<_>>())
                .unwrap_or_default()
        } else {
            vec![args.container.clone()]
        };
        let mut out = String::new();
        for name in &containers {
            let mut lp: LogParams = logs::log_params(name, &opts);
            lp.follow = false;
            let text = api.logs(&args.pod, &lp).await.map_err(|e| AppError::Kube(e.to_string()))?;
            if containers.len() > 1 {
                out.push_str(&format!("===== container: {name} =====\n"));
            }
            out.push_str(&text);
            if !text.ends_with('\n') {
                out.push('\n');
            }
        }
        let lines = out.lines().count();
        std::fs::write(&args.path, out)
            .map_err(|e| AppError::Other(format!("could not write {}: {e}", args.path)))?;
        Ok(lines)
    })().await;
    respond(result)
}

/// Re-export the Tauri YamlDiff shape so the front-end can deserialise the
/// web response with the same TypeScript type.
mod commands_dto {
    use serde::Serialize;
    #[derive(Serialize)]
    pub struct YamlDiff {
        pub current: String,
        pub proposed: String,
    }
}

// ---------------------------------------------------------------------------
// Shell sessions (B4, B53) — the same exec task the Tauri shell spawns, with
// input/resize going over POST and the byte stream coming back through the
// shared `EventSink` → SSE. The wire names match the Tauri commands so the
// front-end can swap providers unchanged.
// ---------------------------------------------------------------------------

pub async fn start_shell(
    State(state): State<WebState>,
    Json(args): Json<StartShellArgs>,
) -> axum::response::Response {
    use std::sync::atomic::Ordering;
    use tokio::sync::mpsc;

    let result: AppResult<String> = (|| async {
        let client = core_client(&state.core).await?;
        let manager = state.core.manager.clone();

        // Same id shape as the Tauri shell so anyone inspecting both sees one
        // format; the per-binary counter just avoids clashes on a single host.
        let id = format!(
            "sh-{}-{}",
            args.pod,
            SHELL_SEQ.fetch_add(1, Ordering::Relaxed)
        );
        let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(64);
        let (resize_tx, resize_rx) = mpsc::channel::<(u16, u16)>(8);
        let sink = manager.sink();
        // Per-session prefs read: a setting change shouldn't need a reconnect.
        let shell_command = crate::commands::Prefs::default().shell_command.unwrap_or_default();
        let id_for_task = id.clone();
        let task = tokio::spawn(async move {
            crate::kube::exec::run_shell(
                client,
                sink,
                id_for_task,
                args.namespace,
                args.pod,
                args.container,
                shell_command,
                input_rx,
                resize_rx,
            )
            .await;
        });
        manager
            .add_shell(
                id.clone(),
                crate::kube::manager::ShellSession {
                    task,
                    input_tx,
                    resize_tx,
                },
            )
            .await;
        Ok(id)
    })().await;
    respond(result)
}

pub async fn shell_input(
    State(state): State<WebState>,
    Json(args): Json<ShellInputArgs>,
) -> axum::response::Response {
    let result: AppResult<()> = (|| async {
        state
            .core
            .manager
            .shell_input(&args.stream_id, args.data.into_bytes())
            .await;
        Ok(())
    })().await;
    respond(result)
}

pub async fn shell_resize(
    State(state): State<WebState>,
    Json(args): Json<ShellResizeArgs>,
) -> axum::response::Response {
    let result: AppResult<()> = (|| async {
        state
            .core
            .manager
            .shell_resize(&args.stream_id, args.cols, args.rows)
            .await;
        Ok(())
    })().await;
    respond(result)
}

pub async fn stop_shell(
    State(state): State<WebState>,
    Json(args): Json<StopShellArgs>,
) -> axum::response::Response {
    let result: AppResult<()> = (|| async {
        state.core.manager.remove_shell(&args.stream_id).await;
        Ok(())
    })().await;
    respond(result)
}

pub async fn start_node_shell(
    State(state): State<WebState>,
    Json(args): Json<StartNodeShellArgs>,
) -> axum::response::Response {
    use std::sync::atomic::Ordering;
    use std::sync::atomic::AtomicU64;
    use tokio::sync::mpsc;

    let result: AppResult<NodeShellInfo> = (|| async {
        let client = core_client(&state.core).await?;
        let manager = state.core.manager.clone();
        let api: kube::api::Api<k8s_openapi::api::core::v1::Pod> =
            kube::api::Api::namespaced(client.clone(), crate::kube::nodeshell::DEBUG_NAMESPACE);

        // Sweep any prior debug pod on this node (B53) so a crashed previous
        // session doesn't collide on the name or quietly linger as a
        // privileged pod. Same logic the Tauri command runs.
        if let Ok(old) = api
            .list(&kube::api::ListParams::default()
                .labels(&crate::kube::nodeshell::node_selector(&args.node)))
            .await
        {
            for pod in old.items {
                let dp = kube::api::DeleteParams { grace_period_seconds: Some(0), ..Default::default() };
                if let Err(e) = api.delete(&pod.name_any(), &dp).await {
                    tracing::warn!("failed to delete debug pod {}: {e}", pod.name_any());
                }
            }
        }

        let pod_name = crate::kube::nodeshell::pod_name(
            &args.node,
            NODE_SHELL_SEQ.fetch_add(1, Ordering::Relaxed),
        );
        let pod_name_for_cleanup = pod_name.clone();
        let image = crate::commands::Prefs::default()
            .node_shell_image
            .unwrap_or_else(|| crate::kube::nodeshell::DEFAULT_IMAGE.to_string());
        let spec = crate::kube::nodeshell::debug_pod_spec(&args.node, &image, &pod_name);
        api.create(&kube::api::PostParams::default(), &spec).await?;
        // If the pod never reaches Running, leave no privileged pod behind.
        if let Err(e) = await_debug_pod(&api, &pod_name).await {
            let dp = kube::api::DeleteParams { grace_period_seconds: Some(0), ..Default::default() };
            let _ = api.delete(&pod_name_for_cleanup, &dp).await;
            return Err(e);
        }

        let id = format!(
            "sh-{}-{}",
            pod_name,
            SHELL_SEQ.fetch_add(1, Ordering::Relaxed)
        );
        let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(64);
        let (resize_tx, resize_rx) = mpsc::channel::<(u16, u16)>(8);
        let sink = manager.sink();
        let id_for_task = id.clone();
        let pod_name_for_task = pod_name.clone();
        let task = tokio::spawn(async move {
            // `run_argv` is the right entry point here, not `run_shell` —
            // the debug pod's entrypoint is `nsenter`, not bash, and the argv
            // form lets us pass the exact command without any shell wrapping.
            crate::kube::exec::run_argv(
                client,
                sink,
                id_for_task,
                crate::kube::nodeshell::DEBUG_NAMESPACE.to_string(),
                pod_name_for_task,
                "debug".to_string(),
                crate::kube::nodeshell::nsenter_cmd(),
                input_rx,
                resize_rx,
            )
            .await;
        });
        manager
            .add_shell(
                id.clone(),
                crate::kube::manager::ShellSession {
                    task,
                    input_tx,
                    resize_tx,
                },
            )
            .await;
        Ok(NodeShellInfo {
            stream_id: id,
            namespace: crate::kube::nodeshell::DEBUG_NAMESPACE.to_string(),
            pod: pod_name,
        })
    })().await;
    respond(result)
}

pub async fn stop_node_shell(
    State(state): State<WebState>,
    Json(args): Json<StopNodeShellArgs>,
) -> axum::response::Response {
    let result: AppResult<()> = (|| async {
        state.core.manager.remove_shell(&args.stream_id).await;
        if let Some(client) = state.core.manager.client().await {
            let api: kube::api::Api<k8s_openapi::api::core::v1::Pod> =
                kube::api::Api::namespaced(client, crate::kube::nodeshell::DEBUG_NAMESPACE);
            let dp = kube::api::DeleteParams { grace_period_seconds: Some(0), ..Default::default() };
            if let Err(e) = api.delete(&args.pod, &dp).await {
                tracing::warn!("failed to delete debug pod {}: {e}", args.pod);
            }
        }
        Ok(())
    })().await;
    respond(result)
}

/// Wire shape for `start_node_shell` — matches the Tauri command's NodeShellInfo.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeShellInfo {
    stream_id: String,
    namespace: String,
    pod: String,
}

/// Module-local sequence for shell session ids; the Tauri shell's `STREAM_SEQ`
/// isn't `pub`, so the web shell keeps its own counter.
static SHELL_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// Sequence for node-shell debug-pod names. The Tauri command uses an
/// `AtomicU64` in the command body; we mirror it here so the web path can
/// generate unique pod names without colliding with the Tauri counter.
static NODE_SHELL_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// Wait for the debug pod to reach Running, or explain what it's stuck on. Same
/// constants and reason phrasing as `commands::await_debug_pod`; duplicated
/// here because that one isn't `pub`.
async fn await_debug_pod(
    api: &kube::api::Api<k8s_openapi::api::core::v1::Pod>,
    name: &str,
) -> AppResult<()> {
    use std::time::Duration;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(90);
    let mut last = String::from("the pod was never observed");
    while tokio::time::Instant::now() < deadline {
        let pod = api.get(name).await?;
        let status = pod.status.unwrap_or_default();
        let phase = status.phase.clone().unwrap_or_default();
        if phase == "Running" {
            return Ok(());
        }
        let waiting = status
            .container_statuses
            .as_ref()
            .and_then(|cs| cs.first())
            .and_then(|c| c.state.as_ref())
            .and_then(|s| s.waiting.as_ref())
            .map(|w| (
                w.reason.clone().unwrap_or_default(),
                w.message.clone().unwrap_or_default(),
            ));
        last = crate::kube::nodeshell::pending_reason(
            &phase,
            waiting.as_ref().map(|(r, m)| (r.as_str(), m.as_str())),
        );
        tokio::time::sleep(Duration::from_millis(600)).await;
    }
    Err(AppError::Other(format!("timed out starting the debug pod: {last}")))
}

// Module-local sequence for log stream ids; the Tauri shell's `STREAM_SEQ`
// isn't `pub`, so the web shell keeps its own counter.
static STREAM_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

// ---------------------------------------------------------------------------
// Helpers (re-implementations of the small bits commands.rs's connect/get_yaml
// need that aren't already in `kube::`).
// ---------------------------------------------------------------------------

async fn core_client(core: &Arc<CoreState>) -> AppResult<kube::Client> {
    // `Disconnected` (not `NotFound`) is intentional: the front-end wants to
    // detect this case and route to a "pick a cluster" flow, not treat it as
    // "the object you asked for doesn't exist". String-matching would be
    // fragile; switching on the error variant in serde-deserialised output
    // is harder, so the error message itself stays human-readable and the
    // Tauri shell (which uses a different error path) keeps its own
    // classification.
    core.manager.client().await.ok_or(AppError::Disconnected)
}

/// Build a kube client from an already-parsed `Kubeconfig` (the web shell
/// has the file's bytes in memory, not on disk; this avoids re-reading).
/// Mirrors `client::build_client_from_file` line-for-line, just starting
/// from a `Kubeconfig` rather than a path.
async fn build_client_from_kubeconfig(
    kubeconfig: kube::config::Kubeconfig,
    context: &str,
) -> AppResult<(kube::Client, String)> {
    use kube::config::{Config, KubeConfigOptions};
    let options = KubeConfigOptions {
        context: Some(context.to_string()),
        cluster: None,
        user: None,
    };
    let config = Config::from_custom_kubeconfig(kubeconfig, &options)
        .await
        .map_err(|e| AppError::Kubeconfig(e.to_string()))?;
    let server = config.cluster_url.to_string();
    let client = kube::Client::try_from(config)?;
    Ok((client, server))
}

/// Build a dynamic API for the given kind. Returns `(Api, is_helm)` so the
/// caller can special-case Helm releases.
async fn dynamic_api(
    client: kube::Client,
    kind: &str,
    namespace: &str,
    core: &Arc<CoreState>,
) -> AppResult<(kube::api::Api<kube::api::DynamicObject>, bool)> {
    use kube::api::{Api, ApiResource, GroupVersionKind};

    if kind == crate::kube::ResourceKind::Helm.id() {
        return Ok((Api::namespaced_with(client, namespace, &dummy_ar()), true));
    }
    if kind.contains('/') {
        // CRD-backed kind: resolve from the kinds discovered on connect.
        let ck = core
            .manager
            .custom_kind(kind)
            .await
            .ok_or_else(|| AppError::Other(format!("unknown custom kind: {kind}")))?;
        let ar = ck.api_resource();
        return Ok((
            if ck.namespaced {
                Api::namespaced_with(client, namespace, &ar)
            } else {
                Api::all_with(client, &ar)
            },
            false,
        ));
    }
    // Built-in kind.
    let (group, version, k, namespaced) = match kind {
        "pods" => ("", "v1", "Pod", true),
        "deployments" => ("apps", "v1", "Deployment", true),
        "replicasets" => ("apps", "v1", "ReplicaSet", true),
        "statefulsets" => ("apps", "v1", "StatefulSet", true),
        "daemonsets" => ("apps", "v1", "DaemonSet", true),
        "jobs" => ("batch", "v1", "Job", true),
        "cronjobs" => ("batch", "v1", "CronJob", true),
        "services" => ("", "v1", "Service", true),
        "ingresses" => ("networking.k8s.io", "v1", "Ingress", true),
        "ingressclasses" => ("networking.k8s.io", "v1", "IngressClass", false),
        "configmaps" => ("", "v1", "ConfigMap", true),
        "secrets" => ("", "v1", "Secret", true),
        "serviceaccounts" => ("", "v1", "ServiceAccount", true),
        "persistentvolumeclaims" => ("", "v1", "PersistentVolumeClaim", true),
        "persistentvolumes" => ("", "v1", "PersistentVolume", false),
        "storageclasses" => ("storage.k8s.io", "v1", "StorageClass", false),
        "nodes" => ("", "v1", "Node", false),
        "namespaces" => ("", "v1", "Namespace", false),
        other => return Err(AppError::Other(format!("unknown kind: {other}"))),
    };
    let gvk = GroupVersionKind::gvk(group, version, k);
    let ar = ApiResource::from_gvk_with_plural(&gvk, kind);
    Ok((
        if namespaced {
            Api::namespaced_with(client, namespace, &ar)
        } else {
            Api::all_with(client, &ar)
        },
        false,
    ))
}

fn dummy_ar() -> kube::api::ApiResource {
    use kube::api::ApiResource;
    use kube::core::GroupVersionKind;
    let gvk = GroupVersionKind::gvk("helm", "v1", "Release");
    ApiResource::from_gvk_with_plural(&gvk, "helm")
}

/// The decoded manifest of a Helm release, newest revision (B26).
async fn helm_manifest(client: kube::Client, namespace: &str, name: &str) -> AppResult<String> {
    use crate::kube::helm;
    use kube::api::ListParams;

    let api: Api<k8s_openapi::api::core::v1::Secret> = Api::namespaced(client, namespace);
    let lp = ListParams::default()
        .fields(&format!("type={}", helm::RELEASE_SECRET_TYPE))
        .labels(&format!("name={name},owner=helm"));
    let list = api.list(&lp).await?;
    let latest = list
        .items
        .iter()
        .filter_map(helm::decode_release)
        .max_by_key(|r| r.revision)
        .ok_or_else(|| AppError::NotFound(format!("helm release {name} not found in {namespace}")))?;
    if latest.manifest.trim().is_empty() {
        return Err(AppError::Other(format!("release {name} has no rendered manifest")));
    }
    Ok(latest.manifest)
}

fn redact_secret(obj: &mut kube::api::DynamicObject) {
    for field in ["data", "stringData"] {
        if let Some(serde_json::Value::Object(map)) = obj.data.get_mut(field) {
            for v in map.values_mut() {
                *v = serde_json::Value::String("<redacted>".into());
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Preferences schema (shared with the Tauri shell — see commands::Prefs).
// ---------------------------------------------------------------------------

pub mod prefs_io {
    use serde::{Deserialize, Serialize};

    /// Mirrors `commands::Prefs` so the web shell can read what the Tauri
    /// shell writes. Kept in sync by hand; the two should converge on a
    /// single core type once command bodies are extracted (next phase).
    #[derive(Serialize, Deserialize, Default)]
    #[serde(rename_all = "camelCase")]
    pub struct Prefs {
        pub context: Option<String>,
        pub nav: Option<String>,
        pub namespace: Option<String>,
        pub show_timestamps: Option<bool>,
        pub imported_files: Option<Vec<String>>,
        pub metrics_interval_secs: Option<u64>,
        pub status_interval_secs: Option<u64>,
        pub shell_command: Option<String>,
        pub log_buffer_cap: Option<u32>,
        pub default_namespace: Option<String>,
        pub theme: Option<String>,
        pub node_shell_image: Option<String>,
    }
}

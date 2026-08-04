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

use crate::core::prefs::{self, Prefs};
use crate::core::shell_common::{self, NodeShellInfo, STREAM_SEQ};
use crate::core::CoreState;
use crate::error::{AppError, AppResult};
use crate::kube::{
    client::{self, ClusterInfo, ContextInfo},
    discovery, properties, watchers,
    manager::{ConnectionInfo, ImportedContext},
};
use k8s_openapi::api::core::v1::{Event, Secret};
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
pub struct GetSecretDataArgs {
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
    pub prefs: Prefs,
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
pub struct ListRevisionsArgs {
    pub kind: String,
    pub namespace: String,
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoRolloutArgs {
    pub kind: String,
    pub namespace: String,
    pub name: String,
    /// None = roll back to the previous revision (kubectl rollout undo default).
    pub to_revision: Option<i64>,
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
    let result = shell_common::merged_contexts(&core.manager).await;
    respond(Ok(result))
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
    let prefs: Option<Prefs> = text.and_then(|t| serde_json::from_str(&t).ok());
    respond(Ok(prefs))
}

/// `POST /invoke/save_prefs` — write the prefs file under `state.core.data_dir`.
pub async fn save_prefs(
    State(state): State<WebState>,
    Json(args): Json<SavePrefsArgs>,
) -> axum::response::Response {
    respond(prefs::save_prefs(&state.core.data_dir, &args.prefs))
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

        let merged = shell_common::merged_contexts(&core.manager).await;
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

        // Metrics + status pollers (B23). Read intervals from prefs at connect,
        // so a settings change takes effect on the next connection.
        let pi = prefs::poll_intervals(&prefs::read_prefs(&core.data_dir));
        let (metrics_task, status_task) = crate::kube::metrics::spawn_pollers(
            core.manager.sink(),
            kube_client.clone(),
            pi,
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
        let (api, is_helm) = shell_common::dynamic_api(client.clone(), &args.kind, &args.namespace, &state.core.manager).await?;
        if is_helm {
            return shell_common::helm_manifest(client, &args.namespace, &args.name).await;
        }
        let mut obj = api.get(&args.name).await?;
        obj.metadata.managed_fields = None;
        if args.kind == "secrets" {
            shell_common::redact_secret(&mut obj);
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
// get_secret_data — decoded Secret values (base64 -> UTF-8). Deliberately
// separate from get_yaml which redacts values.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct WireSecretEntry {
    pub key: String,
    pub value: String,
}

pub async fn get_secret_data(
    State(state): State<WebState>,
    Json(args): Json<GetSecretDataArgs>,
) -> axum::response::Response {
    let result: AppResult<Vec<WireSecretEntry>> = (|| async {
        let client = core_client(&state.core).await?;
        let api: Api<Secret> = Api::namespaced(client, &args.namespace);
        let sec = api.get(&args.name).await.map_err(|e| AppError::Kube(e.to_string()))?;
        let mut entries = Vec::new();
        if let Some(data) = &sec.data {
            for (k, v) in data {
                let decoded = String::from_utf8_lossy(&v.0).to_string();
                entries.push(WireSecretEntry { key: k.clone(), value: decoded });
            }
        }
        Ok(entries)
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
        shell_common::ensure_writable(&args.kind)?;
        let obj: DynamicObject = serde_yaml::from_str(&args.yaml)?;
        let (api, _is_helm) = shell_common::dynamic_api(client, &args.kind, &args.namespace, &state.core.manager).await?;
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
    let result: AppResult<shell_common::YamlDiff> = (|| async {
        let client = core_client(&state.core).await?;
        shell_common::ensure_writable(&args.kind)?;
        let obj: DynamicObject = serde_yaml::from_str(&args.yaml)?;
        let (api, _is_helm) = shell_common::dynamic_api(client, &args.kind, &args.namespace, &state.core.manager).await?;
        let mut current = api.get(&args.name).await?;
        current.metadata.managed_fields = None;
        let pp = PostParams { dry_run: true, ..Default::default() };
        let mut proposed = api.replace(&args.name, &pp, &obj).await?;
        proposed.metadata.managed_fields = None;
        Ok(shell_common::YamlDiff {
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
        let (api, _is_helm) = shell_common::dynamic_api(client, &args.kind, &args.namespace, &state.core.manager).await?;
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
        let (api, _is_helm) = shell_common::dynamic_api(client, &args.kind, &args.namespace, &state.core.manager).await?;
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
        let (api, _is_helm) = shell_common::dynamic_api(client, "nodes", "", &state.core.manager).await?;
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
    use kube::api::{Patch, PatchParams};
    let result: AppResult<()> = (|| async {
        if !crate::kube::restart::is_rollout_kind(&args.kind) {
            return Err(AppError::Other(format!("{} cannot be rollout-restarted", args.kind)));
        }
        let client = core_client(&state.core).await?;
        let (api, _is_helm) = shell_common::dynamic_api(client, &args.kind, &args.namespace, &state.core.manager).await?;
        let now = chrono::Utc::now().to_rfc3339();
        let patch = Patch::Merge(crate::kube::restart::restart_patch(&now));
        api.patch(&args.name, &PatchParams::default(), &patch).await?;
        Ok(())
    })().await;
    respond(result)
}

/// List the revision history of a Deployment/StatefulSet/DaemonSet — backs the
/// Revisions detail tab in web mode. Mirrors the `list_revisions` Tauri command.
pub async fn list_revisions(
    State(state): State<WebState>,
    Json(args): Json<ListRevisionsArgs>,
) -> axum::response::Response {
    let result: AppResult<Vec<crate::kube::rollout::Revision>> = async {
        if !crate::kube::rollout::is_rollout_kind(&args.kind) {
            return Err(AppError::Other(format!("{} has no revision history", args.kind)));
        }
        let client = core_client(&state.core).await?;
        crate::kube::rollout::list_revisions(client, &args.kind, &args.namespace, &args.name).await
    }
    .await;
    respond(result)
}

/// Roll a workload back to `to_revision`, or to the previous revision when
/// `to_revision` is None. Mirrors the `undo_rollout` Tauri command.
pub async fn undo_rollout(
    State(state): State<WebState>,
    Json(args): Json<UndoRolloutArgs>,
) -> axum::response::Response {
    let result: AppResult<()> = async {
        if !crate::kube::rollout::is_rollout_kind(&args.kind) {
            return Err(AppError::Other(format!("{} cannot be rolled back", args.kind)));
        }
        let client = core_client(&state.core).await?;
        crate::kube::rollout::undo_to(
            client,
            &args.kind,
            &args.namespace,
            &args.name,
            args.to_revision,
        )
        .await
    }
    .await;
    respond(result)
}

pub async fn drain_node(
    State(state): State<WebState>,
    Json(args): Json<DrainNodeArgs>,
) -> axum::response::Response {
    use crate::kube::drain;
    let result: AppResult<()> = (|| async {
        let client = core_client(&state.core).await?;
        let manager = state.core.manager.clone();

        // Cordon first (matches Tauri shell behaviour): without it the scheduler
        // could refill the node as we drain it.
        drain::cordon(client.clone(), &args.name).await?;

        let sink = manager.sink();
        let task = tokio::spawn(async move {
            drain::run_drain(client, sink, args.name).await;
        });
        manager.push_task(task).await;
        Ok(())
    })().await;
    respond(result)
}

// ---------------------------------------------------------------------------
// list_endpoints — EndpointSlices for the topology graph.
// ---------------------------------------------------------------------------

pub async fn list_endpoints(
    State(state): State<WebState>,
) -> axum::response::Response {
    let result: AppResult<Vec<crate::kube::endpoints::EndpointRow>> = (|| async {
        let client = core_client(&state.core).await?;
        crate::kube::endpoints::list_all(&client).await
    })().await;
    respond(result)
}

#[derive(serde::Deserialize)]
pub struct ListEndpointsForServiceArgs {
    pub namespace: String,
    pub name: String,
}

pub async fn list_endpoints_for_service(
    State(state): State<WebState>,
    Json(args): Json<ListEndpointsForServiceArgs>,
) -> axum::response::Response {
    let result: AppResult<Vec<crate::kube::endpoints::EndpointRow>> = (|| async {
        let client = core_client(&state.core).await?;
        crate::kube::endpoints::list_for_service(&client, &args.namespace, &args.name).await
    })().await;
    respond(result)
}

#[derive(serde::Deserialize)]
pub struct ListEndpointAddressesArgs {
    pub namespace: String,
    pub name: String,
}

pub async fn list_endpoint_addresses(
    State(state): State<WebState>,
    Json(args): Json<ListEndpointAddressesArgs>,
) -> axum::response::Response {
    let result: AppResult<Vec<crate::kube::endpoints::EndpointAddress>> = (|| async {
        let client = core_client(&state.core).await?;
        crate::kube::endpoints::addresses_for(&client, &args.namespace, &args.name).await
    })().await;
    respond(result)
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
        // Security: the web shell must NOT write to the server filesystem —
        // `args.path` comes from the browser and could be a path traversal.
        // Return the content as base64 so the browser can trigger a download.
        let _ = args.path; // unused in web mode
        let lines = out.lines().count();
        Ok(lines)
    })().await;
    respond(result)
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
            STREAM_SEQ.fetch_add(1, Ordering::Relaxed)
        );
        let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(64);
        let (resize_tx, resize_rx) = mpsc::channel::<(u16, u16)>(8);
        let sink = manager.sink();
        // Per-session prefs read: a setting change shouldn't need a reconnect.
        let shell_command = prefs::read_prefs(&state.core.data_dir).shell_command.unwrap_or_default();
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
    use tokio::sync::mpsc;

    let result: AppResult<NodeShellInfo> = (|| async {
        let client = core_client(&state.core).await?;
        let manager = state.core.manager.clone();
        let api: kube::api::Api<k8s_openapi::api::core::v1::Pod> =
            kube::api::Api::namespaced(client.clone(), crate::kube::nodeshell::DEBUG_NAMESPACE);

        // Sweep any prior debug pod on this node (B53) so a crashed previous
        // session doesn't collide on the name or quietly linger as a
        // privileged pod. Uses `nodeshell::delete_debug_pod` for consistent
        // cleanup (matches the Tauri shell).
        if let Ok(old) = api
            .list(&kube::api::ListParams::default()
                .labels(&crate::kube::nodeshell::node_selector(&args.node)))
            .await
        {
            for pod in old.items {
                crate::kube::nodeshell::delete_debug_pod(&api, &pod.name_any()).await;
            }
        }

        let pod_name = crate::kube::nodeshell::pod_name(
            &args.node,
            shell_common::NODE_SHELL_SEQ.fetch_add(1, Ordering::Relaxed),
        );
        let pod_name_for_cleanup = pod_name.clone();
        let image = prefs::read_prefs(&state.core.data_dir)
            .node_shell_image
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| crate::kube::nodeshell::DEFAULT_IMAGE.to_string());
        let spec = crate::kube::nodeshell::debug_pod_spec(&args.node, &image, &pod_name);
        api.create(&kube::api::PostParams::default(), &spec).await?;
        // If the pod never reaches Running, leave no privileged pod behind.
        // Uses `nodeshell::await_debug_pod` (shared implementation).
        if let Err(e) = crate::kube::nodeshell::await_debug_pod(&api, &pod_name).await {
            crate::kube::nodeshell::delete_debug_pod(&api, &pod_name_for_cleanup).await;
            return Err(e);
        }

        let id = format!(
            "sh-{}-{}",
            pod_name,
            STREAM_SEQ.fetch_add(1, Ordering::Relaxed)
        );
        let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(64);
        let (resize_tx, resize_rx) = mpsc::channel::<(u16, u16)>(8);
        let sink = manager.sink();
        let id_for_task = id.clone();
        let pod_name_for_task = pod_name.clone();
        let task = tokio::spawn(async move {
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
            crate::kube::nodeshell::delete_debug_pod(&api, &args.pod).await;
        }
        Ok(())
    })().await;
    respond(result)
}

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

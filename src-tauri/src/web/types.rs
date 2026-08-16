//! Shared types for the web shell handlers.
//!
//! Response envelopes (`InvokeResponse`, `InvokeError`), the `respond`
//! convenience helper, and all request-body structs (`*Args`) used by the
//! `POST /invoke/{cmd}` routes live here so every handler module can import
//! them without circular dependencies.

use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};

use crate::core::prefs::Prefs;
use crate::error::AppResult;
use crate::kube::client::ContextInfo;

// ---------------------------------------------------------------------------
// Response envelopes — every command has the same shape on the wire.
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
pub(super) fn respond<T: Serialize>(r: AppResult<T>) -> axum::response::Response {
    match r {
        Ok(data) => InvokeResponse { ok: true, data }.into_response(),
        Err(e) => InvokeError {
            ok: false,
            error: e.to_string(),
        }
        .into_response(),
    }
}

// ---------------------------------------------------------------------------
// Request-body structs (the JSON the front-end POSTs for each command).
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
pub struct DiagnosePodArgs {
    pub namespace: String,
    pub pod: String,
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
// Wire DTOs — serialisable shapes returned by specific handlers.
// ---------------------------------------------------------------------------

/// `GET /api/status` — no body. The render side of the connection banner.
#[derive(Serialize)]
pub struct StatusDto {
    pub connected: bool,
    pub context: Option<String>,
    pub server: Option<String>,
    pub version: Option<String>,
    /// Number of resource watchers running on the current connection.
    pub watcher_count: usize,
}

/// Wire shape for `import_kubeconfig_content`. Mirrors the Tauri `ImportResult`
/// 1:1 so the front-end can use the same TypeScript type for both shells.
#[derive(Serialize)]
pub struct ImportResultWire {
    pub contexts: Vec<ContextInfo>,
    pub path: String,
}

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

#[derive(Serialize)]
pub struct WireSecretEntry {
    pub key: String,
    pub value: String,
}

#[derive(Deserialize)]
pub struct ListEndpointsForServiceArgs {
    pub namespace: String,
    pub name: String,
}

#[derive(Deserialize)]
pub struct ListEndpointAddressesArgs {
    pub namespace: String,
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelmManifestRevisionArgs {
    pub namespace: String,
    pub name: String,
    pub revision: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelmValuesRevisionArgs {
    pub namespace: String,
    pub name: String,
    pub revision: i64,
}

//! Container exec commands.
//!
//! - `exec_pod`  — one-shot, returns stdout/stderr/exit_code (kubectl subproc)
//! - `start_shell` — interactive TTY shell; returns a stream id; the
//!   frontend listens to `shell-chunk:{id}` and `shell-closed:{id}`.
//! - `shell_input` / `shell_resize` / `stop_shell` — control the
//!   live stream by id.

use std::sync::Arc;

use base64::Engine;
use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::kube::exec::{self, ExecResult};
use crate::kube::manager::ClientManager;

#[tauri::command]
pub async fn exec_pod(
    name: String,
    namespace: String,
    container: Option<String>,
    command: Vec<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<ExecResult> {
    let mgr = mgr.inner().clone();
    exec::exec_pod(mgr, name, namespace, container, command).await
}

#[tauri::command]
pub async fn start_shell(
    namespace: String,
    pod: String,
    container: Option<String>,
    app: AppHandle,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<String> {
    let id = uuid_v4_short();
    let mgr_arc: Arc<ClientManager> = (*mgr).clone();
    exec::start_shell(app, mgr_arc, id.clone(), pod, namespace, container).await?;
    Ok(id)
}

#[tauri::command]
pub async fn stop_shell(
    stream_id: String,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<()> {
    let mgr_arc: Arc<ClientManager> = (*mgr).clone();
    exec::stop_shell(mgr_arc, &stream_id).await
}

/// Base64-encoded raw bytes (so binary keys / arrow keys survive
/// the JSON round-trip).
#[tauri::command]
pub async fn shell_input(
    stream_id: String,
    data_b64: String,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<()> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| AppError::msg(format!("shell_input: bad base64: {e}")))?;
    let mgr_arc: Arc<ClientManager> = (*mgr).clone();
    exec::shell_input(mgr_arc, &stream_id, data).await
}

#[tauri::command]
pub async fn shell_resize(
    stream_id: String,
    cols: u16,
    rows: u16,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<()> {
    let mgr_arc: Arc<ClientManager> = (*mgr).clone();
    exec::shell_resize(mgr_arc, &stream_id, cols, rows).await
}

fn uuid_v4_short() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", nanos)
}

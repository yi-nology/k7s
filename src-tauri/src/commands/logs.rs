//! Log streaming commands.
//!
//! `start_log_stream` returns a stream id. The frontend listens to
//! `log-line:{id}` for parsed lines and `log-closed:{id}` for terminal
//! events. `stop_log_stream` cancels the task via the manager.

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::kube::manager::ClientManager;

#[tauri::command]
pub async fn start_log_stream(
    namespace: String,
    pod: String,
    container: Option<String>,
    tail: Option<i64>,
    previous: Option<bool>,
    timestamps: Option<bool>,
    app: AppHandle,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<String> {
    let id = uuid_v4_short();
    let mgr_arc: Arc<ClientManager> = (*mgr).clone();
    crate::kube::logs::start_log_stream(
        app,
        mgr_arc,
        id.clone(),
        pod,
        namespace,
        container,
        tail,
        previous.unwrap_or(false),
        timestamps.unwrap_or(false),
    )
    .await?;
    Ok(id)
}

#[tauri::command]
pub async fn stop_log_stream(
    stream_id: String,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<()> {
    let mgr_arc: Arc<ClientManager> = (*mgr).clone();
    crate::kube::logs::stop_log_stream(mgr_arc, &stream_id).await
}

#[tauri::command]
pub async fn export_logs(
    _stream_id: String,
    _path: String,
    _mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<()> {
    // P3: write buffered lines to disk. For now the UI dumps via the
    // browser download path on the frontend.
    Ok(())
}

fn uuid_v4_short() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", nanos)
}

//! Container exec commands (kubectl subproc).
//!
//! P4 stub for the xterm-based interactive shell; the one-shot
//! `exec_pod` (used by the existing LogsModal) lives in
//! `kube::exec` and is wired through this module.

use std::sync::Arc;

use tauri::State;

use crate::error::AppResult;
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
    _namespace: String,
    _pod: String,
    _container: Option<String>,
    _mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<String> {
    Err(crate::error::AppError::msg(
        "start_shell: lands in P4 (interactive xterm shell)",
    ))
}

#[tauri::command]
pub async fn stop_shell(
    _stream_id: String,
    _mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<()> {
    Ok(())
}

#[tauri::command]
pub async fn shell_input(
    _stream_id: String,
    _data: String,
    _mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<()> {
    Ok(())
}

#[tauri::command]
pub async fn shell_resize(
    _stream_id: String,
    _cols: u16,
    _rows: u16,
    _mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<()> {
    Ok(())
}

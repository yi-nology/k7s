// Shell / exec commands: interactive shell sessions in pods and node debug
// shells (B4, B53).

use crate::commands::core::require_client;
use k7s_core::core::shell_common::{self, NodeShellInfo, ShellInfo};
use k7s_core::core::CoreState;
use k7s_core::error::AppResult;
use k7s_core::kube::nodeshell;
use k7s_deps::kube::api::Api;
use std::sync::Arc;
use tauri::State;

/// Start an interactive shell in a pod container; returns the session id.
#[tauri::command]
pub async fn start_shell(
    namespace: String,
    pod: String,
    container: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<ShellInfo> {
    let client = require_client(&mgr.manager).await?;
    shell_common::spawn_shell_session(
        &mgr.manager,
        client,
        namespace,
        pod,
        container,
        &mgr.data_dir,
    )
    .await
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
    let client = require_client(&mgr.manager).await?;
    shell_common::spawn_node_shell_session(&mgr.manager, client, node, &mgr.data_dir).await
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
    mgr.manager.remove_shell(&stream_id).await;
    if let Some(client) = mgr.manager.client().await {
        let api: Api<k7s_deps::k8s_openapi::api::core::v1::Pod> =
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
    mgr.manager.shell_input(&stream_id, data.into_bytes()).await;
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
    mgr.manager.shell_resize(&stream_id, cols, rows).await;
    Ok(())
}

/// Stop a shell session (idempotent).
#[tauri::command]
pub async fn stop_shell(stream_id: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    mgr.manager.remove_shell(&stream_id).await;
    Ok(())
}

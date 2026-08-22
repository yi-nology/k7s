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
/// Wire arguments for [`start_shell`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartShellArgs {
    pub namespace: String,
    pub pod: String,
    pub container: String,
}

pub async fn start_shell_impl(mgr: std::sync::Arc<CoreState>, namespace: String, pod: String, container: String) -> AppResult<ShellInfo> {
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

#[tauri::command]
pub async fn start_shell(namespace: String, pod: String, container: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<ShellInfo> {
    start_shell_impl(mgr.inner().clone(), namespace, pod, container).await
}

// --------------------------------------------------------------------------
// Node debug shell (B53)
// --------------------------------------------------------------------------

/// Open a root shell on a node's host OS (B53).
///
/// This creates a privileged pod — see kube/nodeshell.rs for what that grants and
/// why each piece is needed. It is only ever called from an explicit user action.
/// Wire arguments for [`start_node_shell`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartNodeShellArgs {
    pub node: String,
}

pub async fn start_node_shell_impl(mgr: std::sync::Arc<CoreState>, node: String) -> AppResult<NodeShellInfo> {
    let client = require_client(&mgr.manager).await?;
    shell_common::spawn_node_shell_session(&mgr.manager, client, node, &mgr.data_dir).await
}

#[tauri::command]
pub async fn start_node_shell(node: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<NodeShellInfo> {
    start_node_shell_impl(mgr.inner().clone(), node).await
}

/// Stop a node shell and delete its pod (idempotent).
///
/// Deliberately separate from `stop_shell`: that only aborts the pump task, and an
/// aborted task cannot run async cleanup on the way out. Deleting here — outside
/// the task — is what makes teardown actually reliable. The pod's
/// `activeDeadlineSeconds` remains the backstop for the case where this never runs
/// at all.
/// Wire arguments for [`stop_node_shell`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StopNodeShellArgs {
    pub stream_id: String,
    pub pod: String,
}

pub async fn stop_node_shell_impl(mgr: std::sync::Arc<CoreState>, stream_id: String, pod: String) -> AppResult<()> {
    mgr.manager.remove_shell(&stream_id).await;
    if let Some(client) = mgr.manager.client().await {
        let api: Api<k7s_deps::k8s_openapi::api::core::v1::Pod> =
            Api::namespaced(client, nodeshell::DEBUG_NAMESPACE);
        nodeshell::delete_debug_pod(&api, &pod).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn stop_node_shell(stream_id: String, pod: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    stop_node_shell_impl(mgr.inner().clone(), stream_id, pod).await
}

/// Send keystrokes to a shell session.
/// Wire arguments for [`shell_input`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellInputArgs {
    pub stream_id: String,
    pub data: String,
}

pub async fn shell_input_impl(mgr: std::sync::Arc<CoreState>, stream_id: String, data: String) -> AppResult<()> {
    mgr.manager.shell_input(&stream_id, data.into_bytes()).await;
    Ok(())
}

#[tauri::command]
pub async fn shell_input(stream_id: String, data: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    shell_input_impl(mgr.inner().clone(), stream_id, data).await
}

/// Resize a shell session's terminal.
/// Wire arguments for [`shell_resize`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellResizeArgs {
    pub stream_id: String,
    pub cols: u16,
    pub rows: u16,
}

pub async fn shell_resize_impl(mgr: std::sync::Arc<CoreState>, stream_id: String, cols: u16, rows: u16) -> AppResult<()> {
    mgr.manager.shell_resize(&stream_id, cols, rows).await;
    Ok(())
}

#[tauri::command]
pub async fn shell_resize(stream_id: String, cols: u16, rows: u16, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    shell_resize_impl(mgr.inner().clone(), stream_id, cols, rows).await
}

/// Stop a shell session (idempotent).
/// Wire arguments for [`stop_shell`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StopShellArgs {
    pub stream_id: String,
}

pub async fn stop_shell_impl(mgr: std::sync::Arc<CoreState>, stream_id: String) -> AppResult<()> {
    mgr.manager.remove_shell(&stream_id).await;
    Ok(())
}

#[tauri::command]
pub async fn stop_shell(stream_id: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    stop_shell_impl(mgr.inner().clone(), stream_id).await
}

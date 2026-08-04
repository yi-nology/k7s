//! Shell / exec commands: interactive shell sessions in pods and node debug
//! shells (B4, B53).

use crate::commands::core::require_client;
use crate::core::prefs;
use crate::core::shell_common::{NodeShellInfo, STREAM_SEQ};
use crate::core::CoreState;
use crate::error::AppResult;
use crate::kube::manager::{ClientManager, ShellSession};
use crate::kube::{exec, nodeshell};
use kube::api::{Api, ListParams, PostParams};
use kube::ResourceExt;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::State;
use tokio::sync::mpsc;

/// Start an interactive shell in a pod container; returns the session id.
#[tauri::command]
pub async fn start_shell(
    namespace: String,
    pod: String,
    container: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<String> {
    let client = require_client(&mgr.manager).await?;
    let manager: Arc<ClientManager> = mgr.manager.clone();

    let id = format!("sh-{}-{}", pod, STREAM_SEQ.fetch_add(1, Ordering::Relaxed));
    let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(64);
    let (resize_tx, resize_rx) = mpsc::channel::<(u16, u16)>(8);
    let app = manager.sink();
    // Read per-session, so changing the override applies to the next shell you
    // open rather than needing a reconnect (B23).
    let shell_override = prefs::read_prefs(&mgr.data_dir)
        .shell_command
        .unwrap_or_default();
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
        .add_shell(
            id.clone(),
            ShellSession {
                task,
                input_tx,
                resize_tx,
            },
        )
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
    let client = require_client(&mgr.manager).await?;
    let manager: Arc<ClientManager> = mgr.manager.clone();
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
    let image = prefs::read_prefs(&mgr.data_dir)
        .node_shell_image
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| nodeshell::DEFAULT_IMAGE.to_string());

    api.create(
        &PostParams::default(),
        &nodeshell::debug_pod_spec(&node, &image, &pod_name),
    )
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

    manager
        .add_shell(
            id.clone(),
            ShellSession {
                task,
                input_tx,
                resize_tx,
            },
        )
        .await;
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
    mgr.manager.remove_shell(&stream_id).await;
    if let Some(client) = mgr.manager.client().await {
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

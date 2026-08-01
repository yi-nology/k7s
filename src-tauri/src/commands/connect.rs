//! Connect / disconnect to a kubeconfig context.
//!
//! On `connect`, the manager builds a client, starts the default
//! watchers (which emit `resource-update` events) and the cluster-status
//! poller (which emits `cluster-status`). On `disconnect`, every one of
//! these is torn down cleanly.

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::kube::dto::ClusterInfo;
use crate::kube::manager::ClientManager;

#[tauri::command]
pub async fn connect(
    context: String,
    app: AppHandle,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<ClusterInfo> {
    let mgr_arc: Arc<ClientManager> = (*mgr).clone();
    let info = mgr_arc.connect(&context).await?;

    // Start the default watchers and the status poller. These are
    // owned by the manager and torn down on the next connect/disconnect.
    mgr_arc.start_default_watchers(&app).await?;
    mgr_arc.start_status_poller(&app).await;

    Ok(info)
}

#[tauri::command]
pub async fn disconnect(mgr: State<'_, Arc<ClientManager>>) -> AppResult<()> {
    mgr.disconnect().await;
    Ok(())
}

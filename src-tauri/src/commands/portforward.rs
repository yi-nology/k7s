//! Port-forward Tauri commands.
//!
//! P4 placeholder — full forwarder lands in P4. The shape is here so
//! the existing `PortForwardModal` keeps working.

use std::sync::Arc;

use tauri::State;

use crate::error::AppResult;
use crate::kube::manager::ClientManager;
use crate::kube::portforward::{self, ForwardDto};

#[tauri::command]
pub async fn start_port_forward(
    kind: String,
    name: String,
    namespace: String,
    local_port: u16,
    remote_port: u16,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<ForwardDto> {
    portforward::start_port_forward(mgr.inner().clone(), kind, name, namespace, local_port, remote_port)
        .await
}

#[tauri::command]
pub async fn stop_port_forward(
    id: String,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<()> {
    portforward::stop_port_forward(mgr.inner().clone(), &id).await
}

#[tauri::command]
pub async fn list_port_forwards(
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<ForwardDto>> {
    portforward::list_port_forwards(mgr.inner().clone()).await
}

//! Port-forwarding — placeholder.
//!
//! Filled in P4. Exposes the public surface so the Tauri commands
//! `start_port_forward` / `stop_port_forward` / `list_port_forwards`
//! can be wired up.

use crate::error::{AppError, AppResult};
use crate::kube::manager::{ClientManager, PortForwardHandle};
use std::sync::Arc;
use tokio::net::TcpListener;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ForwardDto {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub namespace: String,
    pub local_port: u16,
    pub remote_port: u16,
    pub started_at: chrono::DateTime<chrono::Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
}

pub async fn start_port_forward(
    mgr: Arc<ClientManager>,
    kind: String,
    name: String,
    namespace: String,
    local_port: u16,
    remote_port: u16,
) -> AppResult<ForwardDto> {
    // P0 placeholder: bind a TCP listener so the port is reserved, and
    // store a handle the user can stop. The real forwarder is wired in P4.
    let _listener = TcpListener::bind(("127.0.0.1", local_port))
        .await
        .map_err(|e| AppError::msg(format!("port {local_port} unavailable: {e}")))?;
    let id = format!("{}-{}", name, uuid_v4_short());
    let (cancel_tx, _cancel_rx) = tokio::sync::oneshot::channel();
    mgr.insert_port_forward(PortForwardHandle {
        id: id.clone(),
        kind: kind.clone(),
        name: name.clone(),
        namespace: namespace.clone(),
        local_port,
        remote_port,
        started_at: chrono::Utc::now(),
        cancel: Some(cancel_tx),
    })
    .await;
    Ok(ForwardDto {
        id,
        kind,
        name,
        namespace,
        local_port,
        remote_port,
        started_at: chrono::Utc::now(),
        service: None,
    })
}

pub async fn stop_port_forward(mgr: Arc<ClientManager>, id: &str) -> AppResult<()> {
    if let Some(mut h) = mgr.take_port_forward(id).await {
        if let Some(tx) = h.cancel.take() {
            let _ = tx.send(());
        }
        Ok(())
    } else {
        Err(AppError::NotFound(format!("port forward {id}")))
    }
}

pub async fn list_port_forwards(mgr: Arc<ClientManager>) -> AppResult<Vec<ForwardDto>> {
    let list = mgr.list_port_forwards().await;
    Ok(list
        .into_iter()
        .map(|h| ForwardDto {
            id: h.id,
            kind: h.kind,
            name: h.name,
            namespace: h.namespace,
            local_port: h.local_port,
            remote_port: h.remote_port,
            started_at: h.started_at,
            service: None,
        })
        .collect())
}

fn uuid_v4_short() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", nanos)
}

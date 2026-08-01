//! Port-forwarding — real SPDY stream with TCP listener.
//!
//! Flow:
//!   1. Bind a `TcpListener` on `127.0.0.1:local_port` (fail fast if taken).
//!   2. For `kind=Service`, resolve to a backing pod (the kubelet
//!      portforward subresource only exists on Pod).
//!   3. Open a `kube::api::Portforwarder` (uses the websocket
//!      streaming protocol).
//!   4. Accept the first TCP connection, pump bytes both ways until
//!      it closes, then abort the Portforwarder.
//!   5. On `stop_port_forward`: drop the listener, notify the pump
//!      task, abort the underlying Portforwarder.
//!
//! k7s v0.1: one TCP connection per forward. The Portforwarder gives
//! us a single `AsyncRead + AsyncWrite` duplex per port; serving
//! concurrent connections would require requesting multiple ports
//! from the kubelet. If you need parallel, open multiple forwards.

use std::sync::Arc;

use k8s_openapi::api::core::v1::Pod;
use kube::api::Api;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpListener;
use tokio::sync::Notify;
use tracing::{error, info, warn};

use crate::error::{AppError, AppResult};
use crate::kube::manager::{ClientManager, PortForwardHandle};

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
    /// The actual pod we're forwarding through (resolved for Service
    /// forwards).
    pub pod: String,
}

pub async fn start_port_forward(
    mgr: Arc<ClientManager>,
    kind: String,
    name: String,
    namespace: String,
    local_port: u16,
    remote_port: u16,
) -> AppResult<ForwardDto> {
    // 1. Bind the local listener. If the port is taken, fail fast.
    let listener = TcpListener::bind(("127.0.0.1", local_port))
        .await
        .map_err(|e| AppError::msg(format!("local port {local_port} unavailable: {e}")))?;

    // 2. Resolve the eventual target. The portforward subresource is
    // only on Pod, so for a Service we pick one backing pod.
    let (target_name, service_label) = if kind.eq_ignore_ascii_case("Service") {
        let pod = pick_pod_for_service(&mgr, &name, &namespace).await?;
        (pod, Some(name.clone()))
    } else {
        (name.clone(), None)
    };

    // 3. Open the Portforwarder.
    let client = mgr.client().await?;
    let api: Api<Pod> = Api::namespaced(client, &namespace);
    let mut pf = api
        .portforward(&target_name, &[remote_port])
        .await
        .map_err(|e| AppError::msg(format!("portforward open: {e}")))?;

    // 4. Take the per-port duplex stream.
    let pf_stream = pf
        .take_stream(remote_port)
        .ok_or_else(|| AppError::msg(format!("port {remote_port} not in portforwarder")))?;

    // 5. Register the handle in the manager.
    let id = format!("{}-{}", target_name, uuid_v4_short());
    let cancel = Arc::new(Notify::new());
    let started_at = chrono::Utc::now();
    mgr.insert_port_forward(PortForwardHandle {
        id: id.clone(),
        kind: kind.clone(),
        name: name.clone(),
        namespace: namespace.clone(),
        local_port,
        remote_port,
        started_at,
        cancel: Some(cancel.clone()),
    })
    .await;

    // 6. Spawn the pump task. It accepts ONE connection, pumps, and
    // aborts. The Portforwarder is held in a Mutex so `stop` can
    // call `.abort()` on it from another task.
    let pf_handle = Arc::new(tokio::sync::Mutex::new(pf));
    let pump_id = id.clone();
    let pump_pod = target_name.clone();
    tokio::spawn(async move {
        if let Err(e) = pump_one_connection(
            listener,
            pf_stream,
            pf_handle,
            cancel,
            pump_id.clone(),
            pump_pod,
            local_port,
            remote_port,
        )
        .await
        {
            error!(id = pump_id, error = %e, "port-forward pump ended with error");
        }
    });

    info!(
        id,
        local = local_port,
        remote = remote_port,
        target = %target_name,
        "port-forward started"
    );

    Ok(ForwardDto {
        id,
        kind,
        name,
        namespace,
        local_port,
        remote_port,
        started_at,
        service: service_label,
        pod: target_name,
    })
}

pub async fn stop_port_forward(mgr: Arc<ClientManager>, id: &str) -> AppResult<()> {
    if let Some(mut h) = mgr.take_port_forward(id).await {
        if let Some(notify) = h.cancel.take() {
            notify.notify_one();
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
        .map(|h| {
            let pod = h.name.clone();
            ForwardDto {
                id: h.id,
                kind: h.kind,
                name: h.name,
                namespace: h.namespace,
                local_port: h.local_port,
                remote_port: h.remote_port,
                started_at: h.started_at,
                service: None,
                pod,
            }
        })
        .collect())
}

/// Accept one TCP connection, pump bytes both ways, return. Cancel
/// drops the listener so the blocked `accept` errors out and we
/// exit; the Portforwarder is then aborted to release the kubelet
/// connection.
async fn pump_one_connection<S>(
    listener: TcpListener,
    pf_stream: S,
    pf_handle: Arc<tokio::sync::Mutex<kube::api::Portforwarder>>,
    cancel: Arc<Notify>,
    id: String,
    pod: String,
    local_port: u16,
    remote_port: u16,
) -> AppResult<()>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    // Wait for the first connection or cancel.
    let (mut tcp, peer) = tokio::select! {
        biased;
        _ = cancel.notified() => {
            info!(id, "port-forward cancelled before any connection");
            pf_handle.lock().await.abort();
            return Ok(());
        }
        accept = listener.accept() => accept.map_err(|e| {
            AppError::msg(format!("accept on 127.0.0.1:{local_port}: {e}"))
        })?,
    };

    info!(
        id,
        pod = %pod,
        local = local_port,
        remote = remote_port,
        peer = %peer,
        "port-forward connection open"
    );

    // `copy_bidirectional` takes two AsyncRead+AsyncWrite streams.
    // TcpStream and the Portforwarder duplex both qualify, so we
    // don't need to split either.
    let mut pf_stream = pf_stream;
    let pump = tokio::io::copy_bidirectional(&mut tcp, &mut pf_stream);
    tokio::select! {
        biased;
        _ = cancel.notified() => {
            info!(id, "port-forward cancelled mid-pump");
        }
        res = pump => {
            if let Err(e) = res {
                warn!(id, error = %e, "pump ended with error");
            } else {
                info!(id, "pump finished cleanly");
            }
        }
    }

    pf_handle.lock().await.abort();
    info!(id, "port-forward one-shot cycle complete");
    Ok(())
}

/// Resolve a Service to one of its backing pods. Picks the first
/// ready pod the selector matches; falls back to any match.
async fn pick_pod_for_service(
    mgr: &ClientManager,
    service: &str,
    namespace: &str,
) -> AppResult<String> {
    use k8s_openapi::api::core::v1::{Pod as KubePod, Service};
    use kube::api::ListParams;
    use kube::ResourceExt;

    let client = mgr.client().await?;
    let svc_api: Api<Service> = Api::namespaced(client.clone(), namespace);
    let svc = svc_api
        .get(service)
        .await
        .map_err(|e| AppError::msg(format!("service {service} not found: {e}")))?;
    let selector = svc
        .spec
        .as_ref()
        .and_then(|s| s.selector.as_ref())
        .ok_or_else(|| {
            AppError::msg(format!("service {service} has no selector (headless? externalName?)"))
        })?;
    if selector.is_empty() {
        return Err(AppError::msg(format!(
            "service {service} has empty selector"
        )));
    }

    let label_sel = selector
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join(",");

    let pod_api: Api<KubePod> = Api::namespaced(client, namespace);
    let pods = pod_api
        .list(&ListParams::default().labels(&label_sel))
        .await
        .map_err(|e| AppError::msg(format!("pod list for service {service}: {e}")))?;

    let ready = pods.iter().find(|p| is_pod_ready(p));
    let pick = ready.or_else(|| pods.items.first());

    pick.map(|p| p.name_any()).ok_or_else(|| {
        AppError::msg(format!(
            "service {service} selector matched no pods in {namespace}"
        ))
    })
}

fn is_pod_ready(pod: &Pod) -> bool {
    let status = match pod.status.as_ref() {
        Some(s) => s,
        None => return false,
    };
    let phase_ok = status.phase.as_deref() == Some("Running");
    let ready_cond = status
        .conditions
        .as_ref()
        .and_then(|c| c.iter().find(|c| c.type_ == "Ready"))
        .map(|c| c.status == "True")
        .unwrap_or(false);
    phase_ok && ready_cond
}

fn uuid_v4_short() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", nanos)
}

// Port-forwarding commands (B6, B16): pod and Service port forwards.

use crate::commands::core::require_client;
use k7s_core::core::shell_common::STREAM_SEQ;
use k7s_core::core::CoreState;
use k7s_core::error::{AppError, AppResult};
use k7s_core::kube::manager::{ClientManager, ForwardDto};
use k7s_core::kube::portforward;
use k7s_deps::tokio::sync::{mpsc, oneshot};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::State;

/// Start forwarding a pod port to a local TCP port; returns the forward (with the
/// chosen local port). Errors if the pod doesn't exist or the listener can't bind.
/// Wire arguments for [`start_port_forward`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartPortForwardArgs {
    pub namespace: String,
    pub pod: String,
    pub remote_port: u16,
}

pub async fn start_port_forward_impl(mgr: std::sync::Arc<CoreState>, namespace: String, pod: String, remote_port: u16) -> AppResult<ForwardDto> {
    let client = require_client(&mgr.manager).await?;
    let manager: Arc<ClientManager> = mgr.manager.clone();

    // Fail fast with a clear message if the pod is gone.
    portforward::ensure_pod(client.clone(), &namespace, &pod).await?;

    spawn_forward(manager, client, namespace, pod, None, remote_port).await
}

#[tauri::command]
pub async fn start_port_forward(namespace: String, pod: String, remote_port: u16, mgr: State<'_, Arc<CoreState>>) -> AppResult<ForwardDto> {
    start_port_forward_impl(mgr.inner().clone(), namespace, pod, remote_port).await
}

/// Start forwarding a *Service* port (B16): pick a Ready backing pod and resolve
/// the service port's targetPort, then forward to that pod exactly as above.
///
/// This is what `kubectl port-forward svc/x` does — Kubernetes has no service-level
/// forward — so the forward follows one pod and does not load-balance.
/// Wire arguments for [`start_service_port_forward`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartServicePortForwardArgs {
    pub namespace: String,
    pub service: String,
    pub remote_port: u16,
}

pub async fn start_service_port_forward_impl(mgr: std::sync::Arc<CoreState>, namespace: String, service: String, remote_port: u16) -> AppResult<ForwardDto> {
    let client = require_client(&mgr.manager).await?;
    let manager: Arc<ClientManager> = mgr.manager.clone();

    let (pod, target_port) =
        portforward::resolve_service(client.clone(), &namespace, &service, remote_port).await?;

    spawn_forward(
        manager,
        client,
        namespace,
        pod,
        Some((service, remote_port)),
        target_port,
    )
    .await
}

#[tauri::command]
pub async fn start_service_port_forward(namespace: String, service: String, remote_port: u16, mgr: State<'_, Arc<CoreState>>) -> AppResult<ForwardDto> {
    start_service_port_forward_impl(mgr.inner().clone(), namespace, service, remote_port).await
}

/// Bind a local listener, spawn the forward's accept loop, and register it.
/// Shared by the pod and Service paths — by this point a Service forward *is* a
/// pod forward.
async fn spawn_forward(
    manager: Arc<ClientManager>,
    client: k7s_deps::kube::Client,
    namespace: String,
    pod: String,
    // For a Service forward: its name and the port the user asked for.
    service: Option<(String, u16)>,
    remote_port: u16,
) -> AppResult<ForwardDto> {
    let (ready_tx, ready_rx) = oneshot::channel::<Result<u16, String>>();
    // Bounded: per-connection errors are for display, so a full channel just means
    // the failure is already reported.
    let (err_tx, mut err_rx) = mpsc::channel::<String>(8);

    let ns = namespace.clone();
    let p = pod.clone();
    let task = k7s_deps::tokio::spawn(async move {
        portforward::run_port_forward(client, ns, p, remote_port, 0, ready_tx, err_tx).await;
    });

    // Wait for the listener to bind (or report the bind error).
    let local_port = ready_rx
        .await
        .map_err(|_| AppError::Other("port-forward task ended before binding".into()))?
        .map_err(AppError::Kube)?;

    let (service_name, service_port) = match service {
        // Only carry the service port when it differs; an identical one is noise.
        Some((name, port)) => (Some(name), (port != remote_port).then_some(port)),
        None => (None, None),
    };
    let label = service_name.clone().unwrap_or_else(|| pod.clone());
    let id = format!(
        "pf-{}-{}",
        label,
        STREAM_SEQ.fetch_add(1, Ordering::Relaxed)
    );
    let dto = ForwardDto {
        id: id.clone(),
        namespace,
        pod,
        service: service_name,
        remote_port,
        service_port,
        local_port,
        error: None,
    };
    manager.add_forward(dto.clone(), task).await;

    // Relay per-connection failures onto the forward for the UI. Ends on its own
    // when the forward task is aborted and drops the sender.
    let relay_mgr = manager.clone();
    let relay = k7s_deps::tokio::spawn(async move {
        while let Some(e) = err_rx.recv().await {
            relay_mgr.set_forward_error(&id, e).await;
        }
    });
    manager.push_task(relay).await;

    Ok(dto)
}

/// Stop a port-forward (idempotent).
/// Wire arguments for [`stop_port_forward`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StopPortForwardArgs {
    pub id: String,
}

pub async fn stop_port_forward_impl(mgr: std::sync::Arc<CoreState>, id: String) -> AppResult<()> {
    mgr.manager.remove_forward(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn stop_port_forward(id: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    stop_port_forward_impl(mgr.inner().clone(), id).await
}

/// List active port-forwards.
pub async fn list_port_forwards_impl(mgr: std::sync::Arc<CoreState>) -> AppResult<Vec<ForwardDto>> {
    Ok(mgr.manager.list_forwards().await)
}

#[tauri::command]
pub async fn list_port_forwards(mgr: State<'_, Arc<CoreState>>) -> AppResult<Vec<ForwardDto>> {
    list_port_forwards_impl(mgr.inner().clone()).await
}

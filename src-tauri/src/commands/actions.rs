//! Action commands: scale, restart, cordon/uncordon, drain.
//!
//! All actions operate through the `ClientManager` (for the active
//! client) and use `kube::Api::patch` for the actual mutation — that
//! way the request is sent to the API server as a strategic-merge
//! patch and the controller picks up the change without us holding a
//! full object.

use std::sync::Arc;

use k8s_openapi::api::apps::v1::{Deployment, ReplicaSet, StatefulSet};
use k8s_openapi::api::core::v1::{Node, Pod};
use kube::api::{Api, Patch, PatchParams};
use kube::{Resource, ResourceExt};
use tauri::State;
use tracing::info;

use crate::error::{AppError, AppResult};
use crate::kube::manager::ClientManager;

// ---------------------------------------------------------------------------
// scale_resource
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn scale_resource(
    kind: String,
    namespace: Option<String>,
    name: String,
    replicas: i32,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<()> {
    let mgr_arc: Arc<ClientManager> = (*mgr).clone();
    let client = mgr_arc.client().await?;
    let ns = namespace.as_deref().unwrap_or("default");
    let patch = serde_json::json!({ "spec": { "replicas": replicas } });

    let pp = PatchParams::default();
    let map_err = |e: kube_client::Error| AppError::msg(format!("scale: {e}"));

    match kind.as_str() {
        "Deployment" | "deployments" => {
            Api::<Deployment>::namespaced(client, ns)
                .patch(&name, &pp, &Patch::Strategic(patch))
                .await
                .map_err(map_err)?;
        }
        "StatefulSet" | "statefulsets" => {
            Api::<StatefulSet>::namespaced(client, ns)
                .patch(&name, &pp, &Patch::Strategic(patch))
                .await
                .map_err(map_err)?;
        }
        "ReplicaSet" | "replicasets" => {
            Api::<ReplicaSet>::namespaced(client, ns)
                .patch(&name, &pp, &Patch::Strategic(patch))
                .await
                .map_err(map_err)?;
        }
        other => {
            return Err(AppError::Invalid(format!("scale not supported for {other}")));
        }
    }
    info!(kind, ns, name, replicas, "scaled");
    Ok(())
}

// ---------------------------------------------------------------------------
// restart_pod / restart_rollout
// ---------------------------------------------------------------------------

/// Delete a pod. The Deployment/StatefulSet controller will recreate
/// it — same effect as `kubectl delete pod`.
#[tauri::command]
pub async fn restart_pod(
    namespace: Option<String>,
    name: String,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<()> {
    let mgr_arc: Arc<ClientManager> = (*mgr).clone();
    let client = mgr_arc.client().await?;
    let ns = namespace.as_deref().unwrap_or("default");
    let dp = kube::api::DeleteParams::default();
    Api::<Pod>::namespaced(client, ns)
        .delete(&name, &dp)
        .await
        .map_err(|e| AppError::msg(format!("delete pod: {e}")))?;
    info!(ns, name, "pod deleted (controller will recreate)");
    Ok(())
}

/// Trigger a rollout restart of a Deployment/StatefulSet/DaemonSet by
/// stamping `kubectl.kubernetes.io/restartedAt` on the pod template.
#[tauri::command]
pub async fn restart_rollout(
    kind: String,
    namespace: Option<String>,
    name: String,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<()> {
    let mgr_arc: Arc<ClientManager> = (*mgr).clone();
    let client = mgr_arc.client().await?;
    let ns = namespace.as_deref().unwrap_or("default");
    let now = chrono::Utc::now().to_rfc3339();
    let pp = PatchParams::default();
    let map_err = |e: kube_client::Error| AppError::msg(format!("restart: {e}"));

    match kind.as_str() {
        "Deployment" | "deployments" => {
            let patch = serde_json::json!({
                "spec": {
                    "template": {
                        "metadata": {
                            "annotations": { "kubectl.kubernetes.io/restartedAt": now }
                        }
                    }
                }
            });
            Api::<Deployment>::namespaced(client, ns)
                .patch(&name, &pp, &Patch::Strategic(patch))
                .await
                .map_err(map_err)?;
        }
        "StatefulSet" | "statefulsets" => {
            let patch = serde_json::json!({
                "spec": {
                    "template": {
                        "metadata": {
                            "annotations": { "kubectl.kubernetes.io/restartedAt": now }
                        }
                    }
                }
            });
            Api::<StatefulSet>::namespaced(client, ns)
                .patch(&name, &pp, &Patch::Strategic(patch))
                .await
                .map_err(map_err)?;
        }
        "DaemonSet" | "daemonsets" => {
            let patch = serde_json::json!({
                "spec": {
                    "template": {
                        "metadata": {
                            "annotations": { "kubectl.kubernetes.io/restartedAt": now }
                        }
                    }
                }
            });
            Api::<k8s_openapi::api::apps::v1::DaemonSet>::namespaced(client, ns)
                .patch(&name, &pp, &Patch::Strategic(patch))
                .await
                .map_err(map_err)?;
        }
        other => {
            return Err(AppError::Invalid(format!(
                "restart_rollout not supported for {other}"
            )));
        }
    }
    info!(kind, ns, name, "rollout restart triggered");
    Ok(())
}

// ---------------------------------------------------------------------------
// set_cordon
// ---------------------------------------------------------------------------

/// Mark a node schedulable (`unschedulable=false`) or unschedulable
/// (`true`). Cordon stops new pods from landing; existing pods keep
/// running.
#[tauri::command]
pub async fn set_cordon(
    node: String,
    unschedulable: bool,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<()> {
    let mgr_arc: Arc<ClientManager> = (*mgr).clone();
    let client = mgr_arc.client().await?;
    let patch = serde_json::json!({ "spec": { "unschedulable": unschedulable } });
    Api::<Node>::all(client)
        .patch(&node, &PatchParams::default(), &Patch::Strategic(patch))
        .await
        .map_err(|e| AppError::msg(format!("cordon: {e}")))?;
    info!(node, unschedulable, "node cordon set");
    Ok(())
}

// ---------------------------------------------------------------------------
// drain_node
// ---------------------------------------------------------------------------

/// Drain a node: cordon it, then evict every pod on it.
///
/// Pods that have a `PodDisruptionBudget` blocking eviction will fail
/// (we report the error to the caller so the UI can show the
/// remainder). Best-effort: we don't roll back on partial failure.
#[tauri::command]
pub async fn drain_node(node: String, mgr: State<'_, Arc<ClientManager>>) -> AppResult<()> {
    let mgr_arc: Arc<ClientManager> = (*mgr).clone();
    let client = mgr_arc.client().await?;

    // 1) Cordon.
    let patch = serde_json::json!({ "spec": { "unschedulable": true } });
    Api::<Node>::all(client.clone())
        .patch(&node, &PatchParams::default(), &Patch::Strategic(patch))
        .await
        .map_err(|e| AppError::msg(format!("drain (cordon): {e}")))?;

    // 2) List pods on the node.
    let lp = kube::api::ListParams {
        field_selector: Some(format!("spec.nodeName={node}")),
        ..Default::default()
    };
    let pods = Api::<Pod>::all(client.clone())
        .list(&lp)
        .await
        .map_err(|e| AppError::msg(format!("drain (list): {e}")))?;

    // 3) Evict each. Skip mirror / daemonset pods (they shouldn't
    //    be evicted by a drain — let the user handle them).
    let mut evicted: usize = 0;
    let mut skipped: usize = 0;
    let mut failed: Vec<String> = Vec::new();
    let ep = kube::api::EvictParams::default();
    for p in &pods.items {
        let name = p.meta().name.clone().unwrap_or_default();
        let ns = p.meta().namespace.clone().unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        // Skip DaemonSet pods — eviction of these by drain is a no-op
        // and they need to be --ignore-daemonsets to be removed.
        if has_owner_kind(p, "DaemonSet") {
            skipped += 1;
            continue;
        }
        match Api::<Pod>::namespaced(client.clone(), &ns)
            .evict(&name, &ep)
            .await
        {
            Ok(_) => evicted += 1,
            Err(e) => failed.push(format!("{ns}/{name}: {e}")),
        }
    }

    if !failed.is_empty() {
        return Err(AppError::msg(format!(
            "drain: {evicted} evicted, {skipped} daemonset-skipped, {} failed: {}",
            failed.len(),
            failed.join("; ")
        )));
    }
    info!(node, evicted, skipped, "node drained");
    Ok(())
}

fn has_owner_kind(p: &Pod, kind: &str) -> bool {
    p.meta()
        .owner_references
        .as_ref()
        .map(|refs| refs.iter().any(|o| o.kind == kind))
        .unwrap_or(false)
}

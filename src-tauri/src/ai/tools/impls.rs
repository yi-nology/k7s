//! Shared tool implementations — the canonical logic for every tool.
//!
//! Both the AI module's `Tool::call()` and the MCP server's `#[tool]` handlers
//! call into these functions. This eliminates duplication and ensures both
//! surfaces behave identically.
//!
//! Each function takes a `&ClientManager` + raw args, returns
//! `AppResult<serde_json::Value>`. The caller (AI or MCP) wraps the result
//! in its own error/result type.

use crate::core::shell_common;
use crate::error::{AppError, AppResult};
use crate::kube::manager::ClientManager;
use kube::api::{Api, DeleteParams, DynamicObject, ListParams, Patch, PatchParams, PostParams};
use kube::ResourceExt;

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

/// List resources of a kind. Returns `[{name, namespace, kind, summary}]`.
pub async fn list_resources_impl(
    manager: &ClientManager,
    kind: &str,
    namespace: &str,
    label_selector: Option<&str>,
) -> AppResult<serde_json::Value> {
    let client = manager.client().await.ok_or(AppError::Disconnected)?;
    let (api, _is_helm) = shell_common::dynamic_api(client, kind, namespace, manager).await?;
    let mut lp = ListParams::default();
    if let Some(ls) = label_selector {
        if !ls.trim().is_empty() {
            lp = lp.labels(ls);
        }
    }
    let list: kube::api::ObjectList<DynamicObject> = api.list(&lp).await?;
    let rows: Vec<serde_json::Value> = list
        .iter()
        .map(|obj| {
            serde_json::json!({
                "name": obj.name_any(),
                "namespace": obj.metadata.namespace,
                "kind": kind,
            })
        })
        .collect();
    Ok(serde_json::json!(rows))
}

/// Describe a resource (structured JSON, managedFields stripped).
pub async fn describe_resource_impl(
    manager: &ClientManager,
    kind: &str,
    namespace: &str,
    name: &str,
) -> AppResult<serde_json::Value> {
    let client = manager.client().await.ok_or(AppError::Disconnected)?;
    let (api, _) = shell_common::dynamic_api(client, kind, namespace, manager).await?;
    let mut obj: DynamicObject = api.get(name).await?;
    obj.metadata.managed_fields = None;
    serde_json::to_value(&obj).map_err(|e| AppError::Other(e.to_string()))
}

/// Get resource YAML (managedFields stripped, secrets redacted).
pub async fn get_resource_yaml_impl(
    manager: &ClientManager,
    kind: &str,
    namespace: &str,
    name: &str,
) -> AppResult<String> {
    let client = manager.client().await.ok_or(AppError::Disconnected)?;
    let (api, _) = shell_common::dynamic_api(client, kind, namespace, manager).await?;
    let mut obj: DynamicObject = api.get(name).await?;
    obj.metadata.managed_fields = None;
    if kind == "secrets" {
        // Redact secret data fields. DynamicObject.data is the whole object body;
        // Kubernetes Secrets have `data` and optionally `stringData` keys inside it.
        if let Some(map) = obj.data.as_object_mut() {
            for key in &["data", "stringData"] {
                if let Some(inner) = map.get_mut(*key) {
                    if let Some(inner_map) = inner.as_object_mut() {
                        for v in inner_map.values_mut() {
                            *v = serde_json::Value::String("***".to_string());
                        }
                    }
                }
            }
        }
    }
    serde_yaml::to_string(&obj).map_err(|e| AppError::Yaml(e.to_string()))
}

/// Get events for a resource.
pub async fn get_events_impl(
    manager: &ClientManager,
    kind: &str,
    namespace: &str,
    name: &str,
) -> AppResult<serde_json::Value> {
    let client = manager.client().await.ok_or(AppError::Disconnected)?;
    let involved_kind = match kind.rsplit('/').next().unwrap_or(kind) {
        "pods" => "Pod",
        "deployments" => "Deployment",
        "replicasets" => "ReplicaSet",
        "statefulsets" => "StatefulSet",
        "daemonsets" => "DaemonSet",
        "jobs" => "Job",
        "cronjobs" => "CronJob",
        "services" => "Service",
        "ingresses" => "Ingress",
        "configmaps" => "ConfigMap",
        "secrets" => "Secret",
        "persistentvolumeclaims" => "PersistentVolumeClaim",
        "nodes" => "Node",
        "namespaces" => "Namespace",
        other => other,
    };
    let events: Api<k8s_openapi::api::core::v1::Event> = if namespace.is_empty() {
        Api::all(client)
    } else {
        Api::namespaced(client, namespace)
    };
    let list = events
        .list(&ListParams::default().fields(&format!(
            "involvedObject.name={name},involvedObject.kind={involved_kind}"
        )))
        .await?;
    let rows: Vec<serde_json::Value> = list
        .iter()
        .map(|e| {
            serde_json::json!({
                "type": e.type_.clone().unwrap_or_default(),
                "reason": e.reason.clone().unwrap_or_default(),
                "message": e.message.clone().unwrap_or_default(),
                "count": e.count.unwrap_or(1),
            })
        })
        .collect();
    Ok(serde_json::json!(rows))
}

/// Get pod logs.
pub async fn get_pod_logs_impl(
    manager: &ClientManager,
    namespace: &str,
    pod: &str,
    container: Option<&str>,
    tail: Option<i64>,
    previous: bool,
) -> AppResult<serde_json::Value> {
    let client = manager.client().await.ok_or(AppError::Disconnected)?;
    let pods: Api<k8s_openapi::api::core::v1::Pod> = Api::namespaced(client, namespace);
    let lp = kube::api::LogParams {
        container: container.map(|s| s.to_string()),
        tail_lines: tail,
        previous,
        ..Default::default()
    };
    let logs = pods.logs(pod, &lp).await?;
    Ok(serde_json::json!({ "logs": logs }))
}

/// Cluster health snapshot.
pub async fn get_cluster_health_impl(manager: &ClientManager) -> AppResult<serde_json::Value> {
    let client = manager.client().await.ok_or(AppError::Disconnected)?;
    let nodes: kube::api::ObjectList<k8s_openapi::api::core::v1::Node> =
        Api::all(client.clone()).list(&Default::default()).await?;
    let pods: kube::api::ObjectList<k8s_openapi::api::core::v1::Pod> =
        Api::all(client).list(&Default::default()).await?;
    let mut problems = Vec::new();
    let nodes_ready = nodes
        .iter()
        .filter(|n| {
            let ready = n
                .status
                .as_ref()
                .and_then(|s| s.conditions.as_ref())
                .map(|cs| cs.iter().any(|c| c.type_ == "Ready" && c.status == "True"))
                .unwrap_or(false);
            if !ready {
                problems.push(format!("Node {} is NotReady", n.name_any()));
            }
            ready
        })
        .count();
    let pods_running = pods
        .iter()
        .filter(|p| {
            let phase = p
                .status
                .as_ref()
                .and_then(|s| s.phase.as_deref())
                .unwrap_or("");
            let name = p.name_any();
            let ns = p.metadata.namespace.clone().unwrap_or_default();
            match phase {
                "Running" => true,
                "Failed" => {
                    problems.push(format!("Pod {ns}/{name} is Failed"));
                    false
                }
                "Pending" => {
                    if let Some(cs) = p
                        .status
                        .as_ref()
                        .and_then(|s| s.container_statuses.as_ref())
                    {
                        for c in cs {
                            if let Some(w) = c.state.as_ref().and_then(|s| s.waiting.as_ref()) {
                                problems.push(format!(
                                    "Pod {ns}/{name} waiting: {} ({})",
                                    w.reason.as_deref().unwrap_or("?"),
                                    w.message.as_deref().unwrap_or("")
                                ));
                            }
                        }
                    }
                    false
                }
                _ => false,
            }
        })
        .count();
    Ok(serde_json::json!({
        "nodes_ready": nodes_ready,
        "nodes_total": nodes.items.len(),
        "pods_running": pods_running,
        "pods_total": pods.items.len(),
        "problems": problems,
    }))
}

// ---------------------------------------------------------------------------
// Write tools
// ---------------------------------------------------------------------------

/// Scale a workload.
pub async fn scale_resource_impl(
    manager: &ClientManager,
    kind: &str,
    namespace: &str,
    name: &str,
    replicas: i32,
) -> AppResult<serde_json::Value> {
    let client = manager.client().await.ok_or(AppError::Disconnected)?;
    shell_common::ensure_writable(kind)?;
    let (api, _) = shell_common::dynamic_api(client, kind, namespace, manager).await?;
    let patch = Patch::Merge(serde_json::json!({ "spec": { "replicas": replicas } }));
    api.patch(name, &PatchParams::default(), &patch).await?;
    Ok(
        serde_json::json!({ "scaled": true, "kind": kind, "namespace": namespace, "name": name, "replicas": replicas }),
    )
}

/// Restart a workload (rollout restart).
pub async fn restart_workload_impl(
    manager: &ClientManager,
    kind: &str,
    namespace: &str,
    name: &str,
) -> AppResult<serde_json::Value> {
    let client = manager.client().await.ok_or(AppError::Disconnected)?;
    if !crate::kube::restart::is_rollout_kind(kind) {
        return Err(AppError::Other(format!(
            "{kind} cannot be rollout-restarted"
        )));
    }
    let (api, _) = shell_common::dynamic_api(client, kind, namespace, manager).await?;
    let now = chrono::Utc::now().to_rfc3339();
    let patch = Patch::Merge(crate::kube::restart::restart_patch(&now));
    api.patch(name, &PatchParams::default(), &patch).await?;
    Ok(serde_json::json!({ "restarted": true, "kind": kind, "namespace": namespace, "name": name }))
}

/// Delete a resource.
pub async fn delete_resource_impl(
    manager: &ClientManager,
    kind: &str,
    namespace: &str,
    name: &str,
) -> AppResult<serde_json::Value> {
    let client = manager.client().await.ok_or(AppError::Disconnected)?;
    let (api, _) = shell_common::dynamic_api(client, kind, namespace, manager).await?;
    api.delete(name, &DeleteParams::default()).await?;
    Ok(serde_json::json!({ "deleted": true, "kind": kind, "namespace": namespace, "name": name }))
}

/// Apply a YAML manifest.
pub async fn apply_manifest_impl(
    manager: &ClientManager,
    yaml: &str,
    namespace: &str,
) -> AppResult<serde_json::Value> {
    let client = manager.client().await.ok_or(AppError::Disconnected)?;
    let obj: DynamicObject =
        serde_yaml::from_str(yaml).map_err(|e| AppError::Yaml(e.to_string()))?;
    let name = obj
        .metadata
        .name
        .clone()
        .ok_or_else(|| AppError::Other("manifest has no metadata.name".into()))?;
    let kind_str = obj
        .types
        .as_ref()
        .map(|t| t.kind.clone())
        .ok_or_else(|| AppError::Other("manifest has no apiVersion/kind".into()))?;
    let kind_id = match kind_str.as_str() {
        "Pod" => "pods",
        "Deployment" => "deployments",
        "StatefulSet" => "statefulsets",
        "DaemonSet" => "daemonsets",
        "Service" => "services",
        "ConfigMap" => "configmaps",
        "Namespace" => "namespaces",
        "Job" => "jobs",
        "CronJob" => "cronjobs",
        "Ingress" => "ingresses",
        "PersistentVolumeClaim" => "persistentvolumeclaims",
        other => return Err(AppError::Other(format!("unsupported kind: {other}"))),
    };
    shell_common::ensure_writable(kind_id)?;
    let (api, _) = shell_common::dynamic_api(client, kind_id, namespace, manager).await?;
    api.replace(&name, &PostParams::default(), &obj).await?;
    Ok(
        serde_json::json!({ "applied": true, "kind": kind_id, "namespace": namespace, "name": name }),
    )
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/// Diagnose unhealthy resources.
pub async fn diagnose_unhealthy_impl(
    manager: &ClientManager,
    namespace: Option<&str>,
) -> AppResult<serde_json::Value> {
    let client = manager.client().await.ok_or(AppError::Disconnected)?;
    let mut problems: Vec<serde_json::Value> = Vec::new();

    // Nodes.
    let nodes: kube::api::ObjectList<k8s_openapi::api::core::v1::Node> =
        Api::all(client.clone()).list(&Default::default()).await?;
    for n in nodes {
        let name = n.name_any();
        if let Some(conds) = n.status.as_ref().and_then(|s| s.conditions.as_ref()) {
            for c in conds {
                if c.type_ == "Ready" && c.status != "True" {
                    problems.push(serde_json::json!({ "severity": "critical", "resource": name, "kind": "node", "reason": "NotReady" }));
                }
                if c.status == "True"
                    && matches!(
                        c.type_.as_str(),
                        "DiskPressure" | "MemoryPressure" | "PIDPressure" | "NetworkUnavailable"
                    )
                {
                    problems.push(serde_json::json!({ "severity": "warning", "resource": name, "kind": "node", "reason": c.type_ }));
                }
            }
        }
    }

    // Pods.
    let pods: kube::api::ObjectList<k8s_openapi::api::core::v1::Pod> = match namespace {
        Some(ns) => Api::namespaced(client.clone(), ns),
        None => Api::all(client.clone()),
    }
    .list(&Default::default())
    .await?;
    for p in pods {
        let ns = p.metadata.namespace.clone().unwrap_or_default();
        let full = if ns.is_empty() {
            p.name_any()
        } else {
            format!("{}/{}", ns, p.name_any())
        };
        if let Some(cs) = p
            .status
            .as_ref()
            .and_then(|s| s.container_statuses.as_ref())
        {
            for c in cs {
                if let Some(w) = c.state.as_ref().and_then(|s| s.waiting.as_ref()) {
                    let reason = w.reason.as_deref().unwrap_or("Waiting");
                    if matches!(
                        reason,
                        "CrashLoopBackOff"
                            | "ImagePullBackOff"
                            | "ErrImagePull"
                            | "CreateContainerConfigError"
                    ) {
                        problems.push(serde_json::json!({ "severity": "critical", "resource": full, "kind": "pod", "reason": reason }));
                    }
                }
            }
        }
    }

    // Deployments.
    let deps: kube::api::ObjectList<k8s_openapi::api::apps::v1::Deployment> = match namespace {
        Some(ns) => Api::namespaced(client.clone(), ns),
        None => Api::all(client),
    }
    .list(&Default::default())
    .await?;
    for d in deps {
        let ns = d.metadata.namespace.clone().unwrap_or_default();
        let full = if ns.is_empty() {
            d.name_any()
        } else {
            format!("{}/{}", ns, d.name_any())
        };
        if let Some(status) = &d.status {
            let unavailable = status.unavailable_replicas.unwrap_or(0);
            if unavailable > 0 {
                problems.push(serde_json::json!({ "severity": "warning", "resource": full, "kind": "deployment", "reason": format!("{unavailable} unavailable replicas") }));
            }
        }
    }

    Ok(serde_json::json!({ "problems": problems }))
}

// ---------------------------------------------------------------------------
// New tools (not in the original AI 12)
// ---------------------------------------------------------------------------

/// Batch-get multiple resources at once.
pub async fn batch_get_impl(
    manager: &ClientManager,
    requests: &[serde_json::Value],
) -> AppResult<serde_json::Value> {
    let mut results = Vec::new();
    for req in requests {
        let kind = req.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let ns = req.get("namespace").and_then(|v| v.as_str()).unwrap_or("");
        let name = req.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let result = describe_resource_impl(manager, kind, ns, name).await;
        results.push(match result {
            Ok(v) => serde_json::json!({ "kind": kind, "namespace": ns, "name": name, "data": v }),
            Err(e) => serde_json::json!({ "kind": kind, "namespace": ns, "name": name, "error": e.to_string() }),
        });
    }
    Ok(serde_json::json!({ "results": results }))
}

/// Diff two resources or two versions of the same resource.
pub async fn diff_resources_impl(
    manager: &ClientManager,
    kind: &str,
    ns_a: &str,
    name_a: &str,
    ns_b: &str,
    name_b: &str,
) -> AppResult<serde_json::Value> {
    let yaml_a = get_resource_yaml_impl(manager, kind, ns_a, name_a).await?;
    let yaml_b = get_resource_yaml_impl(manager, kind, ns_b, name_b).await?;
    let same = yaml_a == yaml_b;
    Ok(serde_json::json!({
        "same": same,
        "resource_a": { "kind": kind, "namespace": ns_a, "name": name_a },
        "resource_b": { "kind": kind, "namespace": ns_b, "name": name_b },
        "yaml_a_lines": yaml_a.lines().count(),
        "yaml_b_lines": yaml_b.lines().count(),
    }))
}

/// HPA status for a workload.
pub async fn hpa_status_impl(
    manager: &ClientManager,
    namespace: &str,
) -> AppResult<serde_json::Value> {
    let client = manager.client().await.ok_or(AppError::Disconnected)?;
    let hpas: Api<k8s_openapi::api::autoscaling::v2::HorizontalPodAutoscaler> =
        Api::namespaced(client, namespace);
    let list = hpas.list(&ListParams::default()).await?;
    let rows: Vec<serde_json::Value> = list
        .iter()
        .map(|h| {
            let name = h.name_any();
            let spec = &h.spec;
            let status = h.status.as_ref();
            serde_json::json!({
                "name": name,
                "minReplicas": spec.min_replicas.unwrap_or(1),
                "maxReplicas": spec.max_replicas,
                "currentReplicas": status.as_ref().and_then(|s| s.current_replicas).unwrap_or(0),
                "targetCPU": spec.metrics.as_ref().and_then(|m| m.first()).map(|_| "configured"),
            })
        })
        .collect();
    Ok(serde_json::json!({ "hpas": rows }))
}

// ---------------------------------------------------------------------------
// Security audit
// ---------------------------------------------------------------------------

/// Run the RBAC security audit and return findings.
pub async fn security_audit_impl(manager: &ClientManager) -> AppResult<serde_json::Value> {
    let client = manager.client().await.ok_or(AppError::Disconnected)?;
    let report = crate::kube::security_audit::run_audit(client).await?;
    serde_json::to_value(report).map_err(|e| AppError::Other(e.to_string()))
}

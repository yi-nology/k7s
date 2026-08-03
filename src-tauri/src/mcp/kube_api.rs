//! Self-contained helpers for the MCP server: dynamic API resolution, list
//! operations, get-yaml, describe, and the small enum-and-string tables the
//! tools return.
//!
//! This module is a near copy of the helpers in `web::handlers` (and a few
//! from `commands`), trimmed of their Tauri-specific surface (`State<…>`,
//! `Json<…>`, `tauri::AppHandle`) so the MCP server can call them directly
//! with just a `kube::Client` and the manager's custom-kind registry. The
//! two implementations need to stay in sync — a kind that resolves here but
//! not in the web shell would be a hidden half-feature.
//!
//! Why a copy rather than a shared module: `web::handlers` is `pub mod
//! handlers;` under `#[cfg(feature = "web")]`, and importing from a feature
//! behind another feature would leak `axum` into a binary that doesn't need
//! it. Three duplicated helper functions are cheaper than that.

use crate::error::{AppError, AppResult};
use crate::kube::{client, helm, manager::ClientManager, properties};
use k8s_openapi::api::core::v1::{Event, Secret};
use kube::api::{Api, ApiResource, DynamicObject, ListParams, ObjectList};
use kube::config::{Config, KubeConfigOptions, Kubeconfig};
use kube::core::GroupVersionKind;
use kube::{Client, ResourceExt};
use serde::Serialize;

/// Alias for the k8s row DTO. The MCP server speaks rows for two places:
/// Helm's `map_release` returns `dto::Row`, and we'd reuse the same shape
/// for our own summaries — keeping the type public-but-aliased here means
/// callers see `kube_api::Row` and the source-of-truth lives next to the
/// rest of the wire DTOs.
pub use crate::kube::dto::Row as Row;

/// A compact read-only snapshot of a single resource, ready to ship to the AI
/// client. Field names are camelCase to match the rest of the wire format.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSummary {
    /// Built-in id (`pods`, `deployments`, …) or `group/plural` for CRDs.
    pub kind: String,
    pub namespace: Option<String>,
    pub name: String,
    /// Anything UI-relevant that won't fit in a one-liner. Always present, but
    /// may be empty for kinds that have no native concept of a row.
    pub summary: String,
}

/// Result of a successful connection: identity of the cluster and its API.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSummary {
    pub context: String,
    pub cluster: String,
    pub server: String,
    pub version: String,
}

/// Get a `kube::Client` from the manager, or return a `Disconnected` error the
/// tools can convert to a "call connect first" message.
pub async fn require_client(manager: &ClientManager) -> AppResult<Client> {
    manager.client().await.ok_or(AppError::Disconnected)
}

// ---------------------------------------------------------------------------
// List resources
// ---------------------------------------------------------------------------

/// List rows for a built-in or custom kind. `kind` is the lowercase id; an id
/// containing `/` is treated as a CRD id. `namespace` is ignored for
/// cluster-scoped kinds and for the special `helm` kind.
pub async fn list_resources(
    manager: &ClientManager,
    kind: &str,
    namespace: Option<&str>,
    label_selector: Option<&str>,
) -> AppResult<Vec<ResourceSummary>> {
    let client = require_client(manager).await?;
    let (api, is_helm) = dynamic_api(client.clone(), kind, namespace.unwrap_or(""), manager).await?;

    if is_helm {
        return Ok(list_helm_rows(client, namespace.unwrap_or("")).await);
    }

    let mut lp = ListParams::default();
    if let Some(ls) = label_selector {
        if !ls.trim().is_empty() {
            lp = lp.labels(ls);
        }
    }

    let list: ObjectList<DynamicObject> = api.list(&lp).await?;
    Ok(list
        .items
        .into_iter()
        .map(|obj| {
            let namespace = obj.metadata.namespace.clone();
            let name = obj.name_any();
            ResourceSummary {
                kind: kind.to_string(),
                namespace,
                name,
                summary: summarise_object(&obj),
            }
        })
        .collect())
}

/// A one-line text rendering of any object — name, namespace, status, age.
/// Enough to scan a list without `kubectl get -o yaml`.
fn summarise_object(obj: &DynamicObject) -> String {
    let data = &obj.data;
    // Pull the kind id out of TypeMeta; falls back to "unknown" for stripped
    // objects (we lose the gvk after .data is round-tripped, so this is a
    // best-effort hint, not a contract).
    let kind_id = obj
        .types
        .as_ref()
        .map(|g| g.kind.as_str())
        .unwrap_or("unknown");
    let id = match kind_id {
        "Pod" => "pods",
        "Node" => "nodes",
        "Deployment" => "deployments",
        "StatefulSet" => "statefulsets",
        "DaemonSet" => "daemonsets",
        "ReplicaSet" => "replicasets",
        "Job" => "jobs",
        "CronJob" => "cronjobs",
        "Service" => "services",
        "Ingress" => "ingresses",
        "ConfigMap" => "configmaps",
        "Secret" => "secrets",
        "PersistentVolumeClaim" => "persistentvolumeclaims",
        "Namespace" => "namespaces",
        other => {
            // Custom kinds show as "group.plural/Kind.Name" — fine to leave
            // blank rather than guess.
            let _ = other;
            ""
        }
    };
    let status = data
        .get("status")
        .and_then(|s| s.as_object())
        .and_then(|s| match id {
            "pods" => s.get("phase").and_then(|v| v.as_str()).map(str::to_string),
            "nodes" => conditions_summary(s),
            "deployments" | "statefulsets" | "daemonsets" | "replicasets" => {
                s.get("readyReplicas")
                    .and_then(|v| v.as_i64())
                    .map(|r| {
                        let desired = data
                            .get("spec")
                            .and_then(|sp| sp.as_object())
                            .and_then(|sp| sp.get("replicas"))
                            .and_then(|v| v.as_i64())
                            .unwrap_or(r);
                        format!("{r}/{desired} ready")
                    })
            }
            "services" => {
                if s.get("loadBalancer")
                    .and_then(|lb| lb.get("ingress"))
                    .and_then(|ing| ing.as_array())
                    .map(|a| !a.is_empty())
                    .unwrap_or(false)
                {
                    Some("LoadBalancer".to_string())
                } else {
                    data.get("spec")
                        .and_then(|sp| sp.get("type"))
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                }
            }
            _ => None,
        });
    let status = status.unwrap_or_else(|| "—".to_string());
    let created = obj
        .metadata
        .creation_timestamp
        .as_ref()
        .map(|t| format!(" ({})", humanize_age_dt(&t.0)))
        .unwrap_or_default();
    format!("{status}{created}")
}

/// Compact "5m" / "3h" / "2d" age string from any k8s timestamp. Mirrors
/// `kube::mappers::humanize_duration` so the AI sees the same string the
/// UI does — duplicated here to keep the MCP module free of Tauri deps.
fn humanize_age_dt(t: &chrono::DateTime<chrono::Utc>) -> String {
    let secs = (chrono::Utc::now() - *t).num_seconds().max(0);
    humanize_duration(secs)
}

fn humanize_duration(mut secs: i64) -> String {
    if secs < 0 {
        secs = 0;
    }
    if secs < 60 {
        return format!("{secs}s");
    }
    if secs < 3600 {
        return format!("{}m{}", secs / 60, secs % 60);
    }
    if secs < 86_400 {
        return format!("{}h{}", secs / 3600, (secs % 3600) / 60);
    }
    format!("{}d{}", secs / 86_400, (secs % 86_400) / 3600)
}

fn conditions_summary(s: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    let arr = s.get("conditions")?.as_array()?;
    let mut states: Vec<&str> = arr
        .iter()
        .filter_map(|c| c.get("type").and_then(|t| t.as_str()))
        .filter(|t| *t == "Ready" || *t == "MemoryPressure" || *t == "DiskPressure")
        .collect();
    states.sort();
    if states.is_empty() {
        None
    } else {
        Some(states.join(","))
    }
}

// ---------------------------------------------------------------------------
// Get / describe
// ---------------------------------------------------------------------------

/// Fetch a resource as YAML (managedFields dropped, secrets redacted).
pub async fn get_resource_yaml(
    manager: &ClientManager,
    kind: &str,
    namespace: &str,
    name: &str,
) -> AppResult<String> {
    let client = require_client(manager).await?;
    let (api, is_helm) = dynamic_api(client.clone(), kind, namespace, manager).await?;
    if is_helm {
        return helm_manifest(client, namespace, name).await;
    }
    let mut obj = api.get(name).await?;
    obj.metadata.managed_fields = None;
    if kind == "secrets" {
        redact_secret(&mut obj);
    }
    Ok(serde_yaml::to_string(&obj)?)
}

/// Build the Properties panel for an object — same gather the Tauri
/// `get_properties` command runs. Returned as a pretty-printed JSON string
/// so the AI client can pick what it needs without a separate schema dance.
pub async fn describe_resource(
    manager: &ClientManager,
    kind: &str,
    namespace: &str,
    name: &str,
) -> AppResult<serde_json::Value> {
    let client = require_client(manager).await?;
    let properties = properties::gather(client, kind, namespace, name).await?;
    serde_json::to_value(properties).map_err(|e| AppError::Other(e.to_string()))
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Read events filtered to a single object, in the same shape the web/handlers
/// `get_events` produces.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRow {
    pub ty: String,
    pub reason: String,
    pub message: String,
    pub count: i32,
    /// Pre-formatted age — same string the UI shows.
    pub age: String,
}

pub async fn get_events(
    manager: &ClientManager,
    kind: &str,
    namespace: &str,
    name: &str,
) -> AppResult<Vec<EventRow>> {
    let client = require_client(manager).await?;
    let involved_name = name;
    let involved_kind = kind.rsplit('/').next().unwrap_or(kind);
    let involved_kind = match involved_kind {
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

    let events: Api<Event> = if namespace.is_empty() {
        Api::all(client)
    } else {
        Api::namespaced(client, namespace)
    };

    let list = events
        .list(&ListParams::default().fields(&format!(
            "involvedObject.name={involved_name},involvedObject.kind={involved_kind}"
        )))
        .await?;

    Ok(list
        .into_iter()
        .map(|e| EventRow {
            ty: e.type_.unwrap_or_default(),
            reason: e.reason.unwrap_or_default(),
            message: e.message.unwrap_or_default(),
            count: e.count.unwrap_or(1),
            age: e
                .last_timestamp
                .as_ref()
                .map(|t| humanize_age_dt(&t.0))
                .or_else(|| e.event_time.as_ref().map(|t| humanize_age_dt(&t.0)))
                .unwrap_or_default(),
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

/// Pull a one-shot snapshot of pod logs. `tail` caps how many lines come back
/// (None → server default). Returns the raw joined text.
pub async fn pod_logs(
    manager: &ClientManager,
    namespace: &str,
    pod: &str,
    container: Option<&str>,
    tail: Option<i64>,
    since_seconds: Option<i64>,
    previous: bool,
) -> AppResult<String> {
    let client = require_client(manager).await?;
    let pods: Api<k8s_openapi::api::core::v1::Pod> = Api::namespaced(client, namespace);
    let mut lp = kube::api::LogParams {
        follow: false,
        previous,
        ..Default::default()
    };
    if let Some(c) = container {
        if !c.is_empty() {
            lp.container = Some(c.to_string());
        }
    }
    if let Some(t) = tail {
        lp.tail_lines = Some(t);
    }
    if let Some(s) = since_seconds {
        lp.since_seconds = Some(s);
    }
    Ok(pods.logs(pod, &lp).await?)
}

// ---------------------------------------------------------------------------
// Helm
// ---------------------------------------------------------------------------

/// List Helm releases (latest revision per chart) by walking the release
/// Secrets cluster-wide.
async fn list_helm_rows(client: Client, namespace: &str) -> Vec<ResourceSummary> {
    let secrets: Api<Secret> = if namespace.is_empty() {
        Api::all(client)
    } else {
        Api::namespaced(client, namespace)
    };
    let Ok(list) = secrets.list(&ListParams::default().labels("owner=helm")).await else {
        return Vec::new();
    };

    // Keep the latest revision per (name, namespace). Mirrors `latest_only`
    // in `kube::helm`.
    use std::collections::HashMap;
    let mut latest: HashMap<(String, String), Row> = HashMap::new();
    for s in list {
        let Some(row) = helm::map_release(&s) else { continue };
        let name = row.name.clone();
        let ns = row.namespace.clone().unwrap_or_default();
        let key = (name.clone(), ns.clone());
        let rev: i32 = row
            .cells
            .get(4)
            .map(|c| c.text.parse().unwrap_or(0))
            .unwrap_or(0);
        match latest.get(&key) {
            Some(existing) => {
                let existing_rev: i32 = existing
                    .cells
                    .get(4)
                    .map(|c| c.text.parse().unwrap_or(0))
                    .unwrap_or(0);
                if rev > existing_rev {
                    latest.insert(key, row);
                }
            }
            None => {
                latest.insert(key, row);
            }
        }
    }

    let cell_text = |r: &Row, i: usize| r.cells.get(i).map(|c| c.text.clone()).unwrap_or_default();
    latest.into_values().map(|r| {
        // Take owned copies up front so the `cell_text` borrows below
        // don't fight with moving `r.name` into the result.
        let namespace = r.namespace.clone();
        let name = r.name.clone();
        let summary = format!("rev {} — {}", cell_text(&r, 4), cell_text(&r, 5));
        ResourceSummary {
            kind: "helm".to_string(),
            namespace,
            name,
            summary,
        }
    }).collect()
}

/// Read a Helm release's rendered manifest from its release Secret.
async fn helm_manifest(client: Client, namespace: &str, name: &str) -> AppResult<String> {
    let secrets: Api<Secret> = if namespace.is_empty() {
        Api::all(client)
    } else {
        Api::namespaced(client, namespace)
    };
    let list = secrets
        .list(
            &ListParams::default()
                .labels(&format!("owner=helm,name={name}"))
                .limit(1),
        )
        .await?;
    for s in list {
        if let Some(release) = helm::decode_release(&s) {
            return Ok(release.manifest);
        }
    }
    Err(AppError::Other(format!("no Helm release named {name}")))
}

// ---------------------------------------------------------------------------
// dynamic_api — ported from web/handlers so MCP and the web shell agree on
// what kinds resolve.
// ---------------------------------------------------------------------------

pub async fn dynamic_api(
    client: Client,
    kind: &str,
    namespace: &str,
    manager: &ClientManager,
) -> AppResult<(Api<DynamicObject>, bool)> {
    if kind == crate::kube::ResourceKind::Helm.id() {
        return Ok((Api::namespaced_with(client, namespace, &dummy_ar()), true));
    }
    if kind.contains('/') {
        let ck = manager
            .custom_kind(kind)
            .await
            .ok_or_else(|| AppError::Other(format!("unknown custom kind: {kind}")))?;
        let ar = ck.api_resource();
        return Ok((
            if ck.namespaced {
                Api::namespaced_with(client, namespace, &ar)
            } else {
                Api::all_with(client, &ar)
            },
            false,
        ));
    }
    let (group, version, k, namespaced) = match kind {
        "pods" => ("", "v1", "Pod", true),
        "deployments" => ("apps", "v1", "Deployment", true),
        "replicasets" => ("apps", "v1", "ReplicaSet", true),
        "statefulsets" => ("apps", "v1", "StatefulSet", true),
        "daemonsets" => ("apps", "v1", "DaemonSet", true),
        "jobs" => ("batch", "v1", "Job", true),
        "cronjobs" => ("batch", "v1", "CronJob", true),
        "services" => ("", "v1", "Service", true),
        "ingresses" => ("networking.k8s.io", "v1", "Ingress", true),
        "ingressclasses" => ("networking.k8s.io", "v1", "IngressClass", false),
        "configmaps" => ("", "v1", "ConfigMap", true),
        "secrets" => ("", "v1", "Secret", true),
        "serviceaccounts" => ("", "v1", "ServiceAccount", true),
        "persistentvolumeclaims" => ("", "v1", "PersistentVolumeClaim", true),
        "persistentvolumes" => ("", "v1", "PersistentVolume", false),
        "storageclasses" => ("storage.k8s.io", "v1", "StorageClass", false),
        "nodes" => ("", "v1", "Node", false),
        "namespaces" => ("", "v1", "Namespace", false),
        other => return Err(AppError::Other(format!("unknown kind: {other}"))),
    };
    let gvk = GroupVersionKind::gvk(group, version, k);
    let ar = ApiResource::from_gvk_with_plural(&gvk, kind);
    Ok((
        if namespaced {
            Api::namespaced_with(client, namespace, &ar)
        } else {
            Api::all_with(client, &ar)
        },
        false,
    ))
}

fn dummy_ar() -> ApiResource {
    let gvk = GroupVersionKind::gvk("helm.toolkit.fluxcd.io", "v2beta1", "HelmRelease");
    ApiResource::from_gvk_with_plural(&gvk, "helmreleases")
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/// Probe the API server for its git version. Used by `connect` and the
/// `status` tool.
pub async fn probe_version(client: &Client) -> AppResult<String> {
    client::probe_version(client).await
}

/// Read the kubeconfig (any file) and build a client for `context` in it.
/// Mirrors the same path the web shell takes when the user uploads a
/// kubeconfig through the browser.
pub async fn build_client_from_kubeconfig(
    kubeconfig: Kubeconfig,
    context: &str,
) -> AppResult<(Client, String)> {
    let options = KubeConfigOptions {
        context: Some(context.to_string()),
        cluster: None,
        user: None,
    };
    let config = Config::from_custom_kubeconfig(kubeconfig, &options)
        .await
        .map_err(|e| AppError::Kubeconfig(e.to_string()))?;
    let server = config.cluster_url.to_string();
    let client = Client::try_from(config)?;
    Ok((client, server))
}

pub fn redact_secret(obj: &mut DynamicObject) {
    for field in ["data", "stringData"] {
        if let Some(serde_json::Value::Object(map)) = obj.data.get_mut(field) {
            for v in map.values_mut() {
                if let serde_json::Value::String(s) = v {
                    *s = format!("<redacted: {} bytes>", s.len());
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// One-shot exec (non-interactive command execution)
// ---------------------------------------------------------------------------

/// Run a single command in a pod container and return its stdout. Non-TTY,
/// non-interactive — the right shape for an AI client that wants `kubectl exec
/// <pod> -- <cmd>` semantics rather than a long-lived shell session. The
/// container's stderr is merged into stdout so error messages reach the model.
pub async fn exec_capture(
    client: &Client,
    namespace: &str,
    pod: &str,
    container: Option<&str>,
    argv: Vec<String>,
) -> AppResult<String> {
    use k8s_openapi::api::core::v1::Pod;
    use tokio::io::AsyncReadExt;

    let api: Api<Pod> = Api::namespaced(client.clone(), namespace);
    let mut ap = kube::api::AttachParams::default()
        .stdin(false)
        .stdout(true)
        .stderr(true)
        .tty(false);
    if let Some(c) = container {
        if !c.is_empty() {
            ap = ap.container(c.to_string());
        }
    }
    let mut proc = api.exec(pod, argv, &ap).await?;
    let mut out = Vec::new();
    if let Some(mut stdout) = proc.stdout() {
        stdout
            .read_to_end(&mut out)
            .await
            .map_err(|e| AppError::Other(format!("exec stdout: {e}")))?;
    }
    // Drain stderr into the same buffer so the model sees error text too.
    if let Some(mut stderr) = proc.stderr() {
        let mut err_buf = Vec::new();
        stderr.read_to_end(&mut err_buf).await.ok();
        if !err_buf.is_empty() {
            if !out.is_empty() {
                out.push(b'\n');
            }
            out.extend_from_slice(&err_buf);
        }
    }
    let status_opt = proc
        .take_status()
        .ok_or_else(|| AppError::Other("no status channel".into()))?
        .await;
    let succeeded = status_opt
        .as_ref()
        .and_then(|s| s.status.as_deref())
        .map(|s| s == "Success")
        .unwrap_or(true);
    if !succeeded && out.is_empty() {
        return Err(AppError::Other(format!(
            "exec failed: {:?}",
            status_opt.and_then(|s| s.message)
        )));
    }
    Ok(String::from_utf8_lossy(&out).into_owned())
}

// ---------------------------------------------------------------------------
// Rollout status
// ---------------------------------------------------------------------------

/// A condition on a workload, mirroring the fields the UI shows.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkloadCondition {
    pub type_: String,
    pub status: String,
    pub reason: String,
    pub message: String,
}

/// The rollout state of a workload — what `kubectl rollout status` summarises
/// in one line, broken out so the model can reason about each field.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RolloutStatus {
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub desired: i64,
    pub ready: i64,
    pub updated: i64,
    pub available: i64,
    pub unavailable: Option<i64>,
    pub conditions: Vec<WorkloadCondition>,
    /// True when the rollout has converged.
    pub done: bool,
    /// A single human-readable summary, e.g. "deployment successfully rolled out".
    pub message: String,
}

/// Inspect a workload's rollout state. Accepts Deployment, StatefulSet,
/// DaemonSet, ReplicaSet — the four kinds `restart_rollout` can restart, so the
/// set of workloads whose rollout you can *read* matches the set you can *kick*.
pub async fn rollout_status(
    manager: &ClientManager,
    kind: &str,
    namespace: &str,
    name: &str,
) -> AppResult<RolloutStatus> {
    let client = require_client(manager).await?;
    if !matches!(kind, "deployments" | "statefulsets" | "daemonsets" | "replicasets") {
        return Err(AppError::Other(format!(
            "{kind} is not a rollout kind (use deployments, statefulsets, daemonsets, or replicasets)"
        )));
    }
    let (api, _) = dynamic_api(client, kind, namespace, manager).await?;
    let obj = api.get(name).await?;
    let status = obj.data.get("status").cloned().unwrap_or_default();
    let s = serde_json::json!(status);

    let i64_field = |key: &str| -> i64 {
        s.get(key).and_then(|v| v.as_i64()).unwrap_or(0)
    };
    let desired = i64_field("replicas");
    let updated = i64_field("updatedReplicas");
    let ready = i64_field("readyReplicas");
    let available = i64_field("availableReplicas");
    let unavailable = s.get("unavailableReplicas").and_then(|v| v.as_i64());

    let conditions: Vec<WorkloadCondition> = s
        .get("conditions")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .map(|c| WorkloadCondition {
                    type_: c.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    status: c.get("status").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    reason: c.get("reason").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    message: c.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    let progressing = conditions.iter().find(|c| c.type_ == "Progressing");
    let done = match (kind, progressing) {
        ("deployments", Some(c)) => c.reason == "NewReplicaSetAvailable",
        _ => desired > 0 && updated == desired && unavailable.unwrap_or(0) == 0,
    };
    let message = if done {
        format!("{kind} successfully rolled out")
    } else if updated < desired {
        format!("{updated} of {desired} updated")
    } else if unavailable.unwrap_or(0) > 0 {
        format!("{} unavailable", unavailable.unwrap_or(0))
    } else {
        "waiting for conditions".into()
    };

    Ok(RolloutStatus {
        kind: kind.to_string(),
        namespace: namespace.to_string(),
        name: name.to_string(),
        desired,
        ready,
        updated,
        available,
        unavailable,
        conditions,
        done,
        message,
    })
}

// ---------------------------------------------------------------------------
// Top pods / top nodes (metrics.k8s.io snapshot)
// ---------------------------------------------------------------------------

/// One pod's CPU/memory usage at a point in time.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopPod {
    pub namespace: String,
    pub pod: String,
    /// CPU in milli-cores (500m == 0.5 cores).
    pub cpu_millis: i64,
    /// Memory in bytes.
    pub mem_bytes: i64,
}

/// One node's CPU/memory usage and capacity.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopNode {
    pub node: String,
    pub cpu_millis: i64,
    pub mem_bytes: i64,
    pub cpu_capacity_millis: i64,
    pub mem_capacity_bytes: i64,
    /// 0–100, rounded to one decimal. 0 when capacity is unknown.
    pub cpu_percent: f64,
    pub mem_percent: f64,
}

#[derive(serde::Deserialize)]
struct MetricsList<T> {
    items: Vec<T>,
}
#[derive(serde::Deserialize)]
struct MetaName {
    name: String,
    #[serde(default)]
    namespace: String,
}
#[derive(serde::Deserialize)]
struct Usage {
    #[serde(default)]
    cpu: String,
    #[serde(default)]
    memory: String,
}
#[derive(serde::Deserialize)]
struct PodMetric {
    metadata: MetaName,
    containers: Vec<ContainerUsage>,
}
#[derive(serde::Deserialize)]
struct ContainerUsage {
    usage: Usage,
}
#[derive(serde::Deserialize)]
struct NodeMetric {
    metadata: MetaName,
    usage: Usage,
}

/// Snapshot of pod usage from metrics.k8s.io. Reuses the Quantity parsers from
/// `metrics.rs` (already `pub`). Returns pods sorted by CPU desc.
pub async fn top_pods(client: &Client, namespace: Option<&str>) -> AppResult<Vec<TopPod>> {
    let path = match namespace {
        Some(ns) if !ns.is_empty() => format!("/apis/metrics.k8s.io/v1beta1/namespaces/{ns}/pods"),
        _ => "/apis/metrics.k8s.io/v1beta1/pods".to_string(),
    };
    let req = http::Request::get(path)
        .body(Vec::new())
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let list: MetricsList<PodMetric> = client.request(req).await?;

    let mut rows: Vec<TopPod> = list
        .items
        .into_iter()
        .map(|pm| {
            let cpu: i64 = pm.containers.iter().map(|c| crate::kube::metrics::parse_cpu_millis(&c.usage.cpu)).sum();
            let mem: i64 = pm.containers.iter().map(|c| crate::kube::metrics::parse_mem_bytes(&c.usage.memory)).sum();
            TopPod {
                namespace: pm.metadata.namespace,
                pod: pm.metadata.name,
                cpu_millis: cpu,
                mem_bytes: mem,
            }
        })
        .collect();
    rows.sort_by(|a, b| b.cpu_millis.cmp(&a.cpu_millis));
    Ok(rows)
}

/// Snapshot of node usage + capacity from metrics.k8s.io and the Node objects.
pub async fn top_nodes(client: &Client) -> AppResult<Vec<TopNode>> {
    use k8s_openapi::api::core::v1::Node;

    let req = http::Request::get("/apis/metrics.k8s.io/v1beta1/nodes")
        .body(Vec::new())
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let list: MetricsList<NodeMetric> = client.request(req).await?;

    let nodes: Api<Node> = Api::all(client.clone());
    let node_objs = nodes.list(&ListParams::default()).await?;
    let mut alloc: std::collections::HashMap<String, (i64, i64)> = std::collections::HashMap::new();
    for n in node_objs.items {
        let name = n.metadata.name.clone().unwrap_or_default();
        if let Some(status) = &n.status {
            if let Some(a) = &status.allocatable {
                let cpu = a.get("cpu").map(|q| crate::kube::metrics::parse_cpu_millis(&q.0)).unwrap_or(0);
                let mem = a.get("memory").map(|q| crate::kube::metrics::parse_mem_bytes(&q.0)).unwrap_or(0);
                alloc.insert(name, (cpu, mem));
            }
        }
    }

    let mut rows: Vec<TopNode> = list
        .items
        .into_iter()
        .map(|nm| {
            let cpu = crate::kube::metrics::parse_cpu_millis(&nm.usage.cpu);
            let mem = crate::kube::metrics::parse_mem_bytes(&nm.usage.memory);
            let (acpu, amem) = alloc.get(&nm.metadata.name).copied().unwrap_or((0, 0));
            TopNode {
                cpu_percent: pct(cpu, acpu),
                mem_percent: pct(mem, amem),
                cpu_millis: cpu,
                mem_bytes: mem,
                cpu_capacity_millis: acpu,
                mem_capacity_bytes: amem,
                node: nm.metadata.name,
            }
        })
        .collect();
    rows.sort_by(|a, b| b.cpu_percent.partial_cmp(&a.cpu_percent).unwrap_or(std::cmp::Ordering::Equal));
    Ok(rows)
}

/// Percentage used/capacity, guarding divide-by-zero.
fn pct(used: i64, cap: i64) -> f64 {
    if cap <= 0 {
        0.0
    } else {
        (((used as f64 / cap as f64) * 1000.0).round()) / 10.0
    }
}

// ---------------------------------------------------------------------------
// API resources discovery (kubectl api-resources)
// ---------------------------------------------------------------------------

/// One entry in the api-resources table.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResourceInfo {
    pub name: String,
    pub singular_name: String,
    pub group: String,
    pub version: String,
    pub kind: String,
    pub namespaced: bool,
    pub verbs: Vec<String>,
}

/// Discover every resource the API server serves, like `kubectl api-resources`.
pub async fn list_api_resources(client: &Client) -> AppResult<Vec<ApiResourceInfo>> {
    let groups = kube::discovery::Discovery::new(client.clone())
        .run()
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;

    let mut rows = Vec::new();
    for group in groups.groups() {
        let version = group
            .preferred_version()
            .or_else(|| group.versions().next())
            .unwrap_or("");
        for (ar, caps) in group.versioned_resources(version) {
            // kube 0.99 renamed ApiCapabilities.verbs → operations. Drop
            // subresource-only entries (pods/exec etc.) that lack a top-level verb.
            if !caps.operations.iter().any(|v| matches!(v.as_str(), "get" | "list" | "create" | "delete")) {
                continue;
            }
            rows.push(ApiResourceInfo {
                name: ar.plural.clone(),
                // kube 0.99 dropped ApiResource.singular; kind is the PascalCase
                // singular, so its lowercase form is the closest faithful value.
                singular_name: ar.kind.to_ascii_lowercase(),
                group: group.name().to_string(),
                version: ar.version.clone(),
                kind: ar.kind.clone(),
                namespaced: caps.scope == kube::discovery::Scope::Namespaced,
                verbs: caps.operations.clone(),
            });
        }
    }
    rows.sort_by(|a, b| (&a.group, &a.kind).cmp(&(&b.group, &b.kind)));
    Ok(rows)
}

// ---------------------------------------------------------------------------
// Trigger CronJob
// ---------------------------------------------------------------------------

/// Manually create a Job from a CronJob (like `kubectl create job
/// --from=cronjob/<name>`). Returns the new Job's name.
pub async fn trigger_cronjob(
    client: &Client,
    namespace: &str,
    name: &str,
) -> AppResult<String> {
    use k8s_openapi::api::batch::v1::{CronJob, Job};
    use k8s_openapi::apimachinery::pkg::apis::meta::v1::{ObjectMeta, OwnerReference};
    use kube::api::PostParams;

    let cj_api: Api<CronJob> = Api::namespaced(client.clone(), namespace);
    let cj = cj_api.get(name).await?;
    let job_name = format!("{name}-manual-{}", chrono::Utc::now().timestamp());
    let job = Job {
        metadata: ObjectMeta {
            name: Some(job_name.clone()),
            namespace: Some(namespace.to_string()),
            annotations: Some({
                let mut m = std::collections::BTreeMap::new();
                m.insert(
                    "cronjob.kubernetes.io/instantiate".to_string(),
                    "manual".to_string(),
                );
                m
            }),
            owner_references: Some(vec![OwnerReference {
                api_version: "batch/v1".to_string(),
                kind: "CronJob".to_string(),
                name: name.to_string(),
                uid: cj.metadata.uid.clone().unwrap_or_default(),
                controller: Some(true),
                ..Default::default()
            }]),
            ..Default::default()
        },
        spec: cj.spec.and_then(|s| s.job_template.spec),
        ..Default::default()
    };
    let job_api: Api<Job> = Api::namespaced(client.clone(), namespace);
    job_api
        .create(&PostParams::default(), &job)
        .await
        .map_err(|e| AppError::Kube(format!("create job: {e}")))?;
    Ok(job_name)
}

//! Tauri command handlers exposed to the React frontend.

use crate::kube;
use crate::{AppState, PortForward};
use chrono::{DateTime, Utc};
use k8s_openapi::api::apps::v1::{DaemonSet, Deployment, ReplicaSet, StatefulSet};
use k8s_openapi::api::batch::v1::{CronJob, Job};
use k8s_openapi::api::core::v1::{
    ConfigMap, Event, Namespace, Node, PersistentVolumeClaim, Pod, Secret, Service,
};
use k8s_openapi::api::autoscaling::v1::HorizontalPodAutoscaler;
use kube_client::api::{Api, DeleteParams, ListParams, ResourceExt};
use kube_client::core::NamespaceResourceScope;
use kube_client::{Client, Resource};
use serde::Serialize;
use tauri::State;

type IntOrString = k8s_openapi::apimachinery::pkg::util::intstr::IntOrString;

// ---------------------------------------------------------------------------
// Shared row types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct NamespaceRow {
    pub name: String,
    pub status: String,
    pub age: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PodRow {
    pub name: String,
    pub namespace: String,
    pub status: String,
    pub ready: String,
    pub restarts: i32,
    pub age: String,
    pub node: String,
    pub ip: String,
    pub containers: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeRow {
    pub name: String,
    pub status: String,
    pub roles: String,
    pub age: String,
    pub version: String,
    pub internal_ip: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeploymentRow {
    pub name: String,
    pub namespace: String,
    pub ready: String,
    pub up_to_date: i32,
    pub available: i32,
    pub age: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatefulSetRow {
    pub name: String,
    pub namespace: String,
    pub ready: String,
    pub age: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DaemonSetRow {
    pub name: String,
    pub namespace: String,
    pub desired: i32,
    pub ready: i32,
    pub age: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReplicaSetRow {
    pub name: String,
    pub namespace: String,
    pub desired: i32,
    pub ready: String,
    pub age: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct JobRow {
    pub name: String,
    pub namespace: String,
    pub status: String,
    pub completions: String,
    pub age: String,
    pub duration: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CronJobRow {
    pub name: String,
    pub namespace: String,
    pub schedule: String,
    pub suspend: bool,
    pub last_schedule: String,
    pub age: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServiceRow {
    pub name: String,
    pub namespace: String,
    pub kind: String,
    pub cluster_ip: String,
    pub ports: String,
    pub age: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigMapRow {
    pub name: String,
    pub namespace: String,
    pub data_keys: i32,
    pub age: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SecretRow {
    pub name: String,
    pub namespace: String,
    pub kind: String,
    pub data_keys: i32,
    pub age: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PvcRow {
    pub name: String,
    pub namespace: String,
    pub status: String,
    pub volume: String,
    pub capacity: String,
    pub age: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HpaRow {
    pub name: String,
    pub namespace: String,
    pub reference: String,
    pub targets: String,
    pub min_replicas: i32,
    pub max_replicas: i32,
    pub age: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EventRow {
    pub namespace: String,
    pub name: String,
    pub kind: String,
    pub reason: String,
    pub message: String,
    pub object: String,
    pub count: i32,
    pub last_seen: String,
    pub type_: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResourceDetail {
    pub kind: String,
    pub name: String,
    pub namespace: String,
    pub yaml: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn make_client(
    state: &State<'_, AppState>,
) -> Result<Client, String> {
    let context = state.current_context.lock().map_err(|e| e.to_string())?.clone();
    kube::client_for_context(context.as_deref())
        .await
        .map_err(|e| e.to_string())
}

async fn list_all_or_ns<K, F, R>(
    state: &State<'_, AppState>,
    namespace: Option<String>,
    kind_name: &str,
    map: F,
) -> Result<Vec<R>, String>
where
    K: Resource<Scope = NamespaceResourceScope>
        + Clone
        + serde::de::DeserializeOwned
        + serde::Serialize
        + std::fmt::Debug
        + Send
        + Sync
        + 'static,
    <K as Resource>::DynamicType: Default,
    F: Fn(&K) -> R + Send + Sync,
{
    let client = make_client(state).await?;
    let api: Api<K> = match namespace.as_deref() {
        Some(ns) => Api::namespaced(client, ns),
        None => Api::all(client),
    };
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| format!("list {}: {}", kind_name, e))?;
    Ok(list.iter().map(map).collect())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_contexts() -> Result<Vec<kube::ContextInfo>, String> {
    let kc = kube::load_kubeconfig().map_err(|e| e.to_string())?;
    Ok(kube::summarize_contexts(&kc))
}

#[tauri::command]
pub async fn get_current_context(state: State<'_, AppState>) -> Result<Option<String>, String> {
    Ok(state.current_context.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub async fn set_current_context(name: String, state: State<'_, AppState>) -> Result<(), String> {
    *state.current_context.lock().map_err(|e| e.to_string())? = Some(name);
    Ok(())
}

#[tauri::command]
pub async fn list_namespaces(state: State<'_, AppState>) -> Result<Vec<NamespaceRow>, String> {
    list_all_cluster(&state, "namespaces", |ns: &Namespace| NamespaceRow {
        name: ns.name_any(),
        status: ns
            .status
            .as_ref()
            .and_then(|s| s.phase.clone())
            .unwrap_or_else(|| "Active".to_string()),
        age: age_of(ns.meta().creation_timestamp.as_ref()),
    })
    .await
}

#[tauri::command]
pub async fn list_pods(
    namespace: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<PodRow>, String> {
    list_all_or_ns(&state, namespace, "pods", pod_to_row).await
}

#[tauri::command]
pub async fn list_nodes(state: State<'_, AppState>) -> Result<Vec<NodeRow>, String> {
    list_all_cluster(&state, "nodes", |n: &Node| node_to_row(n)).await
}

async fn list_all_cluster<K, F, R>(
    state: &State<'_, AppState>,
    kind_name: &str,
    map: F,
) -> Result<Vec<R>, String>
where
    K: Resource
        + Clone
        + serde::de::DeserializeOwned
        + serde::Serialize
        + std::fmt::Debug
        + Send
        + Sync
        + 'static,
    <K as Resource>::DynamicType: Default,
    F: Fn(&K) -> R + Send + Sync,
{
    let client = make_client(state).await?;
    let api: Api<K> = Api::all(client);
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| format!("list {}: {}", kind_name, e))?;
    Ok(list.iter().map(map).collect())
}

#[tauri::command]
pub async fn list_deployments(
    namespace: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<DeploymentRow>, String> {
    list_all_or_ns::<Deployment, _, _>(&state, namespace, "deployments", |d: &Deployment| {
        let desired = d.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0);
        let ready = d
            .status
            .as_ref()
            .and_then(|s| s.ready_replicas)
            .unwrap_or(0);
        DeploymentRow {
            name: d.name_any(),
            namespace: d.namespace().unwrap_or_default(),
            ready: format!("{}/{}", ready, desired),
            up_to_date: d
                .status
                .as_ref()
                .and_then(|s| s.updated_replicas)
                .unwrap_or(0),
            available: d
                .status
                .as_ref()
                .and_then(|s| s.available_replicas)
                .unwrap_or(0),
            age: age_of(d.meta().creation_timestamp.as_ref()),
        }
    })
    .await
}

#[tauri::command]
pub async fn list_statefulsets(
    namespace: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<StatefulSetRow>, String> {
    list_all_or_ns::<StatefulSet, _, _>(&state, namespace, "statefulsets", |s: &StatefulSet| {
        let desired = s.spec.as_ref().and_then(|sp| sp.replicas).unwrap_or(0);
        let ready = s
            .status
            .as_ref()
            .and_then(|st| st.ready_replicas)
            .unwrap_or(0);
        StatefulSetRow {
            name: s.name_any(),
            namespace: s.namespace().unwrap_or_default(),
            ready: format!("{}/{}", ready, desired),
            age: age_of(s.meta().creation_timestamp.as_ref()),
        }
    })
    .await
}

#[tauri::command]
pub async fn list_daemonsets(
    namespace: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<DaemonSetRow>, String> {
    list_all_or_ns::<DaemonSet, _, _>(&state, namespace, "daemonsets", |d: &DaemonSet| {
        let desired = d
            .status
            .as_ref()
            .map(|s| s.desired_number_scheduled)
            .unwrap_or(0);
        let ready = d
            .status
            .as_ref()
            .map(|s| s.number_ready)
            .unwrap_or(0);
        DaemonSetRow {
            name: d.name_any(),
            namespace: d.namespace().unwrap_or_default(),
            desired,
            ready,
            age: age_of(d.meta().creation_timestamp.as_ref()),
        }
    })
    .await
}

#[tauri::command]
pub async fn list_replicasets(
    namespace: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ReplicaSetRow>, String> {
    list_all_or_ns::<ReplicaSet, _, _>(&state, namespace, "replicasets", |r: &ReplicaSet| {
        let desired = r.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0);
        let ready = r
            .status
            .as_ref()
            .and_then(|s| s.ready_replicas)
            .unwrap_or(0);
        ReplicaSetRow {
            name: r.name_any(),
            namespace: r.namespace().unwrap_or_default(),
            desired,
            ready: format!("{}/{}", ready, desired),
            age: age_of(r.meta().creation_timestamp.as_ref()),
        }
    })
    .await
}

#[tauri::command]
pub async fn list_jobs(
    namespace: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<JobRow>, String> {
    list_all_or_ns::<Job, _, _>(&state, namespace, "jobs", |j: &Job| {
        let status = j
            .status
            .as_ref()
            .and_then(|s| {
                if s.succeeded.unwrap_or(0) > 0 {
                    Some("Complete".to_string())
                } else if s.failed.unwrap_or(0) > 0 {
                    Some("Failed".to_string())
                } else if s.active.unwrap_or(0) > 0 {
                    Some("Running".to_string())
                } else {
                    Some("Pending".to_string())
                }
            })
            .unwrap_or_else(|| "Unknown".to_string());
        let completions = match (
            j.spec.as_ref().and_then(|s| s.completions),
            j.status.as_ref().and_then(|s| s.succeeded),
        ) {
            (Some(d), Some(s)) => format!("{}/{}", s, d),
            (Some(d), None) => format!("0/{}", d),
            _ => "-".to_string(),
        };
        let duration = j
            .status
            .as_ref()
            .and_then(|s| s.completion_time.as_ref().map(|t| t.0))
            .map(|end| {
                j.status
                    .as_ref()
                    .and_then(|s| s.start_time.as_ref().map(|t| t.0))
                    .map(|start| (end - start).num_seconds().to_string() + "s")
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        JobRow {
            name: j.name_any(),
            namespace: j.namespace().unwrap_or_default(),
            status,
            completions,
            age: age_of(j.meta().creation_timestamp.as_ref()),
            duration,
        }
    })
    .await
}

#[tauri::command]
pub async fn list_cronjobs(
    namespace: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<CronJobRow>, String> {
    list_all_or_ns::<CronJob, _, _>(&state, namespace, "cronjobs", |c: &CronJob| {
        let schedule = c
            .spec
            .as_ref()
            .map(|s| s.schedule.clone())
            .unwrap_or_default();
        let suspend = c
            .spec
            .as_ref()
            .and_then(|s| s.suspend)
            .unwrap_or(false);
        let last_schedule = c
            .status
            .as_ref()
            .and_then(|s| s.last_schedule_time.as_ref().map(|t| t.0))
            .map(format_chrono_dt)
            .unwrap_or_else(|| "<none>".to_string());
        CronJobRow {
            name: c.name_any(),
            namespace: c.namespace().unwrap_or_default(),
            schedule,
            suspend,
            last_schedule,
            age: age_of(c.meta().creation_timestamp.as_ref()),
        }
    })
    .await
}

#[tauri::command]
pub async fn list_services(
    namespace: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ServiceRow>, String> {
    list_all_or_ns::<Service, _, _>(&state, namespace, "services", |s: &Service| {
        let ports = s
            .spec
            .as_ref()
            .and_then(|spec| {
                spec.ports.as_ref().map(|ports| {
                    ports
                        .iter()
                        .map(|p| {
                            let proto = p
                                .protocol
                                .clone()
                                .unwrap_or_else(|| "TCP".to_string());
                            format!(
                                "{}{}/{}",
                                p.port,
                                p.target_port
                                    .as_ref()
                                    .map(|tp| match tp {
                                        IntOrString::Int(i) => i.to_string(),
                                        IntOrString::String(s) => s.clone(),
                                    })
                                    .unwrap_or_default(),
                                proto
                            )
                        })
                        .collect::<Vec<_>>()
                        .join(",")
                })
            })
            .unwrap_or_default();
        let kind = s
            .spec
            .as_ref()
            .and_then(|spec| spec.type_.clone())
            .unwrap_or_else(|| "ClusterIP".to_string());
        ServiceRow {
            name: s.name_any(),
            namespace: s.namespace().unwrap_or_default(),
            kind,
            cluster_ip: s
                .spec
                .as_ref()
                .and_then(|spec| spec.cluster_ip.clone())
                .unwrap_or_default(),
            ports,
            age: age_of(s.meta().creation_timestamp.as_ref()),
        }
    })
    .await
}

#[tauri::command]
pub async fn list_configmaps(
    namespace: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ConfigMapRow>, String> {
    list_all_or_ns::<ConfigMap, _, _>(&state, namespace, "configmaps", |c: &ConfigMap| {
        let data_keys = c
            .data
            .as_ref()
            .map(|d| d.len() as i32)
            .or_else(|| c.binary_data.as_ref().map(|d| d.len() as i32))
            .unwrap_or(0);
        ConfigMapRow {
            name: c.name_any(),
            namespace: c.namespace().unwrap_or_default(),
            data_keys,
            age: age_of(c.meta().creation_timestamp.as_ref()),
        }
    })
    .await
}

#[tauri::command]
pub async fn list_secrets(
    namespace: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<SecretRow>, String> {
    list_all_or_ns::<Secret, _, _>(&state, namespace, "secrets", |s: &Secret| {
        let kind = s
            .type_
            .clone()
            .unwrap_or_else(|| "Opaque".to_string());
        let data_keys = s
            .data
            .as_ref()
            .map(|d| d.len() as i32)
            .unwrap_or(0);
        SecretRow {
            name: s.name_any(),
            namespace: s.namespace().unwrap_or_default(),
            kind,
            data_keys,
            age: age_of(s.meta().creation_timestamp.as_ref()),
        }
    })
    .await
}

#[tauri::command]
pub async fn list_pvc(
    namespace: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<PvcRow>, String> {
    list_all_or_ns::<PersistentVolumeClaim, _, _>(&state, namespace, "persistentvolumeclaims", |p: &PersistentVolumeClaim| {
        let status = p
            .status
            .as_ref()
            .and_then(|s| s.phase.clone())
            .unwrap_or_else(|| "-".to_string());
        let volume = p
            .spec
            .as_ref()
            .and_then(|s| s.volume_name.clone())
            .unwrap_or_default();
        let capacity = p
            .status
            .as_ref()
            .and_then(|s| s.capacity.as_ref())
            .and_then(|m| m.get("storage"))
            .map(|q| format!("{}", q.0))
            .unwrap_or_default();
        PvcRow {
            name: p.name_any(),
            namespace: p.namespace().unwrap_or_default(),
            status,
            volume,
            capacity,
            age: age_of(p.meta().creation_timestamp.as_ref()),
        }
    })
    .await
}

#[tauri::command]
pub async fn list_hpa(
    namespace: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<HpaRow>, String> {
    list_all_or_ns::<HorizontalPodAutoscaler, _, _>(&state, namespace, "horizontalpodautoscalers", |h: &HorizontalPodAutoscaler| {
        let reference = h
            .spec
            .as_ref()
            .map(|s| format!("{}/{}", s.scale_target_ref.kind, s.scale_target_ref.name))
            .unwrap_or_default();
        let min_replicas = h
            .spec
            .as_ref()
            .and_then(|s| s.min_replicas)
            .unwrap_or(0);
        let max_replicas = h.spec.as_ref().map(|s| s.max_replicas).unwrap_or(0);
        let current = h
            .status
            .as_ref()
            .map(|s| s.current_replicas)
            .unwrap_or(0);
        let desired = h
            .status
            .as_ref()
            .map(|s| s.desired_replicas)
            .unwrap_or(0);
        HpaRow {
            name: h.name_any(),
            namespace: h.namespace().unwrap_or_default(),
            reference,
            targets: format!("{}/{}", current, desired),
            min_replicas,
            max_replicas,
            age: age_of(h.meta().creation_timestamp.as_ref()),
        }
    })
    .await
}

#[tauri::command]
pub async fn list_events(
    namespace: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<EventRow>, String> {
    list_all_or_ns(&state, namespace, "events", |e: &Event| {
        let object = format!(
            "{}/{}",
            e.involved_object.kind.as_deref().unwrap_or("?"),
            e.involved_object.name.as_deref().unwrap_or("?")
        );
        let type_ = e.type_.clone().unwrap_or_default();
        let kind = e.involved_object.kind.clone().unwrap_or_default();
        let reason = e.reason.clone().unwrap_or_default();
        let message = e.message.clone().unwrap_or_default();
        let count: i32 = e.count.unwrap_or(0);
        // event_time is MicroTime (whole seconds), last_timestamp is Time (with sub-second precision)
        let last_seen = e
            .last_timestamp
            .as_ref()
            .map(|t| format_chrono_dt(t.0))
            .or_else(|| {
                e.event_time
                    .as_ref()
                    .map(|t| format_chrono_dt(t.0))
            })
            .or_else(|| {
                e.metadata
                    .creation_timestamp
                    .as_ref()
                    .map(|t| format_chrono_dt(t.0))
            })
            .unwrap_or_default();
        EventRow {
            namespace: e.namespace().unwrap_or_default(),
            name: e.name_any(),
            kind,
            reason,
            message,
            object,
            count,
            last_seen,
            type_,
        }
    })
    .await
}

// ---------------------------------------------------------------------------
// Detail + delete
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_yaml(
    kind: String,
    namespace: Option<String>,
    name: String,
    state: State<'_, AppState>,
) -> Result<ResourceDetail, String> {
    let client = make_client(&state).await?;
    let yaml = get_yaml_for_kind(&client, &kind, namespace.as_deref(), &name).await?;
    Ok(ResourceDetail {
        kind,
        name,
        namespace: namespace.unwrap_or_default(),
        yaml,
    })
}

async fn get_yaml_for_kind(
    client: &Client,
    kind: &str,
    namespace: Option<&str>,
    name: &str,
) -> Result<String, String> {
    let ns = namespace.unwrap_or("default");
    match kind {
        "Pod" | "pods" => get_one_ns::<Pod>(client, ns, name).await,
        "Deployment" | "deployments" => get_one_ns::<Deployment>(client, ns, name).await,
        "StatefulSet" | "statefulsets" => get_one_ns::<StatefulSet>(client, ns, name).await,
        "DaemonSet" | "daemonsets" => get_one_ns::<DaemonSet>(client, ns, name).await,
        "ReplicaSet" | "replicasets" => get_one_ns::<ReplicaSet>(client, ns, name).await,
        "Job" | "jobs" => get_one_ns::<Job>(client, ns, name).await,
        "CronJob" | "cronjobs" => get_one_ns::<CronJob>(client, ns, name).await,
        "Service" | "services" => get_one_ns::<Service>(client, ns, name).await,
        "ConfigMap" | "configmaps" => get_one_ns::<ConfigMap>(client, ns, name).await,
        "Secret" | "secrets" => get_one_ns::<Secret>(client, ns, name).await,
        "PersistentVolumeClaim" | "persistentvolumeclaims" | "pvc" => {
            get_one_ns::<PersistentVolumeClaim>(client, ns, name).await
        }
        "HorizontalPodAutoscaler" | "horizontalpodautoscalers" | "hpa" => {
            get_one_ns::<HorizontalPodAutoscaler>(client, ns, name).await
        }
        "Node" | "nodes" => get_one_cluster::<Node>(client, name).await,
        "Namespace" | "namespaces" => get_one_cluster::<Namespace>(client, name).await,
        "Event" | "events" => get_one_ns::<Event>(client, ns, name).await,
        other => Err(format!("unsupported resource kind: {}", other)),
    }
}

async fn get_one_ns<K>(
    client: &Client,
    namespace: &str,
    name: &str,
) -> Result<String, String>
where
    K: Resource<Scope = NamespaceResourceScope>
        + Clone
        + serde::Serialize
        + for<'de> serde::de::Deserialize<'de>
        + std::fmt::Debug
        + Send
        + Sync
        + 'static,
    <K as Resource>::DynamicType: Default,
{
    let api: Api<K> = Api::namespaced(client.clone(), namespace);
    let obj = api
        .get(name)
        .await
        .map_err(|e| format!("get: {}", e))?;
    serde_yaml::to_string(&obj).map_err(|e| format!("serialize: {}", e))
}

async fn get_one_cluster<K>(
    client: &Client,
    name: &str,
) -> Result<String, String>
where
    K: Resource
        + Clone
        + serde::Serialize
        + for<'de> serde::de::Deserialize<'de>
        + std::fmt::Debug
        + Send
        + Sync
        + 'static,
    <K as Resource>::DynamicType: Default,
{
    let api: Api<K> = Api::all(client.clone());
    let obj = api
        .get(name)
        .await
        .map_err(|e| format!("get: {}", e))?;
    serde_yaml::to_string(&obj).map_err(|e| format!("serialize: {}", e))
}

#[tauri::command]
pub async fn delete_resource(
    kind: String,
    namespace: Option<String>,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let client = make_client(&state).await?;
    delete_for_kind(&client, &kind, namespace.as_deref(), &name).await
}

async fn delete_for_kind(
    client: &Client,
    kind: &str,
    namespace: Option<&str>,
    name: &str,
) -> Result<(), String> {
    let dp = DeleteParams::default();
    let ns = namespace.unwrap_or("default");
    let map_err = |e: kube_client::Error| format!("delete: {}", e);
    match kind {
        "Pod" | "pods" => Api::<Pod>::namespaced(client.clone(), ns)
            .delete(name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "Deployment" | "deployments" => Api::<Deployment>::namespaced(client.clone(), ns)
            .delete(name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "StatefulSet" | "statefulsets" => Api::<StatefulSet>::namespaced(client.clone(), ns)
            .delete(name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "DaemonSet" | "daemonsets" => Api::<DaemonSet>::namespaced(client.clone(), ns)
            .delete(name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "ReplicaSet" | "replicasets" => Api::<ReplicaSet>::namespaced(client.clone(), ns)
            .delete(name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "Job" | "jobs" => Api::<Job>::namespaced(client.clone(), ns)
            .delete(name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "CronJob" | "cronjobs" => Api::<CronJob>::namespaced(client.clone(), ns)
            .delete(name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "Service" | "services" => Api::<Service>::namespaced(client.clone(), ns)
            .delete(name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "ConfigMap" | "configmaps" => Api::<ConfigMap>::namespaced(client.clone(), ns)
            .delete(name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "Secret" | "secrets" => Api::<Secret>::namespaced(client.clone(), ns)
            .delete(name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "PersistentVolumeClaim" | "persistentvolumeclaims" | "pvc" => {
            Api::<PersistentVolumeClaim>::namespaced(client.clone(), ns)
                .delete(name, &dp)
                .await
                .map(|_| ())
                .map_err(map_err)
        }
        "HorizontalPodAutoscaler" | "horizontalpodautoscalers" | "hpa" => {
            Api::<HorizontalPodAutoscaler>::namespaced(client.clone(), ns)
                .delete(name, &dp)
                .await
                .map(|_| ())
                .map_err(map_err)
        }
        "Namespace" | "namespaces" => Api::<Namespace>::all(client.clone())
            .delete(name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        other => Err(format!("unsupported resource kind: {}", other)),
    }
}

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

fn pod_to_row(p: &Pod) -> PodRow {
    let phase = p
        .status
        .as_ref()
        .and_then(|s| s.phase.clone())
        .unwrap_or_else(|| "Unknown".to_string());

    let (ready, restarts) = p
        .status
        .as_ref()
        .map(|s| {
            let total = s.container_statuses.as_ref().map(|c| c.len()).unwrap_or(0);
            let ready_count = s
                .container_statuses
                .as_ref()
                .map(|cs| cs.iter().filter(|c| c.ready).count())
                .unwrap_or(0);
            let restarts = s
                .container_statuses
                .as_ref()
                .map(|cs| cs.iter().map(|c| c.restart_count).sum())
                .unwrap_or(0);
            (format!("{}/{}", ready_count, total), restarts)
        })
        .unwrap_or_else(|| ("0/0".to_string(), 0));

    let containers = p
        .spec
        .as_ref()
        .map(|spec| {
            spec.containers
                .iter()
                .map(|c| c.name.clone())
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default();

    PodRow {
        name: p.name_any(),
        namespace: p.namespace().unwrap_or_default(),
        status: phase,
        ready,
        restarts,
        age: age_of(p.meta().creation_timestamp.as_ref()),
        node: p.spec.as_ref().and_then(|s| s.node_name.clone()).unwrap_or_default(),
        ip: p
            .status
            .as_ref()
            .and_then(|s| s.pod_ip.clone())
            .unwrap_or_default(),
        containers,
    }
}

fn node_to_row(n: &Node) -> NodeRow {
    let roles = n
        .metadata
        .labels
        .as_ref()
        .map(|labels| {
            labels
                .iter()
                .filter(|(k, _)| k.starts_with("node-role.kubernetes.io/"))
                .map(|(k, _)| k.trim_start_matches("node-role.kubernetes.io/").to_string())
                .collect::<Vec<_>>()
                .join(",")
        })
        .filter(|s: &String| !s.is_empty())
        .unwrap_or_else(|| "<none>".to_string());

    let internal_ip = n
        .status
        .as_ref()
        .and_then(|s| {
            s.addresses
                .as_ref()
                .and_then(|addrs| {
                    addrs
                        .iter()
                        .find(|a| a.type_ == "InternalIP")
                        .map(|a| a.address.clone())
                })
        })
        .unwrap_or_default();

    let status = n
        .status
        .as_ref()
        .and_then(|s| {
            s.conditions
                .as_ref()
                .and_then(|c| {
                    c.iter()
                        .find(|c| c.type_ == "Ready")
                        .map(|c| if c.status == "True" { "Ready" } else { "NotReady" }.to_string())
                })
        })
        .unwrap_or_else(|| "Unknown".to_string());

    let version = n
        .status
        .as_ref()
        .and_then(|s| s.node_info.clone())
        .map(|i| i.kubelet_version)
        .unwrap_or_default();

    NodeRow {
        name: n.name_any(),
        status,
        roles,
        age: age_of(n.meta().creation_timestamp.as_ref()),
        version,
        internal_ip,
    }
}

// ---------------------------------------------------------------------------
// Logs (:logs in k9s)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_pod_logs(
    name: String,
    namespace: String,
    container: Option<String>,
    tail_lines: Option<i64>,
    previous: Option<bool>,
    timestamps: Option<bool>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let client = make_client(&state).await?;
    let api: Api<Pod> = Api::namespaced(client, &namespace);
    let lp = kube_client::api::LogParams {
        follow: false,
        container,
        tail_lines,
        previous: previous.unwrap_or(false),
        timestamps: timestamps.unwrap_or(false),
        ..kube_client::api::LogParams::default()
    };
    api.logs(&name, &lp)
        .await
        .map_err(|e| format!("get_pod_logs: {}", e))
}

// ---------------------------------------------------------------------------
// Exec (:exec in k9s)
//
// kube-rs has no high-level exec API (it would need SPDY/WebSocket + TTY
// framing on top of the apiserver exec subresource). For now we shell out
// to the `kubectl` binary the user almost certainly has on PATH. This is
// what k9s and most other lightweight clients do as well.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u128,
}

#[tauri::command]
pub async fn exec_pod(
    name: String,
    namespace: String,
    container: Option<String>,
    command: Vec<String>,
    state: State<'_, AppState>,
) -> Result<ExecResult, String> {
    if command.is_empty() {
        return Err("exec_pod: command must not be empty".to_string());
    }
    let client = make_client(&state).await?;

    // Resolve the active context so kubectl talks to the same cluster.
    let current_ctx = {
        let kc = kube::load_kubeconfig().map_err(|e| e.to_string())?;
        kc.current_context.unwrap_or_default()
    };

    // Sanity check: the pod (and container) must exist. We catch the
    // not-found / not-running case here so the kubectl error we surface
    // to the UI is more meaningful.
    let api: Api<Pod> = Api::namespaced(client, &namespace);
    let pod = api.get(&name).await.map_err(|e| format!("pod not found: {}", e))?;
    let _ = pod; // we just use this to confirm reachability; kubectl handles the rest

    let mut args: Vec<String> = vec![
        "exec".into(),
        name.clone(),
        "-n".into(),
        namespace.clone(),
    ];
    if !current_ctx.is_empty() {
        args.push("--context".into());
        args.push(current_ctx);
    }
    if let Some(c) = container {
        args.push("-c".into());
        args.push(c);
    }
    args.push("--".into());
    args.extend(command);

    let start = std::time::Instant::now();
    let output = tokio::process::Command::new("kubectl")
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| {
            format!(
                "failed to spawn kubectl (is it on PATH?): {}",
                e
            )
        })?;
    let duration_ms = start.elapsed().as_millis();

    Ok(ExecResult {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        exit_code: output.status.code().unwrap_or(-1),
        duration_ms,
    })
}

// ---------------------------------------------------------------------------
// Port-forward (:pf in k9s)
//
// We bind a local TCP listener; for every accepted connection we run a
// fresh kube portforward subresource handshake and shuttle bytes
// bidirectionally. Each Portforwarder holds the upstream WebSocket
// connection, so we keep it alive for the lifetime of the local client.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct PortForwardInfo {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub namespace: String,
    pub local_port: u16,
    pub remote_port: u16,
    pub started_at: String,
}

impl From<&PortForward> for PortForwardInfo {
    fn from(p: &PortForward) -> Self {
        Self {
            id: p.id.clone(),
            kind: p.kind.clone(),
            name: p.name.clone(),
            namespace: p.namespace.clone(),
            local_port: p.local_port,
            remote_port: p.remote_port,
            started_at: format_chrono_dt(p.started_at),
        }
    }
}

#[tauri::command]
pub async fn start_port_forward(
    kind: String,
    name: String,
    namespace: String,
    local_port: u16,
    remote_port: u16,
    state: State<'_, AppState>,
) -> Result<PortForwardInfo, String> {
    // Refuse if the local port is already in use by *us* (avoids two
    // forwards stomping on each other; the OS itself will reject the bind
    // if it's used by another process).
    {
        let map = state.port_forwards.lock().map_err(|e| e.to_string())?;
        if map
            .values()
            .any(|p| p.local_port == local_port && p.remote_port == remote_port)
        {
            return Err(format!(
                "port-forward already active: 127.0.0.1:{} -> {}:{}/{}",
                local_port, kind, namespace, remote_port
            ));
        }
    }

    // Verify the target resource exists and (for Service) resolve it to
    // a concrete Pod. The forward loop always runs against a Pod, so the
    // Service case is just a pre-flight resolution.
    let client = make_client(&state).await?;
    let resolved_pod_name = match kind.as_str() {
        "Pod" | "pods" => {
            let api: Api<Pod> = Api::namespaced(client.clone(), &namespace);
            api.get(&name).await.map_err(|e| format!("pod not found: {}", e))?;
            name.clone()
        }
        "Service" | "services" => {
            resolve_service_to_pod(&client, &name, &namespace, remote_port)
                .await?
        }
        other => return Err(format!("port-forward not supported for kind: {}", other)),
    };

    let id = format!(
        "pf-{}-{}-{}-{}",
        kind,
        namespace,
        name,
        // Cheap unique suffix; not security-sensitive.
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();

    tokio::spawn(run_port_forward(
        client,
        resolved_pod_name,
        namespace.clone(),
        local_port,
        remote_port,
        cancel_rx,
    ));

    let pf = PortForward {
        id: id.clone(),
        kind,
        name,
        namespace,
        local_port,
        remote_port,
        started_at: chrono::Utc::now(),
        cancel: Some(cancel_tx),
    };
    let info = PortForwardInfo::from(&pf);
    state
        .port_forwards
        .lock()
        .map_err(|e| e.to_string())?
        .insert(pf.id.clone(), pf);
    Ok(info)
}

#[tauri::command]
pub async fn stop_port_forward(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut map = state.port_forwards.lock().map_err(|e| e.to_string())?;
    let pf = map
        .remove(&id)
        .ok_or_else(|| format!("no such port-forward: {}", id))?;
    if let Some(tx) = pf.cancel {
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn list_port_forwards(
    state: State<'_, AppState>,
) -> Result<Vec<PortForwardInfo>, String> {
    let map = state.port_forwards.lock().map_err(|e| e.to_string())?;
    Ok(map.values().map(PortForwardInfo::from).collect())
}

async fn run_port_forward(
    client: kube_client::Client,
    pod_name: String,
    namespace: String,
    local_port: u16,
    remote_port: u16,
    cancel_rx: tokio::sync::oneshot::Receiver<()>,
) {
    use tokio::io::AsyncWriteExt;
    let mut cancel_rx = cancel_rx;

    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", local_port)).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("port-forward: bind 127.0.0.1:{}: {}", local_port, e);
            return;
        }
    };
    eprintln!(
        "port-forward: 127.0.0.1:{} -> pod/{}/{}:{} (id pending)",
        local_port, namespace, pod_name, remote_port
    );

    loop {
        tokio::select! {
            biased;
            _ = &mut cancel_rx => {
                eprintln!("port-forward: cancelled; dropping listener");
                drop(listener);
                return;
            }
            accepted = listener.accept() => {
                let (mut local, peer) = match accepted {
                    Ok(p) => p,
                    Err(e) => {
                        eprintln!("port-forward: accept: {}", e);
                        continue;
                    }
                };
                eprintln!("port-forward: new local client {}", peer);
                let client = client.clone();
                let pod_name = pod_name.clone();
                let namespace = namespace.clone();
                tokio::spawn(async move {
                    if let Err(e) = serve_one_connection(
                        client, &pod_name, &namespace, remote_port, &mut local,
                    ).await {
                        eprintln!("port-forward: serve: {}", e);
                    }
                    let _ = local.shutdown().await;
                });
            }
        }
    }
}

async fn serve_one_connection(
    client: kube_client::Client,
    pod_name: &str,
    namespace: &str,
    remote_port: u16,
    local: &mut tokio::net::TcpStream,
) -> Result<(), String> {
    let api: Api<Pod> = Api::namespaced(client, namespace);

    let mut portforwarder = api
        .portforward(pod_name, &[remote_port])
        .await
        .map_err(|e| format!("portforward: {}", e))?;
    let mut remote = portforwarder
        .take_stream(remote_port)
        .ok_or_else(|| format!("port {} not in portforwarder", remote_port))?;

    let _keep_alive = portforwarder;

    tokio::io::copy_bidirectional(local, &mut remote)
        .await
        .map_err(|e| format!("forward: {}", e))?;
    Ok(())
}

/// Resolve a Service to a concrete Pod for port-forwarding.
///
/// Steps:
///   1. Load the Service; reject if it has no selector (headless or external).
///   2. List Pods whose labels match the selector.
///   3. Pick a Ready pod (or just the first one if none are ready).
///   4. Translate the user-supplied service port to the matching target port
///      on the chosen pod.
async fn resolve_service_to_pod(
    client: &Client,
    service_name: &str,
    namespace: &str,
    service_port: u16,
) -> Result<String, String> {
    let svc_api: Api<Service> = Api::namespaced(client.clone(), namespace);
    let svc = svc_api
        .get(service_name)
        .await
        .map_err(|e| format!("service not found: {}", e))?;

    let selector = svc
        .spec
        .as_ref()
        .and_then(|sp| sp.selector.clone())
        .ok_or_else(|| "service has no selector (headless?)".to_string())?;
    if selector.is_empty() {
        return Err("service has an empty selector".into());
    }

    // Build a label-selector string. ListParams::labels_from takes a
    // &BTreeMap<String, String> via a LabelSelector — we hand-roll the
    // equality-based form here (the common case for Services).
    let label_pairs: Vec<String> = selector
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect();
    let label_query = label_pairs.join(",");

    let pod_api: Api<Pod> = Api::namespaced(client.clone(), namespace);
    let mut lp = ListParams::default();
    lp.label_selector = Some(label_query.clone());
    let plist = pod_api
        .list(&lp)
        .await
        .map_err(|e| format!("list pods by selector: {}", e))?;
    if plist.items.is_empty() {
        return Err(format!(
            "no pods match service selector {} (service/{})",
            label_query, service_name
        ));
    }

    // Prefer Ready pods so we forward to something that can actually
    // accept traffic.
    let ready_pod = plist.items.iter().find(|p| {
        p.status
            .as_ref()
            .and_then(|st| st.conditions.as_ref())
            .and_then(|c| c.iter().find(|c| c.type_ == "Ready"))
            .map(|c| c.status == "True")
            .unwrap_or(false)
    });
    let chosen = ready_pod.unwrap_or(&plist.items[0]);

    // Translate the user-supplied service port (svc.spec.ports[].port) to
    // the actual target port the pod exposes.
    let svc_port_match = svc
        .spec
        .as_ref()
        .and_then(|sp| sp.ports.as_ref())
        .and_then(|ports| ports.iter().find(|p| p.port == service_port as i32))
        .ok_or_else(|| {
            format!(
                "service {} has no port {}; try one of: {}",
                service_name,
                service_port,
                svc.spec
                    .as_ref()
                    .and_then(|sp| sp.ports.as_ref())
                    .map(|p| p.iter().map(|x| x.port.to_string()).collect::<Vec<_>>().join(","))
                    .unwrap_or_else(|| "<no ports>".into())
            )
        })?;

    // target_port may be int or named. We only support int here; named
    // ports would require an extra Get on the pod to map them.
    let target_port: u16 = match svc_port_match.target_port.as_ref() {
        Some(IntOrString::Int(i)) if *i > 0 && *i <= u16::MAX as i32 => *i as u16,
        Some(IntOrString::String(n)) => {
            return Err(format!(
                "service uses named target port {:?}; numeric only is supported",
                n
            ))
        }
        _ => service_port, // fall back to the service port (some services use the same number)
    };

    eprintln!(
        "port-forward: service {}/{} port {} -> pod {} target_port {}",
        namespace, service_name, service_port, chosen.name_any(), target_port
    );

    Ok(chosen.name_any().to_string())
}

// ---------------------------------------------------------------------------
// Scale (:scale in k9s) — Deployment / StatefulSet / ReplicaSet
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn scale_resource(
    kind: String,
    name: String,
    namespace: String,
    replicas: i32,
    state: State<'_, AppState>,
) -> Result<i32, String> {
    use kube_client::api::PostParams;
    let client = make_client(&state).await?;
    let ns = namespace.as_str();

    // Load → mutate replicas → PUT the Scale subresource back.
    let set_and_replace = |mut scale: k8s_openapi::api::autoscaling::v1::Scale, target: i32| {
        if scale.spec.is_none() {
            scale.spec = Some(k8s_openapi::api::autoscaling::v1::ScaleSpec::default());
        }
        if let Some(spec) = scale.spec.as_mut() {
            spec.replicas = Some(target);
        }
        serde_json::to_vec(&scale).map_err(|e| format!("serialize Scale: {}", e))
    };

    match kind.as_str() {
        "Deployment" | "deployments" => {
            let api: Api<Deployment> = Api::namespaced(client, ns);
            let scale = api
                .get_scale(&name)
                .await
                .map_err(|e| format!("get_scale: {}", e))?;
            let bytes = set_and_replace(scale, replicas)?;
            let updated = api
                .replace_scale(&name, &PostParams::default(), bytes)
                .await
                .map_err(|e| format!("replace_scale: {}", e))?;
            Ok(updated.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0))
        }
        "StatefulSet" | "statefulsets" => {
            let api: Api<StatefulSet> = Api::namespaced(client, ns);
            let scale = api
                .get_scale(&name)
                .await
                .map_err(|e| format!("get_scale: {}", e))?;
            let bytes = set_and_replace(scale, replicas)?;
            let updated = api
                .replace_scale(&name, &PostParams::default(), bytes)
                .await
                .map_err(|e| format!("replace_scale: {}", e))?;
            Ok(updated.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0))
        }
        "ReplicaSet" | "replicasets" => {
            let api: Api<ReplicaSet> = Api::namespaced(client, ns);
            let scale = api
                .get_scale(&name)
                .await
                .map_err(|e| format!("get_scale: {}", e))?;
            let bytes = set_and_replace(scale, replicas)?;
            let updated = api
                .replace_scale(&name, &PostParams::default(), bytes)
                .await
                .map_err(|e| format!("replace_scale: {}", e))?;
            Ok(updated.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0))
        }
        other => Err(format!("scale not supported for kind: {}", other)),
    }
}

// ---------------------------------------------------------------------------
// Apply YAML (:edit in k9s)
//
// Reads the current object's YAML, lets the user edit it, then sends a
// server-side apply (application/apply-patch+yaml) back. SSApply is
// idempotent and conflict-safe (last-applied field-tracked).
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn apply_yaml(
    kind: String,
    name: String,
    namespace: String,
    yaml: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    use kube_client::api::{Patch, PatchParams};

    // Validate the user's YAML: must be non-empty, parseable, and the
    // kind/name/namespace must match the row that was selected.
    if yaml.trim().is_empty() {
        return Err("apply_yaml: empty document".into());
    }
    let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml)
        .map_err(|e| format!("apply_yaml: invalid YAML: {}", e))?;

    let mk = parsed.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    let mn = parsed.get("metadata")
        .and_then(|m| m.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let mns = parsed
        .get("metadata")
        .and_then(|m| m.get("namespace"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !mk.eq_ignore_ascii_case(&kind) {
        return Err(format!(
            "apply_yaml: kind mismatch (expected {}, got {})",
            kind, mk
        ));
    }
    if mn != name {
        return Err(format!(
            "apply_yaml: name mismatch (expected {}, got {})",
            name, mn
        ));
    }
    if !namespace.is_empty() && mns != namespace {
        return Err(format!(
            "apply_yaml: namespace mismatch (expected {}, got {})",
            namespace, mns
        ));
    }

    let client = make_client(&state).await?;

    // Server-side apply with force: the apiserver will take over fields
    // owned by other managers if force is set (else it rejects).
    // Patch::Apply<T> serializes via serde_json::to_vec, so the body must
    // be something Serialize into JSON, not a raw string (which would
    // be JSON-encoded as `"...quotes..."` and rejected by the apiserver).
    // Also strip metadata.managedFields — the apiserver rejects any
    // submitted YAML that includes it (server-managed metadata).
    if let Some(metadata) = parsed
        .get_mut("metadata")
        .and_then(|m| m.as_mapping_mut())
    {
        metadata.remove(serde_yaml::Value::String("managedFields".into()));
    }
    let pp = PatchParams::apply("k7s").force();
    let patch = Patch::Apply(parsed);

    let dispatch = async {
        let r: Result<(), kube_client::Error> = match kind.as_str() {
            "Pod" | "pods" => Api::<Pod>::namespaced(client.clone(), &namespace)
                .patch(&name, &pp, &patch)
                .await
                .map(|_| ()),
            "Deployment" | "deployments" => Api::<Deployment>::namespaced(client.clone(), &namespace)
                .patch(&name, &pp, &patch)
                .await
                .map(|_| ()),
            "StatefulSet" | "statefulsets" => Api::<StatefulSet>::namespaced(client.clone(), &namespace)
                .patch(&name, &pp, &patch)
                .await
                .map(|_| ()),
            "DaemonSet" | "daemonsets" => Api::<DaemonSet>::namespaced(client.clone(), &namespace)
                .patch(&name, &pp, &patch)
                .await
                .map(|_| ()),
            "ReplicaSet" | "replicasets" => Api::<ReplicaSet>::namespaced(client.clone(), &namespace)
                .patch(&name, &pp, &patch)
                .await
                .map(|_| ()),
            "Job" | "jobs" => Api::<Job>::namespaced(client.clone(), &namespace)
                .patch(&name, &pp, &patch)
                .await
                .map(|_| ()),
            "CronJob" | "cronjobs" => Api::<CronJob>::namespaced(client.clone(), &namespace)
                .patch(&name, &pp, &patch)
                .await
                .map(|_| ()),
            "Service" | "services" => Api::<Service>::namespaced(client.clone(), &namespace)
                .patch(&name, &pp, &patch)
                .await
                .map(|_| ()),
            "ConfigMap" | "configmaps" => Api::<ConfigMap>::namespaced(client.clone(), &namespace)
                .patch(&name, &pp, &patch)
                .await
                .map(|_| ()),
            "Secret" | "secrets" => Api::<Secret>::namespaced(client.clone(), &namespace)
                .patch(&name, &pp, &patch)
                .await
                .map(|_| ()),
            "PersistentVolumeClaim" | "persistentvolumeclaims" | "pvc" => {
                Api::<PersistentVolumeClaim>::namespaced(client.clone(), &namespace)
                    .patch(&name, &pp, &patch)
                    .await
                    .map(|_| ())
            }
            "HorizontalPodAutoscaler" | "horizontalpodautoscalers" | "hpa" => {
                Api::<HorizontalPodAutoscaler>::namespaced(client.clone(), &namespace)
                    .patch(&name, &pp, &patch)
                    .await
                    .map(|_| ())
            }
            "Namespace" | "namespaces" => Api::<Namespace>::all(client.clone())
                .patch(&name, &pp, &patch)
                .await
                .map(|_| ()),
            other => Err(kube_client::Error::Api(kube_client::error::ErrorResponse {
                status: "Failure".into(),
                message: format!("apply not supported for kind: {}", other),
                reason: "BadRequest".into(),
                code: 400,
            })),
        };
        r
    }
    .await
    .map_err(|e| format!("apply: {}", e))?;

    // Re-fetch the canonical YAML so the editor can show what landed.
    let yaml_after = get_yaml_for_kind(&client, &kind, Some(&namespace), &name).await?;
    let _ = dispatch; // keep the patch result alive for debugging if needed
    Ok(yaml_after)
}

// ---------------------------------------------------------------------------
// Describe (:describe in k9s) — friendlier than raw YAML.
//
// Pulls the current object, joins related events, and emits a fixed-width
// text block. Cheaper to read than YAML and pulls out the things k9s
// shows in its describe view (status, conditions, containers, events).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct DescribeResult {
    pub kind: String,
    pub name: String,
    pub namespace: String,
    pub text: String,
}

#[tauri::command]
pub async fn describe(
    kind: String,
    name: String,
    namespace: String,
    state: State<'_, AppState>,
) -> Result<DescribeResult, String> {
    let client = make_client(&state).await?;
    let ns = namespace.as_str();
    let text = match kind.as_str() {
        "Pod" | "pods" => describe_pod(&client, &name, ns).await?,
        "Deployment" | "deployments" => describe_deployment(&client, &name, ns).await?,
        "StatefulSet" | "statefulsets" => describe_statefulset(&client, &name, ns).await?,
        "DaemonSet" | "daemonsets" => describe_daemonset(&client, &name, ns).await?,
        "ReplicaSet" | "replicasets" => describe_replicaset(&client, &name, ns).await?,
        "Job" | "jobs" => describe_job(&client, &name, ns).await?,
        "CronJob" | "cronjobs" => describe_cronjob(&client, &name, ns).await?,
        "Service" | "services" => describe_service(&client, &name, ns).await?,
        "ConfigMap" | "configmaps" => describe_configmap(&client, &name, ns).await?,
        "Secret" | "secrets" => describe_secret(&client, &name, ns).await?,
        "PersistentVolumeClaim" | "persistentvolumeclaims" | "pvc" => {
            describe_pvc(&client, &name, ns).await?
        }
        "HorizontalPodAutoscaler" | "horizontalpodautoscalers" | "hpa" => {
            describe_hpa(&client, &name, ns).await?
        }
        "Node" | "nodes" => describe_node(&client, &name).await?,
        "Namespace" | "namespaces" => describe_namespace(&client, &name).await?,
        other => return Err(format!("describe not supported for kind: {}", other)),
    };
    Ok(DescribeResult {
        kind,
        name,
        namespace: namespace.clone(),
        text,
    })
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

fn format_chrono_dt(dt: DateTime<Utc>) -> String {
    let dur = Utc::now().signed_duration_since(dt);
    if dur.num_seconds() < 0 {
        return "0s".to_string();
    }
    if dur.num_days() > 0 {
        format!("{}d", dur.num_days())
    } else if dur.num_hours() > 0 {
        format!("{}h", dur.num_hours())
    } else if dur.num_minutes() > 0 {
        format!("{}m", dur.num_minutes())
    } else {
        format!("{}s", dur.num_seconds())
    }
}

/// Render a creation timestamp as a compact age string.
fn age_of(ts: Option<&k8s_openapi::apimachinery::pkg::apis::meta::v1::Time>) -> String {
    let Some(ts) = ts else {
        return "unknown".to_string();
    };
    let created: DateTime<Utc> = ts.0;
    format_chrono_dt(created)
}

// ---------------------------------------------------------------------------
// Describe helpers
//
// Each describe_<kind> function takes &Client and emits a single multi-line
// string with the layout k9s uses:
//   Name:        ...
//   Namespace:   ...
//   <kind-specific section>
//   Status / Conditions / Containers / Events
// ---------------------------------------------------------------------------

async fn describe_pod(client: &Client, name: &str, namespace: &str) -> Result<String, String> {
    let api: Api<Pod> = Api::namespaced(client.clone(), namespace);
    let p = api.get(name).await.map_err(|e| format!("get: {}", e))?;
    let mut s = String::new();
    s.push_str(&format!("Name:         {}\n", p.name_any()));
    s.push_str(&format!("Namespace:    {}\n", namespace));
    s.push_str(&format!(
        "Node:         {}\n",
        p.spec.as_ref().and_then(|sp| sp.node_name.clone()).unwrap_or_default()
    ));
    s.push_str(&format!(
        "Start Time:   {} (≈{} ago)\n",
        p.meta()
            .creation_timestamp
            .as_ref()
            .map(|t| t.0.to_rfc3339())
            .unwrap_or_else(|| "—".into()),
        age_of(p.meta().creation_timestamp.as_ref())
    ));
    s.push_str(&format!(
        "Status:       {}\n",
        p.status
            .as_ref()
            .and_then(|st| st.phase.clone())
            .unwrap_or_else(|| "—".into())
    ));
    s.push_str(&format!(
        "Pod IP:       {}\n",
        p.status
            .as_ref()
            .and_then(|st| st.pod_ip.clone())
            .unwrap_or_default()
    ));
    s.push_str(&format!(
        "Labels:       {}\n",
        labels_to_string(p.meta().labels.as_ref())
    ));
    s.push_str("\nContainers:\n");
    if let Some(spec) = p.spec.as_ref() {
        for c in &spec.containers {
            let (ready, restarts) = p
                .status
                .as_ref()
                .and_then(|st| st.container_statuses.as_ref())
                .and_then(|cs| {
                    cs.iter()
                        .find(|cs| cs.name == c.name)
                        .map(|cs| (cs.ready, cs.restart_count))
                })
                .unwrap_or((false, 0));
            s.push_str(&format!("  {}\n", c.name));
            s.push_str(&format!(
                "    Image:     {}\n",
                c.image.clone().unwrap_or_else(|| "<none>".into())
            ));
            let ports: Vec<String> = c
                .ports
                .as_ref()
                .map(|pp| {
                    pp.iter()
                        .map(|p| {
                            let proto = p.protocol.clone().unwrap_or_else(|| "TCP".into());
                            let host = p
                                .host_port
                                .map(|h| format!(" host={}", h))
                                .unwrap_or_default();
                            format!("{}/{}{}", p.container_port, proto, host)
                        })
                        .collect()
                })
                .unwrap_or_default();
            if !ports.is_empty() {
                s.push_str(&format!("    Ports:     {}\n", ports.join(", ")));
            }
            s.push_str(&format!("    Ready:     {}\n", if ready { "true" } else { "false" }));
            s.push_str(&format!("    Restarts:  {}\n", restarts));
        }
    }
    s.push_str("\nConditions:\n");
    if let Some(conds) = p
        .status
        .as_ref()
        .and_then(|st| st.conditions.as_ref())
    {
        for c in conds {
            let icon = if c.status == "True" { "✓" } else { "✗" };
            s.push_str(&format!(
                "  {} {:<14} {}\n",
                icon,
                c.type_,
                c.status
            ));
        }
    } else {
        s.push_str("  (none)\n");
    }
    s.push_str("\nEvents (latest first, max 10):\n");
    s.push_str(&format_events(client, "Pod", name, namespace, 10).await);
    Ok(s)
}

async fn describe_deployment(
    client: &Client,
    name: &str,
    namespace: &str,
) -> Result<String, String> {
    let api: Api<Deployment> = Api::namespaced(client.clone(), namespace);
    let d = api.get(name).await.map_err(|e| format!("get: {}", e))?;
    let mut s = String::new();
    s.push_str(&format!("Name:         {}\n", d.name_any()));
    s.push_str(&format!("Namespace:    {}\n", namespace));
    s.push_str(&format!(
        "Created:      {} (≈{} ago)\n",
        d.meta()
            .creation_timestamp
            .as_ref()
            .map(|t| t.0.to_rfc3339())
            .unwrap_or_else(|| "—".into()),
        age_of(d.meta().creation_timestamp.as_ref())
    ));
    s.push_str(&format!(
        "Labels:       {}\n",
        labels_to_string(d.meta().labels.as_ref())
    ));
    let desired = d.spec.as_ref().and_then(|sp| sp.replicas).unwrap_or(0);
    let ready = d
        .status
        .as_ref()
        .and_then(|st| st.ready_replicas)
        .unwrap_or(0);
    let updated = d
        .status
        .as_ref()
        .and_then(|st| st.updated_replicas)
        .unwrap_or(0);
    let available = d
        .status
        .as_ref()
        .and_then(|st| st.available_replicas)
        .unwrap_or(0);
    let unavailable = d
        .status
        .as_ref()
        .and_then(|st| st.unavailable_replicas)
        .unwrap_or(0);
    s.push_str("\nReplicas:\n");
    s.push_str(&format!("  desired   {}\n", desired));
    s.push_str(&format!("  updated   {}\n", updated));
    s.push_str(&format!("  ready     {}\n", ready));
    s.push_str(&format!("  available {}\n", available));
    s.push_str(&format!("  unavailable {}\n", unavailable));
    s.push_str("\nStrategy:\n");
    s.push_str(&format!(
        "  type: {}\n",
        d.spec
            .as_ref()
            .and_then(|sp| sp.strategy.as_ref())
            .map(|st| st.type_.clone().unwrap_or_else(|| "RollingUpdate".into()))
            .unwrap_or_else(|| "RollingUpdate".into())
    ));
    s.push_str("\nSelector:     ");
    s.push_str(&label_selector_to_string(
        d.spec.as_ref().map(|sp| &sp.selector).unwrap(),
    ));
    s.push_str("\nEvents (latest first, max 10):\n");
    s.push_str(&format_events(client, "Deployment", name, namespace, 10).await);
    Ok(s)
}

async fn describe_statefulset(
    client: &Client,
    name: &str,
    namespace: &str,
) -> Result<String, String> {
    let api: Api<StatefulSet> = Api::namespaced(client.clone(), namespace);
    let s_obj = api.get(name).await.map_err(|e| format!("get: {}", e))?;
    let mut s = String::new();
    s.push_str(&format!("Name:         {}\n", s_obj.name_any()));
    s.push_str(&format!("Namespace:    {}\n", namespace));
    s.push_str(&format!(
        "Created:      {} (≈{} ago)\n",
        s_obj.meta().creation_timestamp.as_ref().map(|t| t.0.to_rfc3339()).unwrap_or_else(|| "—".into()),
        age_of(s_obj.meta().creation_timestamp.as_ref())
    ));
    let desired = s_obj.spec.as_ref().and_then(|sp| sp.replicas).unwrap_or(0);
    let ready = s_obj.status.as_ref().and_then(|st| st.ready_replicas).unwrap_or(0);
    s.push_str(&format!("Replicas:     {} desired / {} ready\n", desired, ready));
    s.push_str(&format!("Service Name: {}\n",
        s_obj.spec.as_ref().and_then(|sp| sp.service_name.clone()).unwrap_or_default()));
    s.push_str("\nSelector:     ");
    s.push_str(&label_selector_to_string(
        s_obj.spec.as_ref().map(|sp| &sp.selector).unwrap(),
    ));
    s.push_str("\nEvents (latest first, max 10):\n");
    s.push_str(&format_events(client, "StatefulSet", name, namespace, 10).await);
    Ok(s)
}

async fn describe_daemonset(
    client: &Client,
    name: &str,
    namespace: &str,
) -> Result<String, String> {
    let api: Api<DaemonSet> = Api::namespaced(client.clone(), namespace);
    let d = api.get(name).await.map_err(|e| format!("get: {}", e))?;
    let mut s = String::new();
    s.push_str(&format!("Name:         {}\n", d.name_any()));
    s.push_str(&format!("Namespace:    {}\n", namespace));
    s.push_str(&format!(
        "Created:      {} (≈{} ago)\n",
        d.meta().creation_timestamp.as_ref().map(|t| t.0.to_rfc3339()).unwrap_or_else(|| "—".into()),
        age_of(d.meta().creation_timestamp.as_ref())
    ));
    let desired = d.status.as_ref().map(|st| st.desired_number_scheduled).unwrap_or(0);
    let ready = d.status.as_ref().map(|st| st.number_ready).unwrap_or(0);
    let sched = d.status.as_ref().map(|st| st.current_number_scheduled).unwrap_or(0);
    s.push_str(&format!(
        "Pods:         {} desired / {} ready / {} scheduled\n",
        desired, ready, sched
    ));
    s.push_str("\nSelector:     ");
    s.push_str(&label_selector_to_string(
        d.spec.as_ref().map(|sp| &sp.selector).unwrap(),
    ));
    s.push_str("\nEvents (latest first, max 10):\n");
    s.push_str(&format_events(client, "DaemonSet", name, namespace, 10).await);
    Ok(s)
}

async fn describe_replicaset(
    client: &Client,
    name: &str,
    namespace: &str,
) -> Result<String, String> {
    let api: Api<ReplicaSet> = Api::namespaced(client.clone(), namespace);
    let r = api.get(name).await.map_err(|e| format!("get: {}", e))?;
    let mut s = String::new();
    s.push_str(&format!("Name:         {}\n", r.name_any()));
    s.push_str(&format!("Namespace:    {}\n", namespace));
    s.push_str(&format!(
        "Created:      {} (≈{} ago)\n",
        r.meta().creation_timestamp.as_ref().map(|t| t.0.to_rfc3339()).unwrap_or_else(|| "—".into()),
        age_of(r.meta().creation_timestamp.as_ref())
    ));
    let desired = r.spec.as_ref().and_then(|sp| sp.replicas).unwrap_or(0);
    let ready = r.status.as_ref().and_then(|st| st.ready_replicas).unwrap_or(0);
    s.push_str(&format!("Replicas:     {} desired / {} ready\n", desired, ready));
    s.push_str(&format!("Owner:        {}\n",
        r.meta().owner_references.as_ref()
            .and_then(|o| o.first())
            .map(|o| format!("{}/{}", o.kind, o.name))
            .unwrap_or_else(|| "<none>".into())));
    s.push_str("\nSelector:     ");
    s.push_str(&label_selector_to_string(
        r.spec.as_ref().map(|sp| &sp.selector).unwrap(),
    ));
    s.push_str("\nEvents (latest first, max 10):\n");
    s.push_str(&format_events(client, "ReplicaSet", name, namespace, 10).await);
    Ok(s)
}

async fn describe_job(client: &Client, name: &str, namespace: &str) -> Result<String, String> {
    let api: Api<Job> = Api::namespaced(client.clone(), namespace);
    let j = api.get(name).await.map_err(|e| format!("get: {}", e))?;
    let mut s = String::new();
    s.push_str(&format!("Name:         {}\n", j.name_any()));
    s.push_str(&format!("Namespace:    {}\n", namespace));
    s.push_str(&format!(
        "Created:      {} (≈{} ago)\n",
        j.meta().creation_timestamp.as_ref().map(|t| t.0.to_rfc3339()).unwrap_or_else(|| "—".into()),
        age_of(j.meta().creation_timestamp.as_ref())
    ));
    let completions = j.spec.as_ref().and_then(|sp| sp.completions).unwrap_or(0);
    let parallelism = j.spec.as_ref().and_then(|sp| sp.parallelism).unwrap_or(1);
    let active = j.status.as_ref().and_then(|st| st.active).unwrap_or(0);
    let succeeded = j.status.as_ref().and_then(|st| st.succeeded).unwrap_or(0);
    let failed = j.status.as_ref().and_then(|st| st.failed).unwrap_or(0);
    s.push_str(&format!(
        "Completions:  {}/{} (parallelism {})\n",
        succeeded, completions, parallelism
    ));
    s.push_str(&format!("Status:       active={} succeeded={} failed={}\n", active, succeeded, failed));
    if let Some(st) = j.status.as_ref() {
        if let Some(start) = st.start_time.as_ref() {
            let dur = st
                .completion_time
                .as_ref()
                .map(|end| (end.0 - start.0).num_seconds())
                .map(|s| format!("{}s", s))
                .unwrap_or_else(|| "—".into());
            s.push_str(&format!("Duration:     {}\n", dur));
        }
    }
    s.push_str("\nEvents (latest first, max 10):\n");
    s.push_str(&format_events(client, "Job", name, namespace, 10).await);
    Ok(s)
}

async fn describe_cronjob(
    client: &Client,
    name: &str,
    namespace: &str,
) -> Result<String, String> {
    let api: Api<CronJob> = Api::namespaced(client.clone(), namespace);
    let c = api.get(name).await.map_err(|e| format!("get: {}", e))?;
    let mut s = String::new();
    s.push_str(&format!("Name:         {}\n", c.name_any()));
    s.push_str(&format!("Namespace:    {}\n", namespace));
    s.push_str(&format!(
        "Created:      {} (≈{} ago)\n",
        c.meta().creation_timestamp.as_ref().map(|t| t.0.to_rfc3339()).unwrap_or_else(|| "—".into()),
        age_of(c.meta().creation_timestamp.as_ref())
    ));
    s.push_str(&format!(
        "Schedule:     {}\n",
        c.spec.as_ref().map(|sp| sp.schedule.clone()).unwrap_or_default()
    ));
    s.push_str(&format!(
        "Suspend:      {}\n",
        c.spec.as_ref().and_then(|sp| sp.suspend).unwrap_or(false)
    ));
    s.push_str(&format!(
        "Last Schedule: {}\n",
        c.status
            .as_ref()
            .and_then(|st| st.last_schedule_time.as_ref().map(|t| t.0.to_rfc3339()))
            .unwrap_or_else(|| "<none>".into())
    ));
    s.push_str("\nEvents (latest first, max 10):\n");
    s.push_str(&format_events(client, "CronJob", name, namespace, 10).await);
    Ok(s)
}

async fn describe_service(
    client: &Client,
    name: &str,
    namespace: &str,
) -> Result<String, String> {
    let api: Api<Service> = Api::namespaced(client.clone(), namespace);
    let sv = api.get(name).await.map_err(|e| format!("get: {}", e))?;
    let mut s = String::new();
    s.push_str(&format!("Name:         {}\n", sv.name_any()));
    s.push_str(&format!("Namespace:    {}\n", namespace));
    s.push_str(&format!(
        "Created:      {} (≈{} ago)\n",
        sv.meta().creation_timestamp.as_ref().map(|t| t.0.to_rfc3339()).unwrap_or_else(|| "—".into()),
        age_of(sv.meta().creation_timestamp.as_ref())
    ));
    s.push_str(&format!("Type:         {}\n",
        sv.spec.as_ref().and_then(|sp| sp.type_.clone()).unwrap_or_else(|| "ClusterIP".into())));
    s.push_str(&format!("Cluster IP:   {}\n",
        sv.spec.as_ref().and_then(|sp| sp.cluster_ip.clone()).unwrap_or_default()));
    s.push_str(&format!("External IPs: {}\n",
        sv.spec.as_ref().and_then(|sp| sp.external_ips.as_ref())
            .map(|ips| ips.join(",")).unwrap_or_default()));
    s.push_str("\nPorts:\n");
    if let Some(ports) = sv.spec.as_ref().and_then(|sp| sp.ports.as_ref()) {
        for p in ports {
            let proto = p.protocol.clone().unwrap_or_else(|| "TCP".into());
            let target = p.target_port.as_ref()
                .map(|tp| match tp {
                    IntOrString::Int(i) => i.to_string(),
                    IntOrString::String(s) => s.clone(),
                })
                .unwrap_or_default();
            s.push_str(&format!(
                "  {:>5}/{:<4} → {}\n",
                p.port, proto, target
            ));
        }
    }
    s.push_str("\nSelector:     ");
    s.push_str(&service_selector_to_string(
        sv.spec.as_ref().and_then(|sp| sp.selector.as_ref()).unwrap_or(&EMPTY_LABELS),
    ));
    s.push_str("\nEvents (latest first, max 10):\n");
    s.push_str(&format_events(client, "Service", name, namespace, 10).await);
    Ok(s)
}

async fn describe_configmap(
    client: &Client,
    name: &str,
    namespace: &str,
) -> Result<String, String> {
    let api: Api<ConfigMap> = Api::namespaced(client.clone(), namespace);
    let c = api.get(name).await.map_err(|e| format!("get: {}", e))?;
    let mut s = String::new();
    s.push_str(&format!("Name:         {}\n", c.name_any()));
    s.push_str(&format!("Namespace:    {}\n", namespace));
    s.push_str(&format!(
        "Created:      {} (≈{} ago)\n",
        c.meta().creation_timestamp.as_ref().map(|t| t.0.to_rfc3339()).unwrap_or_else(|| "—".into()),
        age_of(c.meta().creation_timestamp.as_ref())
    ));
    s.push_str(&format!("Data Keys:    {}\n",
        c.data.as_ref().map(|d| d.len()).unwrap_or(0)));
    s.push_str(&format!("Binary Keys:  {}\n",
        c.binary_data.as_ref().map(|d| d.len()).unwrap_or(0)));
    s.push_str("\nData:\n");
    if let Some(d) = c.data.as_ref() {
        for (k, v) in d {
            let preview: String = v.chars().take(80).collect();
            s.push_str(&format!("  {}: {}{}\n", k, preview, if v.chars().count() > 80 { "…" } else { "" }));
        }
    } else {
        s.push_str("  (none)\n");
    }
    s.push_str("\nEvents (latest first, max 10):\n");
    s.push_str(&format_events(client, "ConfigMap", name, namespace, 10).await);
    Ok(s)
}

async fn describe_secret(client: &Client, name: &str, namespace: &str) -> Result<String, String> {
    let api: Api<Secret> = Api::namespaced(client.clone(), namespace);
    let s_obj = api.get(name).await.map_err(|e| format!("get: {}", e))?;
    let mut s = String::new();
    s.push_str(&format!("Name:         {}\n", s_obj.name_any()));
    s.push_str(&format!("Namespace:    {}\n", namespace));
    s.push_str(&format!(
        "Created:      {} (≈{} ago)\n",
        s_obj.meta().creation_timestamp.as_ref().map(|t| t.0.to_rfc3339()).unwrap_or_else(|| "—".into()),
        age_of(s_obj.meta().creation_timestamp.as_ref())
    ));
    s.push_str(&format!("Type:         {}\n", s_obj.type_.clone().unwrap_or_else(|| "Opaque".into())));
    s.push_str(&format!("Data Keys:    {}\n", s_obj.data.as_ref().map(|d| d.len()).unwrap_or(0)));
    s.push_str("\nEvents (latest first, max 10):\n");
    s.push_str(&format_events(client, "Secret", name, namespace, 10).await);
    Ok(s)
}

async fn describe_pvc(
    client: &Client,
    name: &str,
    namespace: &str,
) -> Result<String, String> {
    let api: Api<PersistentVolumeClaim> = Api::namespaced(client.clone(), namespace);
    let p = api.get(name).await.map_err(|e| format!("get: {}", e))?;
    let mut s = String::new();
    s.push_str(&format!("Name:         {}\n", p.name_any()));
    s.push_str(&format!("Namespace:    {}\n", namespace));
    s.push_str(&format!(
        "Created:      {} (≈{} ago)\n",
        p.meta().creation_timestamp.as_ref().map(|t| t.0.to_rfc3339()).unwrap_or_else(|| "—".into()),
        age_of(p.meta().creation_timestamp.as_ref())
    ));
    s.push_str(&format!("Status:       {}\n",
        p.status.as_ref().and_then(|st| st.phase.clone()).unwrap_or_else(|| "—".into())));
    s.push_str(&format!("Volume:       {}\n",
        p.spec.as_ref().and_then(|sp| sp.volume_name.clone()).unwrap_or_default()));
    s.push_str(&format!("StorageClass: {}\n",
        p.spec.as_ref().and_then(|sp| sp.storage_class_name.clone()).unwrap_or_default()));
    s.push_str(&format!(
        "Capacity:     {}\n",
        p.status
            .as_ref()
            .and_then(|st| st.capacity.as_ref())
            .and_then(|m| m.get("storage"))
            .map(|q| format!("{}", q.0))
            .unwrap_or_default()
    ));
    s.push_str("\nEvents (latest first, max 10):\n");
    s.push_str(&format_events(client, "PersistentVolumeClaim", name, namespace, 10).await);
    Ok(s)
}

async fn describe_hpa(client: &Client, name: &str, namespace: &str) -> Result<String, String> {
    let api: Api<HorizontalPodAutoscaler> = Api::namespaced(client.clone(), namespace);
    let h = api.get(name).await.map_err(|e| format!("get: {}", e))?;
    let mut s = String::new();
    s.push_str(&format!("Name:         {}\n", h.name_any()));
    s.push_str(&format!("Namespace:    {}\n", namespace));
    s.push_str(&format!(
        "Created:      {} (≈{} ago)\n",
        h.meta().creation_timestamp.as_ref().map(|t| t.0.to_rfc3339()).unwrap_or_else(|| "—".into()),
        age_of(h.meta().creation_timestamp.as_ref())
    ));
    if let Some(spec) = h.spec.as_ref() {
        s.push_str(&format!("Reference:    {}/{}\n", spec.scale_target_ref.kind, spec.scale_target_ref.name));
        s.push_str(&format!(
            "Replicas:     min={} max={}\n",
            spec.min_replicas.unwrap_or(0),
            spec.max_replicas
        ));
    }
    if let Some(st) = h.status.as_ref() {
        s.push_str(&format!(
            "Status:       current={} desired={}\n",
            st.current_replicas, st.desired_replicas
        ));
    }
    s.push_str("\nEvents (latest first, max 10):\n");
    s.push_str(&format_events(client, "HorizontalPodAutoscaler", name, namespace, 10).await);
    Ok(s)
}

async fn describe_node(client: &Client, name: &str) -> Result<String, String> {
    let api: Api<Node> = Api::all(client.clone());
    let n = api.get(name).await.map_err(|e| format!("get: {}", e))?;
    let mut s = String::new();
    s.push_str(&format!("Name:         {}\n", n.name_any()));
    s.push_str(&format!(
        "Created:      {} (≈{} ago)\n",
        n.meta().creation_timestamp.as_ref().map(|t| t.0.to_rfc3339()).unwrap_or_else(|| "—".into()),
        age_of(n.meta().creation_timestamp.as_ref())
    ));
    s.push_str(&format!("Roles:        {}\n",
        n.metadata.labels.as_ref()
            .map(|m| m.iter()
                .filter(|(k,_)| k.starts_with("node-role.kubernetes.io/"))
                .map(|(k,_)| k.trim_start_matches("node-role.kubernetes.io/").to_string())
                .collect::<Vec<_>>().join(","))
            .unwrap_or_default()));
    if let Some(info) = n.status.as_ref().and_then(|st| st.node_info.clone()) {
        s.push_str(&format!("Version:      {}\n", info.kubelet_version));
        s.push_str(&format!("OS:           {}\n", info.operating_system));
        s.push_str(&format!("Arch:         {}\n", info.architecture));
        s.push_str(&format!("Container:    {}\n", info.container_runtime_version));
    }
    if let Some(addrs) = n.status.as_ref().and_then(|st| st.addresses.as_ref()) {
        for a in addrs {
            s.push_str(&format!("  {:<13} {}\n", a.type_, a.address));
        }
    }
    s.push_str("\nConditions:\n");
    if let Some(conds) = n.status.as_ref().and_then(|st| st.conditions.as_ref()) {
        for c in conds {
            let icon = if c.status == "True" { "✓" } else { "✗" };
            s.push_str(&format!(
                "  {} {:<14} {}\n",
                icon, c.type_, c.status
            ));
        }
    }
    s.push_str("\nEvents (latest first, max 10):\n");
    s.push_str(&format_events(client, "Node", name, "", 10).await);
    Ok(s)
}

async fn describe_namespace(client: &Client, name: &str) -> Result<String, String> {
    let api: Api<Namespace> = Api::all(client.clone());
    let ns = api.get(name).await.map_err(|e| format!("get: {}", e))?;
    let mut s = String::new();
    s.push_str(&format!("Name:         {}\n", ns.name_any()));
    s.push_str(&format!(
        "Created:      {} (≈{} ago)\n",
        ns.meta().creation_timestamp.as_ref().map(|t| t.0.to_rfc3339()).unwrap_or_else(|| "—".into()),
        age_of(ns.meta().creation_timestamp.as_ref())
    ));
    s.push_str(&format!("Status:       {}\n",
        ns.status.as_ref().and_then(|st| st.phase.clone()).unwrap_or_else(|| "Active".into())));
    s.push_str(&format!("Labels:       {}\n", labels_to_string(ns.meta().labels.as_ref())));
    s.push_str("\nEvents (latest first, max 10):\n");
    s.push_str(&format_events(client, "Namespace", name, "", 10).await);
    Ok(s)
}

fn labels_to_string(labels: Option<&std::collections::BTreeMap<String, String>>) -> String {
    labels
        .map(|m| {
            m.iter()
                .map(|(k, v)| format!("{}={}", k, v))
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default()
}

const EMPTY_LABELS: std::collections::BTreeMap<String, String> = std::collections::BTreeMap::new();

fn label_selector_to_string(
    sel: &k8s_openapi::apimachinery::pkg::apis::meta::v1::LabelSelector,
) -> String {
    if let Some(m) = sel.match_labels.as_ref() {
        if !m.is_empty() {
            return labels_to_string(Some(m));
        }
    }
    if let Some(exprs) = sel.match_expressions.as_ref() {
        let parts: Vec<String> = exprs
            .iter()
            .map(|e| {
                format!(
                    "{} {} ({})",
                    e.key,
                    e.operator,
                    e.values
                        .as_ref()
                        .map(|v| v.join("|"))
                        .unwrap_or_default()
                )
            })
            .collect();
        return parts.join(", ");
    }
    "<none>".into()
}

fn service_selector_to_string(
    sel: &std::collections::BTreeMap<String, String>,
) -> String {
    if sel.is_empty() {
        "<none>".into()
    } else {
        labels_to_string(Some(sel))
    }
}

async fn format_events(
    client: &Client,
    kind: &str,
    name: &str,
    namespace: &str,
    limit: usize,
) -> String {
    use k8s_openapi::api::core::v1::Event as KubeEvent;
    let api: Api<KubeEvent> = if namespace.is_empty() {
        Api::all(client.clone())
    } else {
        Api::namespaced(client.clone(), namespace)
    };
    // Field selector is the proper way; but field-selector builder via
    // kube ListParams is not always ergonomic. We just list and filter
    // client-side — there are usually only a handful of events.
    let list = match api.list(&ListParams::default()).await {
        Ok(l) => l,
        Err(_) => return "  (events unavailable)\n".to_string(),
    };
    let mut matched: Vec<&KubeEvent> = list
        .iter()
        .filter(|e| {
            e.involved_object.kind.as_deref() == Some(kind)
                && e.involved_object.name.as_deref() == Some(name)
        })
        .collect();
    matched.sort_by(|a, b| {
        use k8s_openapi::apimachinery::pkg::apis::meta::v1::{MicroTime, Time};
        fn pick(e: &k8s_openapi::api::core::v1::Event) -> Option<chrono::DateTime<chrono::Utc>> {
            if let Some(t) = e.last_timestamp.as_ref() {
                let t: &Time = t;
                return Some(t.0);
            }
            if let Some(t) = e.event_time.as_ref() {
                let t: &MicroTime = t;
                return Some(t.0);
            }
            None
        }
        let ta = pick(a);
        let tb = pick(b);
        tb.cmp(&ta) // newest first
    });
    matched.truncate(limit);
    if matched.is_empty() {
        return "  (none)\n".to_string();
    }
    let mut out = String::new();
    out.push_str(&format!(
        "  {:<8} {:<14} {:<8} {:<20} {}\n",
        "TYPE", "REASON", "AGE", "FROM", "MESSAGE"
    ));
    for e in matched {
        let ts = event_age(e);
        let from = e.source.as_ref()
            .and_then(|s| s.component.clone())
            .or_else(|| e.source.as_ref().and_then(|s| s.host.clone()))
            .unwrap_or_default();
        let msg = e.message.clone().unwrap_or_default();
        out.push_str(&format!(
            "  {:<8} {:<14} {:<8} {:<20} {}\n",
            e.type_.clone().unwrap_or_default(),
            e.reason.clone().unwrap_or_default(),
            ts,
            truncate(&from, 20),
            msg
        ));
    }
    out
}

/// Compute a compact age string for an Event, preferring last_timestamp
/// (Time), then event_time (MicroTime), then metadata.creation_timestamp.
fn event_age(e: &k8s_openapi::api::core::v1::Event) -> String {
    use k8s_openapi::apimachinery::pkg::apis::meta::v1::{MicroTime, Time};
    fn from_dt(dt: chrono::DateTime<chrono::Utc>) -> String {
        format_chrono_dt(dt)
    }
    if let Some(t) = e.last_timestamp.as_ref() {
        let t: &Time = t;
        return from_dt(t.0);
    }
    if let Some(t) = e.event_time.as_ref() {
        let t: &MicroTime = t;
        return from_dt(t.0);
    }
    age_of(e.meta().creation_timestamp.as_ref())
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max.saturating_sub(1)).collect();
        format!("{}…", cut)
    }
}

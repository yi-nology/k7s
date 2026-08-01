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

    // Verify the target resource exists before we spawn anything.
    let client = make_client(&state).await?;
    match kind.as_str() {
        "Pod" | "pods" => {
            let api: Api<Pod> = Api::namespaced(client.clone(), &namespace);
            api.get(&name).await.map_err(|e| format!("pod not found: {}", e))?;
        }
        "Service" | "services" => {
            // For now only Pod. Service port-forward would need to resolve
            // the service to a backing pod first; that's a follow-up.
            return Err("port-forward on Service is not implemented yet (use Pod)".into());
        }
        other => return Err(format!("port-forward not supported for kind: {}", other)),
    }

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
        kind.clone(),
        name.clone(),
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
    kind: String,
    name: String,
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
        "port-forward: 127.0.0.1:{} -> {}/{}/{}:{} (id pending)",
        local_port, kind, namespace, name, remote_port
    );

    loop {
        tokio::select! {
            biased;
            _ = &mut cancel_rx => {
                eprintln!("port-forward: cancelled; dropping listener");
                // closing the listener is enough — any in-flight serve tasks
                // will exit when their TcpStream drops.
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
                let kind = kind.clone();
                let name = name.clone();
                let namespace = namespace.clone();
                tokio::spawn(async move {
                    if let Err(e) = serve_one_connection(
                        client, &kind, &name, &namespace, remote_port, &mut local,
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
    kind: &str,
    name: &str,
    namespace: &str,
    remote_port: u16,
    local: &mut tokio::net::TcpStream,
) -> Result<(), String> {
    let api: Api<Pod> = match kind {
        "Pod" | "pods" => Api::namespaced(client, namespace),
        _ => return Err(format!("kind not supported: {}", kind)),
    };

    // Each new local client gets a fresh Portforwarder (and thus a fresh
    // upstream WebSocket connection to the apiserver). This is the same
    // trade-off kubectl port-forward makes — a bit chatty, but trivially
    // correct.
    let mut portforwarder = api
        .portforward(name, &[remote_port])
        .await
        .map_err(|e| format!("portforward: {}", e))?;
    let mut remote = portforwarder
        .take_stream(remote_port)
        .ok_or_else(|| format!("port {} not in portforwarder", remote_port))?;

    // Keep the Portforwarder (and its background WebSocket task) alive
    // for the duration of the bidirectional copy.
    let _keep_alive = portforwarder;

    tokio::io::copy_bidirectional(local, &mut remote)
        .await
        .map_err(|e| format!("forward: {}", e))?;
    Ok(())
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

//! Resource commands: list_*, get_yaml, apply_yaml, delete.
//!
//! Each `list_<kind>` builds an `Api<K>`, lists, maps to DTO rows.
//! Adding a new kind? Add it to [`super::resources`].

use std::sync::Arc;

use k8s_openapi::api::apps::v1::{DaemonSet, Deployment, ReplicaSet, StatefulSet};
use k8s_openapi::api::batch::v1::{CronJob, Job};
use k8s_openapi::api::core::v1::{
    ConfigMap, Namespace, Node, PersistentVolumeClaim, Pod, Secret, Service,
};
use k8s_openapi::api::networking::v1::{Ingress, IngressClass};
use k8s_openapi::api::autoscaling::v1::HorizontalPodAutoscaler;
use k8s_openapi::api::storage::v1::StorageClass;
use k8s_openapi::api::rbac::v1::RoleBinding;
use k8s_openapi::api::core::v1::ServiceAccount;
use k8s_openapi::api::policy::v1::PodDisruptionBudget;
use kube::api::{Api, DeleteParams, ListParams};
use kube::{Resource, ResourceExt};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::kube::dto::Row;
use crate::kube::mappers;
use crate::kube::manager::ClientManager;

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_namespaces(mgr: State<'_, Arc<ClientManager>>) -> AppResult<Vec<Row>> {
    let client = mgr.client().await?;
    let api: Api<Namespace> = Api::all(client);
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| AppError::msg(format!("list namespaces: {e}")))?;
    Ok(list.iter().map(mappers::namespace_to_row).collect())
}

#[tauri::command]
pub async fn list_nodes(mgr: State<'_, Arc<ClientManager>>) -> AppResult<Vec<Row>> {
    let client = mgr.client().await?;
    let api: Api<Node> = Api::all(client);
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| AppError::msg(format!("list nodes: {e}")))?;
    Ok(list.iter().map(mappers::node_to_row).collect())
}

#[tauri::command]
pub async fn list_pods(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<Pod, _>(mgr, namespace, "pods", mappers::pod_to_row).await
}

#[tauri::command]
pub async fn list_deployments(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<Deployment, _>(mgr, namespace, "deployments", mappers::deployment_to_row).await
}

#[tauri::command]
pub async fn list_statefulsets(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<StatefulSet, _>(mgr, namespace, "statefulsets", mappers::statefulset_to_row).await
}

#[tauri::command]
pub async fn list_daemonsets(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<DaemonSet, _>(mgr, namespace, "daemonsets", mappers::daemonset_to_row).await
}

#[tauri::command]
pub async fn list_replicasets(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<ReplicaSet, _>(mgr, namespace, "replicasets", mappers::replicaset_to_row).await
}

#[tauri::command]
pub async fn list_jobs(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<Job, _>(mgr, namespace, "jobs", mappers::job_to_row).await
}

#[tauri::command]
pub async fn list_cronjobs(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<CronJob, _>(mgr, namespace, "cronjobs", mappers::cronjob_to_row).await
}

#[tauri::command]
pub async fn list_services(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<Service, _>(mgr, namespace, "services", mappers::service_to_row).await
}

#[tauri::command]
pub async fn list_ingresses(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<Ingress, _>(mgr, namespace, "ingresses", mappers::ingress_to_row).await
}

#[tauri::command]
pub async fn list_ingressclasses(mgr: State<'_, Arc<ClientManager>>) -> AppResult<Vec<Row>> {
    let client = mgr.client().await?;
    let api: Api<IngressClass> = Api::all(client);
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| AppError::msg(format!("list ingressclasses: {e}")))?;
    // No bespoke mapper yet; use a generic fallback.
    Ok(list
        .iter()
        .map(|ic| crate::kube::dto::Row {
            uid: ic.meta().uid.clone().unwrap_or_default(),
            name: ic.name_any(),
            namespace: None,
            cells: vec![crate::kube::dto::Cell::primary(ic.name_any())],
            pod: None,
            labels: None,
            selector: None,
        })
        .collect())
}

#[tauri::command]
pub async fn list_configmaps(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<ConfigMap, _>(mgr, namespace, "configmaps", mappers::configmap_to_row).await
}

#[tauri::command]
pub async fn list_secrets(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<Secret, _>(mgr, namespace, "secrets", mappers::secret_to_row).await
}

#[tauri::command]
pub async fn list_serviceaccounts(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<ServiceAccount, _>(mgr, namespace, "serviceaccounts", |sa| {
        Row {
            uid: sa.meta().uid.clone().unwrap_or_default(),
            name: sa.name_any(),
            namespace: Some(sa.namespace().unwrap_or_default()),
            cells: vec![
                crate::kube::dto::Cell::primary(sa.name_any()),
                crate::kube::dto::Cell::muted(sa.namespace().unwrap_or_default()),
            ],
            pod: None,
            labels: None,
            selector: None,
        }
    })
    .await
}

#[tauri::command]
pub async fn list_pvc(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<PersistentVolumeClaim, _>(mgr, namespace, "persistentvolumeclaims", mappers::pvc_to_row)
        .await
}

#[tauri::command]
pub async fn list_storageclasses(mgr: State<'_, Arc<ClientManager>>) -> AppResult<Vec<Row>> {
    let client = mgr.client().await?;
    let api: Api<StorageClass> = Api::all(client);
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| AppError::msg(format!("list storageclasses: {e}")))?;
    Ok(list
        .iter()
        .map(|sc| Row {
            uid: sc.meta().uid.clone().unwrap_or_default(),
            name: sc.name_any(),
            namespace: None,
            cells: vec![crate::kube::dto::Cell::primary(sc.name_any())],
            pod: None,
            labels: None,
            selector: None,
        })
        .collect())
}

#[tauri::command]
pub async fn list_poddisruptionbudgets(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<PodDisruptionBudget, _>(mgr, namespace, "poddisruptionbudgets", |pdb| {
        Row {
            uid: pdb.meta().uid.clone().unwrap_or_default(),
            name: pdb.name_any(),
            namespace: Some(pdb.namespace().unwrap_or_default()),
            cells: vec![
                crate::kube::dto::Cell::primary(pdb.name_any()),
                crate::kube::dto::Cell::muted(pdb.namespace().unwrap_or_default()),
            ],
            pod: None,
            labels: None,
            selector: None,
        }
    })
    .await
}

#[tauri::command]
pub async fn list_rolebindings(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<RoleBinding, _>(mgr, namespace, "rolebindings", |rb| Row {
        uid: rb.meta().uid.clone().unwrap_or_default(),
        name: rb.name_any(),
        namespace: Some(rb.namespace().unwrap_or_default()),
        cells: vec![
            crate::kube::dto::Cell::primary(rb.name_any()),
            crate::kube::dto::Cell::muted(rb.namespace().unwrap_or_default()),
        ],
        pod: None,
        labels: None,
        selector: None,
    })
    .await
}

#[tauri::command]
pub async fn list_hpa(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    list_all_or_ns::<HorizontalPodAutoscaler, _>(mgr, namespace, "hpa", mappers::hpa_to_row).await
}

/// Generic list helper. Maps each k8s_openapi object through `f`.
async fn list_all_or_ns<K, F>(
    mgr: State<'_, Arc<ClientManager>>,
    namespace: Option<String>,
    kind_name: &str,
    f: F,
) -> AppResult<Vec<Row>>
where
    K: kube_client::Resource<Scope = kube_client::core::NamespaceResourceScope>
        + Clone
        + serde::de::DeserializeOwned
        + serde::Serialize
        + std::fmt::Debug
        + Send
        + Sync
        + 'static,
    <K as kube_client::Resource>::DynamicType: Default,
    F: Fn(&K) -> Row,
{
    let client = mgr.client().await?;
    let api: Api<K> = match namespace.as_deref() {
        Some(ns) => Api::namespaced(client, ns),
        None => Api::all(client),
    };
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| AppError::msg(format!("list {kind_name}: {e}")))?;
    Ok(list.iter().map(f).collect())
}

// ---------------------------------------------------------------------------
// YAML read / write
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Serialize)]
pub struct ResourceDetail {
    pub kind: String,
    pub name: String,
    pub namespace: String,
    pub yaml: String,
}

#[tauri::command]
pub async fn get_yaml(
    kind: String,
    namespace: Option<String>,
    name: String,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<ResourceDetail> {
    let client = mgr.client().await?;
    let yaml = get_yaml_for_kind(&client, &kind, namespace.as_deref(), &name).await?;
    Ok(ResourceDetail {
        kind,
        name,
        namespace: namespace.unwrap_or_default(),
        yaml,
    })
}

async fn get_yaml_for_kind(
    client: &kube::Client,
    kind: &str,
    namespace: Option<&str>,
    name: &str,
) -> AppResult<String> {
    let ns = namespace.unwrap_or("default");
    let yaml = match kind {
        "Pod" | "pods" => get_one_ns::<Pod>(client, ns, name).await?,
        "Deployment" | "deployments" => get_one_ns::<Deployment>(client, ns, name).await?,
        "StatefulSet" | "statefulsets" => get_one_ns::<StatefulSet>(client, ns, name).await?,
        "DaemonSet" | "daemonsets" => get_one_ns::<DaemonSet>(client, ns, name).await?,
        "ReplicaSet" | "replicasets" => get_one_ns::<ReplicaSet>(client, ns, name).await?,
        "Job" | "jobs" => get_one_ns::<Job>(client, ns, name).await?,
        "CronJob" | "cronjobs" => get_one_ns::<CronJob>(client, ns, name).await?,
        "Service" | "services" => get_one_ns::<Service>(client, ns, name).await?,
        "ConfigMap" | "configmaps" => get_one_ns::<ConfigMap>(client, ns, name).await?,
        "Secret" | "secrets" => get_one_ns::<Secret>(client, ns, name).await?,
        "PersistentVolumeClaim" | "persistentvolumeclaims" | "pvc" => {
            get_one_ns::<PersistentVolumeClaim>(client, ns, name).await?
        }
        "HorizontalPodAutoscaler" | "horizontalpodautoscalers" | "hpa" => {
            get_one_ns::<HorizontalPodAutoscaler>(client, ns, name).await?
        }
        "Ingress" | "ingresses" => get_one_ns::<Ingress>(client, ns, name).await?,
        "Namespace" | "namespaces" => get_one_cluster::<Namespace>(client, name).await?,
        "Node" | "nodes" => get_one_cluster::<Node>(client, name).await?,
        other => return Err(AppError::Invalid(format!("unsupported kind: {other}"))),
    };
    Ok(strip_managed_fields(&yaml))
}

async fn get_one_ns<K>(client: &kube::Client, namespace: &str, name: &str) -> AppResult<String>
where
    K: kube_client::Resource<Scope = kube_client::core::NamespaceResourceScope>
        + Clone
        + serde::Serialize
        + for<'de> serde::de::Deserialize<'de>
        + std::fmt::Debug
        + Send
        + Sync
        + 'static,
    <K as kube_client::Resource>::DynamicType: Default,
{
    let api: Api<K> = Api::namespaced(client.clone(), namespace);
    let obj = api
        .get(name)
        .await
        .map_err(|e| AppError::msg(format!("get: {e}")))?;
    serde_yaml::to_string(&obj).map_err(AppError::from)
}

async fn get_one_cluster<K>(client: &kube::Client, name: &str) -> AppResult<String>
where
    K: kube_client::Resource
        + Clone
        + serde::Serialize
        + for<'de> serde::de::Deserialize<'de>
        + std::fmt::Debug
        + Send
        + Sync
        + 'static,
    <K as kube_client::Resource>::DynamicType: Default,
{
    let api: Api<K> = Api::all(client.clone());
    let obj = api
        .get(name)
        .await
        .map_err(|e| AppError::msg(format!("get: {e}")))?;
    serde_yaml::to_string(&obj).map_err(AppError::from)
}

/// `metadata.managedFields` is huge and useless to the user; strip it
/// before sending the YAML to the frontend. (We keep it server-side
/// untouched.)
fn strip_managed_fields(yaml: &str) -> String {
    // Simple line-based strip: find the `managedFields:` key, then
    // drop it and the indented block under it. Good enough for the
    // common case; if a manifest is hand-edited to omit it, nothing
    // changes.
    let mut out = String::with_capacity(yaml.len());
    let mut skipping = false;
    let mut skip_indent: Option<usize> = None;
    for line in yaml.lines() {
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();
        if skipping {
            // Continue skipping while we're still in the block.
            if let Some(base) = skip_indent {
                if indent > base && !trimmed.is_empty() {
                    continue;
                } else {
                    skipping = false;
                    skip_indent = None;
                }
            }
        }
        if trimmed.starts_with("managedFields:") {
            skipping = true;
            skip_indent = Some(indent);
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

#[tauri::command]
pub async fn apply_yaml(
    kind: String,
    namespace: Option<String>,
    name: String,
    yaml: String,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<()> {
    let client = mgr.client().await?;
    let ns = namespace.as_deref().unwrap_or("default");
    apply_yaml_for_kind(&client, &kind, ns, &name, &yaml).await
}

async fn apply_yaml_for_kind(
    client: &kube::Client,
    kind: &str,
    namespace: &str,
    name: &str,
    yaml: &str,
) -> AppResult<()> {
    match kind {
        "Pod" | "pods" => apply_one_ns::<Pod>(client, namespace, name, yaml).await,
        "Deployment" | "deployments" => apply_one_ns::<Deployment>(client, namespace, name, yaml).await,
        "StatefulSet" | "statefulsets" => apply_one_ns::<StatefulSet>(client, namespace, name, yaml).await,
        "DaemonSet" | "daemonsets" => apply_one_ns::<DaemonSet>(client, namespace, name, yaml).await,
        "ReplicaSet" | "replicasets" => apply_one_ns::<ReplicaSet>(client, namespace, name, yaml).await,
        "Job" | "jobs" => apply_one_ns::<Job>(client, namespace, name, yaml).await,
        "CronJob" | "cronjobs" => apply_one_ns::<CronJob>(client, namespace, name, yaml).await,
        "Service" | "services" => apply_one_ns::<Service>(client, namespace, name, yaml).await,
        "ConfigMap" | "configmaps" => apply_one_ns::<ConfigMap>(client, namespace, name, yaml).await,
        "Secret" | "secrets" => apply_one_ns::<Secret>(client, namespace, name, yaml).await,
        "PersistentVolumeClaim" | "persistentvolumeclaims" | "pvc" => {
            apply_one_ns::<PersistentVolumeClaim>(client, namespace, name, yaml).await
        }
        "HorizontalPodAutoscaler" | "horizontalpodautoscalers" | "hpa" => {
            apply_one_ns::<HorizontalPodAutoscaler>(client, namespace, name, yaml).await
        }
        "Ingress" | "ingresses" => apply_one_ns::<Ingress>(client, namespace, name, yaml).await,
        other => Err(AppError::Invalid(format!("apply not supported for {other}"))),
    }
}

async fn apply_one_ns<K>(client: &kube::Client, namespace: &str, name: &str, yaml: &str) -> AppResult<()>
where
    K: kube_client::Resource<Scope = kube_client::core::NamespaceResourceScope>
        + Clone
        + serde::Serialize
        + for<'de> serde::de::Deserialize<'de>
        + std::fmt::Debug
        + Send
        + Sync
        + 'static,
    <K as kube_client::Resource>::DynamicType: Default,
{
    let mut obj: K = serde_yaml::from_str(yaml).map_err(AppError::from)?;
    // Make sure the name + namespace match the URL.
    obj.meta_mut().name = Some(name.to_string());
    let meta = obj.meta_mut();
    if meta.namespace.is_none() {
        meta.namespace = Some(namespace.to_string());
    }
    let api: Api<K> = Api::namespaced(client.clone(), namespace);
    api.replace(name, &kube::api::PostParams::default(), &obj)
        .await
        .map_err(|e| AppError::msg(format!("apply: {e}")))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn delete_resource(
    kind: String,
    namespace: Option<String>,
    name: String,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<()> {
    let client = mgr.client().await?;
    let dp = DeleteParams::default();
    let ns = namespace.as_deref().unwrap_or("default");
    let map_err = |e: kube_client::Error| AppError::msg(format!("delete: {e}"));
    match kind.as_str() {
        "Pod" | "pods" => Api::<Pod>::namespaced(client.clone(), ns)
            .delete(&name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "Deployment" | "deployments" => Api::<Deployment>::namespaced(client.clone(), ns)
            .delete(&name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "StatefulSet" | "statefulsets" => Api::<StatefulSet>::namespaced(client.clone(), ns)
            .delete(&name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "DaemonSet" | "daemonsets" => Api::<DaemonSet>::namespaced(client.clone(), ns)
            .delete(&name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "ReplicaSet" | "replicasets" => Api::<ReplicaSet>::namespaced(client.clone(), ns)
            .delete(&name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "Job" | "jobs" => Api::<Job>::namespaced(client.clone(), ns)
            .delete(&name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "CronJob" | "cronjobs" => Api::<CronJob>::namespaced(client.clone(), ns)
            .delete(&name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "Service" | "services" => Api::<Service>::namespaced(client.clone(), ns)
            .delete(&name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "ConfigMap" | "configmaps" => Api::<ConfigMap>::namespaced(client.clone(), ns)
            .delete(&name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "Secret" | "secrets" => Api::<Secret>::namespaced(client.clone(), ns)
            .delete(&name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "PersistentVolumeClaim" | "persistentvolumeclaims" | "pvc" => {
            Api::<PersistentVolumeClaim>::namespaced(client.clone(), ns)
                .delete(&name, &dp)
                .await
                .map(|_| ())
                .map_err(map_err)
        }
        "HorizontalPodAutoscaler" | "horizontalpodautoscalers" | "hpa" => Api::<HorizontalPodAutoscaler>::namespaced(
            client.clone(),
            ns,
        )
        .delete(&name, &dp)
        .await
        .map(|_| ())
        .map_err(map_err),
        "Ingress" | "ingresses" => Api::<Ingress>::namespaced(client.clone(), ns)
            .delete(&name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        "Namespace" | "namespaces" => Api::<Namespace>::all(client.clone())
            .delete(&name, &dp)
            .await
            .map(|_| ())
            .map_err(map_err),
        other => Err(AppError::Invalid(format!("delete not supported for {other}"))),
    }
}

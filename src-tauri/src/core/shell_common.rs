//! Transport-agnostic command helpers shared by the Tauri and web shells.
//!
//! Every public function in this module was previously duplicated between
//! `crate::commands` (Tauri) and `crate::web::handlers` (HTTP). Moving them
//! here eliminates the drift risk and fixes several behavioural divergences.

use crate::error::{AppError, AppResult};
use crate::kube::manager::ClientManager;
use crate::kube::ResourceKind;
use k8s_openapi::api::core::v1::Secret;
use kube::api::{Api, ApiResource, DynamicObject, ListParams};
use kube::core::GroupVersionKind;
use std::sync::atomic::AtomicU64;

// ---------------------------------------------------------------------------
// Monotonic sequence counters
// ---------------------------------------------------------------------------

/// Global monotonic counter for generating unique stream / shell / forward ids.
/// Shared across all shells to prevent id collisions when both run in the same
/// binary (unlikely today, but the architecture supports it).
pub static STREAM_SEQ: AtomicU64 = AtomicU64::new(1);

/// Sequence for node-shell debug-pod names.
pub static NODE_SHELL_SEQ: AtomicU64 = AtomicU64::new(1);

// ---------------------------------------------------------------------------
// Wire DTOs
// ---------------------------------------------------------------------------

/// What the frontend needs to drive and clean up a node shell session.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeShellInfo {
    pub stream_id: String,
    pub namespace: String,
    /// Surfaced in the UI so the pod is never invisible: if cleanup somehow fails,
    /// the user has the exact name to delete by hand.
    pub pod: String,
}

/// What a proposed edit would actually do, as the *server* sees it (B36).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YamlDiff {
    /// The live object now.
    pub current: String,
    /// What would be stored if this were applied — after defaulting and any
    /// mutating webhooks.
    pub proposed: String,
}

// ---------------------------------------------------------------------------
// Kind → API mapping
// ---------------------------------------------------------------------------

/// Map a frontend kind id to its `ApiResource` and whether it is namespaced.
///
/// A custom (CRD-backed) kind id contains a slash ("group/plural", B15) and is
/// resolved from the kinds discovered on connect, so YAML/delete/events work on
/// CRDs through the same path as built-ins.
pub async fn resource_for(kind: &str, mgr: &ClientManager) -> AppResult<(ApiResource, bool)> {
    if kind.contains('/') {
        return match mgr.custom_kind(kind).await {
            Some(ck) => Ok((ck.api_resource(), ck.namespaced)),
            None => Err(AppError::Other(format!("unknown custom kind: {kind}"))),
        };
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
        "endpoints" => ("", "v1", "Endpoints", true),
        "ingresses" => ("networking.k8s.io", "v1", "Ingress", true),
        "ingressclasses" => ("networking.k8s.io", "v1", "IngressClass", false),
        "networkpolicies" => ("networking.k8s.io", "v1", "NetworkPolicy", true),
        "configmaps" => ("", "v1", "ConfigMap", true),
        "secrets" => ("", "v1", "Secret", true),
        "serviceaccounts" => ("", "v1", "ServiceAccount", true),
        "persistentvolumeclaims" => ("", "v1", "PersistentVolumeClaim", true),
        "persistentvolumes" => ("", "v1", "PersistentVolume", false),
        "storageclasses" => ("storage.k8s.io", "v1", "StorageClass", false),
        "nodes" => ("", "v1", "Node", false),
        "namespaces" => ("", "v1", "Namespace", false),
        "roles" => ("rbac.authorization.k8s.io", "v1", "Role", true),
        "rolebindings" => ("rbac.authorization.k8s.io", "v1", "RoleBinding", true),
        "clusterroles" => ("rbac.authorization.k8s.io", "v1", "ClusterRole", false),
        "clusterrolebindings" => ("rbac.authorization.k8s.io", "v1", "ClusterRoleBinding", false),
        "horizontalpodautoscalers" => ("autoscaling", "v2", "HorizontalPodAutoscaler", true),
        "poddisruptionbudgets" => ("policy", "v1", "PodDisruptionBudget", true),
        "resourcequotas" => ("", "v1", "ResourceQuota", true),
        "limitranges" => ("", "v1", "LimitRange", true),
        other => return Err(AppError::Other(format!("unknown kind: {other}"))),
    };
    let gvk = GroupVersionKind::gvk(group, version, k);
    Ok((ApiResource::from_gvk_with_plural(&gvk, kind), namespaced))
}

/// Build a dynamic API for `kind`, namespaced or cluster-scoped as appropriate.
/// Returns `(Api, is_helm)` so the caller can special-case Helm releases.
pub async fn dynamic_api(
    client: kube::Client,
    kind: &str,
    namespace: &str,
    mgr: &ClientManager,
) -> AppResult<(Api<DynamicObject>, bool)> {
    // Helm releases aren't real API objects — return a dummy Api so the caller
    // can still call `.get()` etc. on it (it won't be used; the caller checks
    // the `is_helm` flag first).
    if kind == ResourceKind::Helm.id() {
        let gvk = GroupVersionKind::gvk("helm", "v1", "Release");
        let ar = ApiResource::from_gvk_with_plural(&gvk, "helm");
        return Ok((Api::namespaced_with(client, namespace, &ar), true));
    }
    let (ar, namespaced) = resource_for(kind, mgr).await?;
    Ok((
        if namespaced {
            Api::namespaced_with(client, namespace, &ar)
        } else {
            Api::all_with(client, &ar)
        },
        false,
    ))
}

// ---------------------------------------------------------------------------
// Writable / secret / helm helpers
// ---------------------------------------------------------------------------

/// Refuse the two kinds whose YAML must never be written back.
///
/// Shared by `apply_yaml` and `dry_run_yaml` so the two can't drift — a dry run
/// that succeeded on a kind the real apply then refuses would be worse than no
/// preview at all. Accepts both `"helm"` and `"helmreleases"` for the Helm kind
/// to match what the web shell historically sent.
pub fn ensure_writable(kind: &str) -> AppResult<()> {
    if kind == ResourceKind::Helm.id() || kind == "helmreleases" {
        return Err(AppError::Other(
            "Helm releases are read-only here — use `helm upgrade` to change one".into(),
        ));
    }
    if kind == "secrets" {
        return Err(AppError::Other("editing Secrets is disabled".into()));
    }
    Ok(())
}

/// Replace `data` values in a Secret with a placeholder so raw values never
/// leave the backend.
pub fn redact_secret(obj: &mut DynamicObject) {
    for field in ["data", "stringData"] {
        if let Some(serde_json::Value::Object(map)) = obj.data.get_mut(field) {
            for v in map.values_mut() {
                *v = serde_json::Value::String("<redacted>".into());
            }
        }
    }
}

/// The rendered manifest of a Helm release, newest revision (B26).
///
/// Finds the release by label rather than reconstructing the Secret's name:
/// `sh.helm.release.v1.<name>.v<revision>` requires knowing the revision, and
/// the labels are what Helm itself queries on.
pub async fn helm_manifest(client: kube::Client, namespace: &str, name: &str) -> AppResult<String> {
    let api: Api<Secret> = Api::namespaced(client, namespace);
    let lp = ListParams::default()
        .fields(&format!("type={}", crate::kube::helm::RELEASE_SECRET_TYPE))
        .labels(&format!("name={name},owner=helm"));
    let list = api.list(&lp).await?;

    let latest = list
        .items
        .iter()
        .filter_map(crate::kube::helm::decode_release)
        .max_by_key(|r| r.revision)
        .ok_or_else(|| {
            AppError::NotFound(format!("helm release {name} not found in {namespace}"))
        })?;

    if latest.manifest.trim().is_empty() {
        return Err(AppError::Other(format!(
            "release {name} has no rendered manifest"
        )));
    }
    Ok(latest.manifest)
}

// ---------------------------------------------------------------------------
// Context merging
// ---------------------------------------------------------------------------

/// Build the switcher list: default kubeconfig contexts plus every imported
/// context not already present (imported files never shadow the default).
pub async fn merged_contexts(manager: &ClientManager) -> Vec<crate::kube::client::ContextInfo> {
    let mut merged = crate::kube::client::list_contexts().unwrap_or_default();
    let existing: std::collections::HashSet<String> =
        merged.iter().map(|c| c.name.clone()).collect();
    for (name, imp) in manager.imports().await {
        if !existing.contains(&name) {
            merged.push(crate::kube::client::ContextInfo {
                name,
                cluster: imp.cluster,
                current: false,
            });
        }
    }
    merged
}

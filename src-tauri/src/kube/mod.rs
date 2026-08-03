//! Kubernetes integration: kubeconfig/contexts, the client manager, per-kind
//! watchers that stream row snapshots, log streaming, and metrics/status pollers.
//!
//! Everything the frontend sees flows through the DTOs in [`dto`] and the Tauri
//! events named in [`events`].

pub mod alerting;
pub mod client;
pub mod discovery;
pub mod drain;
pub mod dto;
pub mod endpoints;
pub mod exec;
pub mod exporter;
pub mod grafana;
pub mod helm;
pub mod helm_market;
pub mod helm_ops;
pub mod image_archive;
pub mod image_sync;
pub mod imageimport;
pub mod imagerepo;
pub mod logs;
pub mod manager;
pub mod metrics_config;
pub mod pod_files;
pub mod saved_queries;
pub mod templates;
pub mod mappers;
pub mod metrics;
pub mod nodeshell;
pub mod nodestats;
pub mod portforward;
pub mod promql;
pub mod properties;
pub mod restart;
pub mod rollout;
pub mod watchers;

use serde::{Deserialize, Serialize};

pub use dto::Row;
pub use manager::ClientManager;

/// The twelve resource kinds the app watches. Serializes to the same lowercase
/// ids the frontend uses (see src/lib/kinds.ts).
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ResourceKind {
    Pods,
    Deployments,
    /// The generation a Deployment actually runs; also a pod's immediate owner.
    Replicasets,
    Statefulsets,
    Daemonsets,
    Jobs,
    Cronjobs,
    Services,
    Ingresses,
    /// The controller an Ingress is handled by (cluster-scoped).
    Ingressclasses,
    Configmaps,
    Secrets,
    /// The identity a pod runs as.
    Serviceaccounts,
    /// Storage claims (namespaced) and the volumes that back them (cluster-scoped).
    Persistentvolumeclaims,
    Persistentvolumes,
    /// The classes claims are provisioned from (cluster-scoped).
    Storageclasses,
    /// NetworkPolicy — namespaced; selects which pods can talk to which.
    Networkpolicies,
    /// HorizontalPodAutoscaler — namespaced; scales a workload on metrics.
    Horizontalpodautoscalers,
    /// ResourceQuota — namespaced; caps the total resource use in an ns.
    Resourcequotas,
    /// LimitRange — namespaced; caps per-Pod / per-Container resources.
    Limitranges,
    Nodes,
    Namespaces,
    /// Cluster-wide event feed (B14) — a read-only view, not a managed resource.
    Events,
    /// Helm releases (B26) — decoded from Helm's release Secrets; read-only.
    Helm,
}

impl ResourceKind {
    /// The lowercase id string (matches the frontend and serde rename).
    pub fn id(&self) -> &'static str {
        match self {
            ResourceKind::Pods => "pods",
            ResourceKind::Deployments => "deployments",
            ResourceKind::Replicasets => "replicasets",
            ResourceKind::Statefulsets => "statefulsets",
            ResourceKind::Daemonsets => "daemonsets",
            ResourceKind::Jobs => "jobs",
            ResourceKind::Cronjobs => "cronjobs",
            ResourceKind::Services => "services",
            ResourceKind::Ingresses => "ingresses",
            ResourceKind::Ingressclasses => "ingressclasses",
            ResourceKind::Configmaps => "configmaps",
            ResourceKind::Secrets => "secrets",
            ResourceKind::Serviceaccounts => "serviceaccounts",
            ResourceKind::Persistentvolumeclaims => "persistentvolumeclaims",
            ResourceKind::Persistentvolumes => "persistentvolumes",
            ResourceKind::Storageclasses => "storageclasses",
            ResourceKind::Networkpolicies => "networkpolicies",
            ResourceKind::Horizontalpodautoscalers => "horizontalpodautoscalers",
            ResourceKind::Resourcequotas => "resourcequotas",
            ResourceKind::Limitranges => "limitranges",
            ResourceKind::Nodes => "nodes",
            ResourceKind::Namespaces => "namespaces",
            ResourceKind::Events => "events",
            ResourceKind::Helm => "helm",
        }
    }

    /// The API group (e.g. "apps", "autoscaling", "" for core/v1).
    pub fn group(&self) -> &'static str {
        match self {
            ResourceKind::Pods | ResourceKind::Services | ResourceKind::Configmaps
            | ResourceKind::Secrets | ResourceKind::Serviceaccounts
            | ResourceKind::Persistentvolumeclaims | ResourceKind::Persistentvolumes
            | ResourceKind::Nodes | ResourceKind::Namespaces | ResourceKind::Events
            | ResourceKind::Resourcequotas | ResourceKind::Limitranges => "",
            ResourceKind::Deployments | ResourceKind::Replicasets
            | ResourceKind::Statefulsets | ResourceKind::Daemonsets => "apps",
            ResourceKind::Jobs | ResourceKind::Cronjobs => "batch",
            ResourceKind::Ingresses | ResourceKind::Ingressclasses
            | ResourceKind::Networkpolicies => "networking.k8s.io",
            ResourceKind::Storageclasses => "storage.k8s.io",
            ResourceKind::Horizontalpodautoscalers => "autoscaling",
            ResourceKind::Helm => "",
        }
    }

    /// The API version (e.g. "v1", "v1beta1").
    pub fn version(&self) -> &'static str {
        match self {
            ResourceKind::Horizontalpodautoscalers => "v1",
            _ => "v1",
        }
    }

    /// The plural lowercase name (e.g. "horizontalpodautoscalers").
    pub fn plural(&self) -> &'static str {
        self.id()
    }

    /// The PascalCase kind name (e.g. "HorizontalPodAutoscaler").
    pub fn kind_name(&self) -> &'static str {
        match self {
            ResourceKind::Pods => "Pod",
            ResourceKind::Deployments => "Deployment",
            ResourceKind::Replicasets => "ReplicaSet",
            ResourceKind::Statefulsets => "StatefulSet",
            ResourceKind::Daemonsets => "DaemonSet",
            ResourceKind::Jobs => "Job",
            ResourceKind::Cronjobs => "CronJob",
            ResourceKind::Services => "Service",
            ResourceKind::Ingresses => "Ingress",
            ResourceKind::Ingressclasses => "IngressClass",
            ResourceKind::Configmaps => "ConfigMap",
            ResourceKind::Secrets => "Secret",
            ResourceKind::Serviceaccounts => "ServiceAccount",
            ResourceKind::Persistentvolumeclaims => "PersistentVolumeClaim",
            ResourceKind::Persistentvolumes => "PersistentVolume",
            ResourceKind::Storageclasses => "StorageClass",
            ResourceKind::Networkpolicies => "NetworkPolicy",
            ResourceKind::Horizontalpodautoscalers => "HorizontalPodAutoscaler",
            ResourceKind::Resourcequotas => "ResourceQuota",
            ResourceKind::Limitranges => "LimitRange",
            ResourceKind::Nodes => "Node",
            ResourceKind::Namespaces => "Namespace",
            ResourceKind::Events => "Event",
            ResourceKind::Helm => "HelmRelease",
        }
    }

    /// Whether this kind is namespaced.
    pub fn is_namespaced(&self) -> bool {
        match self {
            ResourceKind::Nodes | ResourceKind::Persistentvolumes
            | ResourceKind::Storageclasses | ResourceKind::Namespaces
            | ResourceKind::Events | ResourceKind::Helm => false,
            _ => true,
        }
    }

    /// Create an ApiResource for DynamicObject-based watchers.
    pub fn api_resource(&self) -> kube::core::ApiResource {
        let gvk = kube::core::GroupVersionKind::gvk(self.group(), self.version(), self.kind_name());
        kube::core::ApiResource::from_gvk_with_plural(&gvk, self.plural())
    }
}

/// Tauri event names emitted to the webview. Kept in one place so the frontend
/// (TauriProvider) and backend agree on the wire contract.
pub mod events {
    /// Full row snapshot for a kind: `{ kind, rows }`. Debounced per kind.
    pub const RESOURCE_UPDATE: &str = "resource-update";
    /// CRD-backed kinds discovered on connect (B15): `[{ id, group, kind, … }]`.
    pub const CUSTOM_KINDS: &str = "custom-kinds";
    /// Pod usage keyed by "ns/name": `{ [key]: { cpuMillis, memBytes } }`.
    pub const POD_METRICS: &str = "pod-metrics";
    /// Node usage percentages keyed by node name: `{ [name]: { cpuPercent, memPercent } }`.
    pub const NODE_METRICS: &str = "node-metrics";
    /// Cluster-wide status for the status bar / switcher.
    pub const CLUSTER_STATUS: &str = "cluster-status";
    /// Count of live watcher + log-stream tasks (sidebar footer).
    pub const WATCH_STATUS: &str = "watch-status";
    /// The active port-forwards, pushed whenever one is added, removed, or fails
    /// (B16) — so the strip reflects failures without the UI polling for them.
    pub const FORWARDS_UPDATE: &str = "forwards-update";
    /// One node-exporter sample for a node (B27): `{ node, sample }`. Only while
    /// that node's Metrics tab is open.
    pub const NODE_STATS: &str = "node-stats";
    /// Why a node has no plots (B27): `{ node, message }`.
    pub const NODE_STATS_ERROR: &str = "node-stats-error";
    /// Progress of a node drain (B20): `{ node, evicted, total, failures, done }`.
    /// One event carrying the node, rather than a per-node channel, so progress
    /// lands in the store and survives navigating away mid-drain.
    pub const DRAIN_PROGRESS: &str = "drain-progress";
    /// Log lines for a stream: emitted as `log-line:{streamId}`.
    pub const LOG_LINE_PREFIX: &str = "log-line:";
    /// Stream end/error: emitted as `log-closed:{streamId}`.
    pub const LOG_CLOSED_PREFIX: &str = "log-closed:";
}

/// Payload for [`events::RESOURCE_UPDATE`].
///
/// `kind` is the frontend kind id as a string rather than a [`ResourceKind`]:
/// custom (CRD-backed) kinds aren't in that enum, and their ids are "group/plural"
/// (B15). Built-in kinds pass `ResourceKind::id()`, so the wire format is
/// unchanged either way.
#[derive(Serialize, Clone)]
pub struct ResourceUpdate {
    pub kind: String,
    pub rows: Vec<Row>,
}

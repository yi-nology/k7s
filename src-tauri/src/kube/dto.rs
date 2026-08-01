//! Data transfer objects — the contract between the backend and the React UI.
//!
//! Every value that crosses the Tauri command / event boundary is one of
//! these. The frontend (`src/providers/types.ts`) mirrors this file's shapes
//! 1:1 — when adding a field here, add it there too.
//!
//! Design principles:
//!   - **Tone** is the only color channel exposed to the UI. The backend
//!     decides semantics ("this pod is in CrashLoopBackOff"); the frontend
//!     just maps `Tone` to a CSS variable. One source of truth for status
//!     semantics — drift between backend and UI is impossible.
//!   - `Cell` is the unit of display. Columns are sequences of cells.
//!   - `Row` carries a stable `uid` for React keys and selection.
//!   - `PodMeta` is the only per-kind extension; everything else fits `Row`.

use chrono::{DateTime, Utc};
use serde::Serialize;

// ---------------------------------------------------------------------------
// Tone: the single coloring channel
// ---------------------------------------------------------------------------

/// One of six tonal buckets. The frontend maps this to a CSS variable:
///   - `primary`   → primary text (typically the name column)
///   - `secondary` → secondary text (data values like CPU/MEM)
///   - `muted`     → de-emphasised (namespace, age)
///   - `ok`        → green / healthy
///   - `warn`      → amber / transient
///   - `err`       → red / failure
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Tone {
    Primary,
    Secondary,
    Muted,
    Ok,
    Warn,
    Err,
}

impl Tone {
    pub fn from_bool(healthy: bool) -> Self {
        if healthy {
            Tone::Ok
        } else {
            Tone::Err
        }
    }
}

// ---------------------------------------------------------------------------
// Cell: the unit of display
// ---------------------------------------------------------------------------

/// A single table cell. `text` is the display string; the rest shape how
/// it's rendered (color, sort key, navigation target, ...).
#[derive(Debug, Clone, Serialize)]
pub struct Cell {
    pub text: String,
    pub tone: Tone,
    /// If true, render a leading "● " status dot in the tone color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dot: Option<bool>,
    /// When `"age"`, the UI treats `text` as an RFC3339 timestamp and
    /// reformats into "4d2h" form, ticking every 30s.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<CellFormat>,
    /// Optional numeric sort key (for columns like "3.2Gi" / "486Mi" that
    /// don't order lexically).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort: Option<f64>,
    /// Navigation target — when present, the cell is rendered as a link
    /// that jumps to another object.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nav: Option<NavTarget>,
}

impl Cell {
    pub fn new(text: impl Into<String>, tone: Tone) -> Self {
        Self {
            text: text.into(),
            tone,
            dot: None,
            format: None,
            sort: None,
            nav: None,
        }
    }

    pub fn primary(text: impl Into<String>) -> Self {
        Self::new(text, Tone::Primary)
    }

    pub fn secondary(text: impl Into<String>) -> Self {
        Self::new(text, Tone::Secondary)
    }

    pub fn muted(text: impl Into<String>) -> Self {
        Self::new(text, Tone::Muted)
    }

    pub fn ok(text: impl Into<String>) -> Self {
        Self::new(text, Tone::Ok)
    }

    pub fn warn(text: impl Into<String>) -> Self {
        Self::new(text, Tone::Warn)
    }

    pub fn err(text: impl Into<String>) -> Self {
        Self::new(text, Tone::Err)
    }

    pub fn age(ts: DateTime<Utc>) -> Self {
        Self {
            text: ts.to_rfc3339(),
            tone: Tone::Muted,
            dot: None,
            format: Some(CellFormat::Age),
            sort: Some(ts.timestamp() as f64),
            nav: None,
        }
    }

    pub fn with_dot(mut self) -> Self {
        self.dot = Some(true);
        self
    }

    pub fn with_sort(mut self, n: f64) -> Self {
        self.sort = Some(n);
        self
    }

    pub fn with_nav(mut self, nav: NavTarget) -> Self {
        self.nav = Some(nav);
        self
    }
}

/// Cell display hints.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CellFormat {
    /// Reformat text as a k8s-style age string ("4d2h"), ticking.
    Age,
}

// ---------------------------------------------------------------------------
// Nav: click-through to another object
// ---------------------------------------------------------------------------

/// Points to another object the table can navigate to (e.g. a pod's
/// owning ReplicaSet, a claim's volume).
#[derive(Debug, Clone, Serialize)]
pub struct NavTarget {
    /// Built-in plural ("deployments") or a CRD "group/plural".
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    pub name: String,
}

impl NavTarget {
    pub fn new(kind: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            namespace: None,
            name: name.into(),
        }
    }

    pub fn in_ns(mut self, ns: impl Into<String>) -> Self {
        self.namespace = Some(ns.into());
        self
    }
}

// ---------------------------------------------------------------------------
// PodMeta: the only per-kind row extension
// ---------------------------------------------------------------------------

/// Pod-only fields the detail panel needs (node, containers, restarts...).
#[derive(Debug, Clone, Serialize)]
pub struct PodMeta {
    pub node: String,
    pub containers: Vec<String>,
    pub status: String,
    pub ready: String,
    pub restarts: i32,
    /// RFC3339 creation timestamp.
    pub creation_ts: String,
    pub status_tone: Tone,
}

// ---------------------------------------------------------------------------
// Row: one table row
// ---------------------------------------------------------------------------

/// One row in a resource table.
#[derive(Debug, Clone, Serialize)]
pub struct Row {
    /// Stable id (k8s uid, or a synthetic id for non-namespaced objects).
    pub uid: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    /// Cells, in the same order as the kind's columns.
    pub cells: Vec<Cell>,
    /// Present only for pods.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pod: Option<PodMeta>,
    /// Labels, for label-selector filtering.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labels: Option<std::collections::BTreeMap<String, String>>,
    /// Workload's pod selector (for "view pods" jumps).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selector: Option<std::collections::BTreeMap<String, String>>,
}

// ---------------------------------------------------------------------------
// Resource snapshot: the wire shape emitted on `resource-update` events
// ---------------------------------------------------------------------------

/// A complete snapshot of one resource kind's rows. Emitted by watchers
/// (debounced) and replaces whatever the frontend has.
#[derive(Debug, Clone, Serialize)]
pub struct ResourceSnapshot {
    pub kind: String,
    pub rows: Vec<Row>,
}

// ---------------------------------------------------------------------------
// Cluster-level DTOs
// ---------------------------------------------------------------------------

/// A kubeconfig context for the cluster switcher.
#[derive(Debug, Clone, Serialize)]
pub struct ContextInfo {
    pub name: String,
    pub cluster: String,
    pub user: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    pub is_current: bool,
}

/// Result of a successful `connect`.
#[derive(Debug, Clone, Serialize)]
pub struct ClusterInfo {
    pub context: String,
    pub cluster_name: String,
    pub server: String,
    pub version: String,
}

/// Cluster-wide status (status bar / cluster switcher).
#[derive(Debug, Clone, Serialize)]
pub struct ClusterStatus {
    pub connected: bool,
    pub version: String,
    pub api_latency_ms: u64,
    pub nodes_ready: u32,
    pub nodes_total: u32,
    /// null when metrics-server is absent.
    pub cpu_percent: Option<f64>,
    pub mem_percent: Option<f64>,
}

impl Default for ClusterStatus {
    fn default() -> Self {
        Self {
            connected: false,
            version: String::new(),
            api_latency_ms: 0,
            nodes_ready: 0,
            nodes_total: 0,
            cpu_percent: None,
            mem_percent: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Resource kinds
// ---------------------------------------------------------------------------

/// Canonical string id for a resource kind, used everywhere (commands,
/// events, navigation, frontend). Keep in sync with `src/providers/types.ts`
/// (`ResourceKind`).
pub const KIND_PODS: &str = "pods";
pub const KIND_DEPLOYMENTS: &str = "deployments";
pub const KIND_STATEFULSETS: &str = "statefulsets";
pub const KIND_DAEMONSETS: &str = "daemonsets";
pub const KIND_REPLICASETS: &str = "replicasets";
pub const KIND_JOBS: &str = "jobs";
pub const KIND_CRONJOBS: &str = "cronjobs";
pub const KIND_SERVICES: &str = "services";
pub const KIND_INGRESSES: &str = "ingresses";
pub const KIND_INGRESSCLASSES: &str = "ingressclasses";
pub const KIND_CONFIGMAPS: &str = "configmaps";
pub const KIND_SECRETS: &str = "secrets";
pub const KIND_SERVICEACCOUNTS: &str = "serviceaccounts";
pub const KIND_PERSISTENTVOLUMECLAIMS: &str = "persistentvolumeclaims";
pub const KIND_PERSISTENTVOLUMES: &str = "persistentvolumes";
pub const KIND_STORAGECLASSES: &str = "storageclasses";
pub const KIND_NODES: &str = "nodes";
pub const KIND_NAMESPACES: &str = "namespaces";
pub const KIND_EVENTS: &str = "events";
pub const KIND_HELM: &str = "helm";
pub const KIND_HPA: &str = "hpa";

/// Built-in kinds listed in the sidebar nav, grouped by area.
pub const NAV_WORKLOADS: &[&str] = &[
    KIND_PODS,
    KIND_DEPLOYMENTS,
    KIND_STATEFULSETS,
    KIND_DAEMONSETS,
    KIND_REPLICASETS,
    KIND_JOBS,
    KIND_CRONJOBS,
];

pub const NAV_NETWORK: &[&str] = &[KIND_SERVICES, KIND_INGRESSES, KIND_INGRESSCLASSES];

pub const NAV_CONFIG: &[&str] = &[
    KIND_CONFIGMAPS,
    KIND_SECRETS,
    KIND_PERSISTENTVOLUMECLAIMS,
    KIND_PERSISTENTVOLUMES,
    KIND_STORAGECLASSES,
    KIND_SERVICEACCOUNTS,
];

pub const NAV_CLUSTER: &[&str] = &[KIND_NODES, KIND_NAMESPACES];

pub const NAV_METADATA: &[&str] = &[KIND_EVENTS, KIND_HPA, KIND_HELM];

/// True if the kind is cluster-scoped (no namespace). Used to skip the
/// namespace filter and to decide which `Api::xxx` to construct.
pub fn is_cluster_scoped(kind: &str) -> bool {
    matches!(
        kind,
        KIND_NODES | KIND_NAMESPACES | KIND_PERSISTENTVOLUMES | KIND_STORAGECLASSES
    )
}

/// Pretty label for a kind id ("configmaps" → "ConfigMaps").
pub fn kind_label(kind: &str) -> &'static str {
    match kind {
        KIND_PODS => "Pods",
        KIND_DEPLOYMENTS => "Deployments",
        KIND_STATEFULSETS => "StatefulSets",
        KIND_DAEMONSETS => "DaemonSets",
        KIND_REPLICASETS => "ReplicaSets",
        KIND_JOBS => "Jobs",
        KIND_CRONJOBS => "CronJobs",
        KIND_SERVICES => "Services",
        KIND_INGRESSES => "Ingresses",
        KIND_INGRESSCLASSES => "IngressClasses",
        KIND_CONFIGMAPS => "ConfigMaps",
        KIND_SECRETS => "Secrets",
        KIND_SERVICEACCOUNTS => "ServiceAccounts",
        KIND_PERSISTENTVOLUMECLAIMS => "PVCs",
        KIND_PERSISTENTVOLUMES => "PersistentVolumes",
        KIND_STORAGECLASSES => "StorageClasses",
        KIND_NODES => "Nodes",
        KIND_NAMESPACES => "Namespaces",
        KIND_EVENTS => "Events",
        KIND_HELM => "Helm Releases",
        KIND_HPA => "HPAs",
        other => {
            // Fallback: title-case the string, but keep the lifetime right.
            // This leaks a bit of memory per call, but only in the fallback
            // path — fine for now.
            Box::leak(other.to_string().into_boxed_str())
        }
    }
}

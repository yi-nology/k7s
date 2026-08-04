//! Properties (B13, B18): the "what is this thing actually wired to" view — the
//! things you'd otherwise dig out of YAML or several kubectl commands.
//!
//! Rather than a bespoke DTO and renderer per kind, a gatherer returns a generic
//! [`Properties`] document: an ordered list of [`Section`]s, each a field grid, a
//! table, or a set of chips. The frontend renders that shape for every kind, so
//! adding a kind is one gatherer here and nothing there.
//!
//! Every lookup beyond the object itself is best-effort: a missing PVC/PV or an
//! RBAC denial degrades that row or section rather than failing the whole panel.
//!
//! Kinds with a gatherer (see [`gather`]) show the tab; the rest don't.

use super::dto::{Cell, NavTarget, Tone};
use super::helm;
use crate::error::{AppError, AppResult};
use k8s_openapi::api::apps::v1::{Deployment, ReplicaSet, StatefulSet};
use k8s_openapi::api::autoscaling::v2::HorizontalPodAutoscaler;
use k8s_openapi::api::batch::v1::{CronJob, Job};
use k8s_openapi::api::core::v1::{
    ConfigMap, Namespace, Node, PersistentVolume, PersistentVolumeClaim, Pod, ResourceQuota, Secret,
    Service, ServiceAccount,
};
use k8s_openapi::api::discovery::v1::EndpointSlice;
use k8s_openapi::api::networking::v1::{Ingress, NetworkPolicy};
use k8s_openapi::api::rbac::v1::{ClusterRole, ClusterRoleBinding, Role, RoleBinding};
use k8s_openapi::api::storage::v1::StorageClass;
use k8s_openapi::apiextensions_apiserver::pkg::apis::apiextensions::v1::CustomResourceDefinition;
use k8s_openapi::apimachinery::pkg::api::resource::Quantity;
use kube::api::{Api, ListParams};
use kube::core::DynamicObject;
use kube::{Client, ResourceExt};
use super::ResourceKind;
use serde::Serialize;
use std::collections::BTreeMap;

/// A label/annotation entry (a list keeps frontend rendering simple).
#[derive(Serialize, Clone)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

/// One row of a field grid: a label, a toned value, and an optional nav target
/// that makes the value a click-through link (B33).
#[derive(Serialize)]
pub struct Field {
    pub label: String,
    pub value: Cell,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nav: Option<NavTarget>,
}

impl Field {
    /// Attach a nav target, making this field a link (builder style).
    fn with_nav(mut self, target: NavTarget) -> Self {
        self.nav = Some(target);
        self
    }
}

/// What a section renders as. Tagged so the frontend can switch on `type`.
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Body {
    /// A label/value grid (the "Overview" shape).
    Fields { fields: Vec<Field> },
    /// A table. The frontend shows the row count beside the section title.
    Table { columns: Vec<String>, rows: Vec<Vec<Cell>> },
    /// key=value chips (labels/annotations).
    Chips { chips: Vec<KeyValue> },
}

/// One section of the Properties tab.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub title: String,
    /// Shown in place of an empty table ("no taints"). Without one, an empty
    /// table section is dropped entirely (see [`Properties::push_table`]).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub empty_note: Option<String>,
    pub body: Body,
}

/// The whole panel: sections in display order.
#[derive(Serialize, Default)]
pub struct Properties {
    pub sections: Vec<Section>,
}

impl Properties {
    fn push(&mut self, section: Section) {
        self.sections.push(section);
    }

    /// Add a field grid.
    fn fields(&mut self, title: &str, fields: Vec<Field>) {
        self.push(Section {
            title: title.into(),
            empty_note: None,
            body: Body::Fields { fields },
        });
    }

    /// Add a table. `empty_note` = Some means an empty table still renders (with
    /// the note); None means an empty table is omitted, so optional sections like
    /// "Other volumes" simply don't appear when there's nothing to show.
    fn push_table(
        &mut self,
        title: &str,
        empty_note: Option<&str>,
        columns: &[&str],
        rows: Vec<Vec<Cell>>,
    ) {
        if rows.is_empty() && empty_note.is_none() {
            return;
        }
        self.push(Section {
            title: title.into(),
            empty_note: empty_note.map(Into::into),
            body: Body::Table {
                columns: columns.iter().map(|c| c.to_string()).collect(),
                rows,
            },
        });
    }

    /// Add a chips section, omitted when empty.
    fn chips(&mut self, title: &str, chips: Vec<KeyValue>) {
        if chips.is_empty() {
            return;
        }
        self.push(Section { title: title.into(), empty_note: None, body: Body::Chips { chips } });
    }
}

/// Placeholder for an unset value (matches the tables' em dash).
const DASH: &str = "—";

fn or_dash(s: Option<String>) -> String {
    s.filter(|v| !v.is_empty()).unwrap_or_else(|| DASH.into())
}

/// A plain secondary-toned cell.
fn c(text: impl Into<String>) -> Cell {
    Cell::new(text.into(), Tone::Secondary)
}

/// A name cell (primary emphasis, matching the tables' NAME column).
fn name_cell(text: impl Into<String>) -> Cell {
    Cell::new(text.into(), Tone::Primary)
}

/// A muted cell (de-emphasized detail).
fn muted(text: impl Into<String>) -> Cell {
    Cell::new(text.into(), Tone::Muted)
}

/// A field with a secondary-toned value.
fn field(label: &str, value: impl Into<String>) -> Field {
    Field { label: label.into(), value: c(value.into()), nav: None }
}

/// A field whose value carries a tone (e.g. a status).
fn field_toned(label: &str, value: impl Into<String>, tone: Tone) -> Field {
    Field { label: label.into(), value: Cell::new(value.into(), tone), nav: None }
}

/// A cell naming another object that may not exist: link it when it does, say so
/// when it doesn't (B42). A link to a 404 is worse than the plain text it
/// replaced, and an absent reference is usually the answer to "why isn't this
/// working" — a missing backend Service is what an Ingress 503 looks like.
fn ref_cell(name: &str, exists: bool, target: NavTarget) -> Cell {
    if name.is_empty() || name == DASH {
        c(DASH)
    } else if exists {
        Cell::link(name.to_string(), Tone::Secondary, Some(target))
    } else {
        Cell::new(format!("{name} (not found)"), Tone::Warn)
    }
}

/// A field that is a click-through link when `nav` is Some (B33).
fn nav_field(label: &str, value: impl Into<String>, nav: Option<NavTarget>) -> Field {
    let f = field(label, value);
    match nav {
        Some(target) => f.with_nav(target),
        None => f,
    }
}

/// Map a built-in Kubernetes Kind (PascalCase) to the app's nav id, for the kinds
/// we list. Returns None for kinds without a table (e.g. ReplicaSet, Endpoints),
/// so an owner of that kind renders as plain text rather than a dead link (B33).
pub fn builtin_nav_id(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "Pod" => "pods",
        "Deployment" => "deployments",
        "ReplicaSet" => "replicasets",
        "StatefulSet" => "statefulsets",
        "DaemonSet" => "daemonsets",
        "Job" => "jobs",
        "CronJob" => "cronjobs",
        "Service" => "services",
        "Ingress" => "ingresses",
        "IngressClass" => "ingressclasses",
        "ConfigMap" => "configmaps",
        "Secret" => "secrets",
        "ServiceAccount" => "serviceaccounts",
        "PersistentVolumeClaim" => "persistentvolumeclaims",
        "PersistentVolume" => "persistentvolumes",
        "StorageClass" => "storageclasses",
        "Node" => "nodes",
        "Namespace" => "namespaces",
        "Role" => "roles",
        "ClusterRole" => "clusterroles",
        "RoleBinding" => "rolebindings",
        "ClusterRoleBinding" => "clusterrolebindings",
        "HorizontalPodAutoscaler" => "horizontalpodautoscalers",
        "NetworkPolicy" => "networkpolicies",
        "ResourceQuota" => "resourcequotas",
        _ => return None,
    })
}

/// Resolve a pod's controller owner into a display string and, where we can
/// navigate to it, a nav target (B33).
///
/// A ReplicaSet owner is resolved *through* to its Deployment — that's the
/// workload the user thinks of as the owner, and it stays the more useful
/// destination even now that ReplicaSets are listed (B40). A bare ReplicaSet (no
/// Deployment above it, or an RBAC-denied lookup) links to the ReplicaSet itself.
pub async fn resolve_owner(client: &Client, namespace: &str, pod: &Pod) -> (String, Option<NavTarget>) {
    let refs = pod.metadata.owner_references.as_ref();
    let owner = refs.and_then(|o| o.iter().find(|r| r.controller == Some(true)).or_else(|| o.first()));
    let Some(owner) = owner else {
        return (DASH.into(), None);
    };

    if owner.kind == "ReplicaSet" {
        let rs_api: Api<ReplicaSet> = Api::namespaced(client.clone(), namespace);
        if let Ok(rs) = rs_api.get(&owner.name).await {
            if let Some(dep) = rs
                .metadata
                .owner_references
                .as_ref()
                .and_then(|o| o.iter().find(|r| r.kind == "Deployment"))
            {
                return (
                    format!("Deployment/{}", dep.name),
                    Some(NavTarget {
                        kind: "deployments".into(),
                        namespace: Some(namespace.to_string()),
                        name: dep.name.clone(),
                    }),
                );
            }
        }
        // A bare ReplicaSet (no Deployment above it, or the lookup was denied).
        // Since B40 lists ReplicaSets, this is a real destination now rather than
        // the dead end it used to be.
        return (
            format!("ReplicaSet/{}", owner.name),
            Some(NavTarget::namespaced("replicasets", namespace, owner.name.clone())),
        );
    }

    let display = format!("{}/{}", owner.kind, owner.name);
    match builtin_nav_id(&owner.kind) {
        // A Node owner (static/mirror pods) is cluster-scoped; everything else
        // shares the pod's namespace.
        Some(nav) => {
            let namespace = (nav != "nodes").then(|| namespace.to_string());
            (display, Some(NavTarget { kind: nav.into(), namespace, name: owner.name.clone() }))
        }
        None => (display, None),
    }
}

/// Map a BTreeMap of labels/annotations into a KeyValue list (sorted by BTreeMap).
fn to_kv(map: Option<&BTreeMap<String, String>>) -> Vec<KeyValue> {
    map.map(|m| m.iter().map(|(k, v)| KeyValue { key: k.clone(), value: v.clone() }).collect())
        .unwrap_or_default()
}

/// Render a selector map as `k=v,k2=v2` (the form kubectl prints and accepts).
fn selector_text(map: Option<&BTreeMap<String, String>>) -> String {
    match map {
        Some(m) if !m.is_empty() => {
            m.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join(",")
        }
        _ => DASH.into(),
    }
}

/// A quantity as its original string ("100m", "2Gi"), or a dash.
fn qty(q: Option<&Quantity>) -> String {
    q.map(|q| q.0.clone()).unwrap_or_else(|| DASH.into())
}

/// "n/total" ready-style tone: green when all ready, amber when partial, red at zero.
fn ready_tone(ready: i32, desired: i32) -> Tone {
    if desired == 0 {
        Tone::Muted
    } else if ready >= desired {
        Tone::Good
    } else if ready == 0 {
        Tone::Bad
    } else {
        Tone::Warn
    }
}

/// Tone for a condition's status.
///
/// Most conditions are "good when True" (Ready, Available), but the pressure-style
/// ones invert — a Node with MemoryPressure=True is unhealthy. Getting this wrong
/// would paint a struggling node green, so the polarity is explicit.
fn condition_tone(type_: &str, status: &str) -> Tone {
    let good_when_true = !matches!(
        type_,
        "MemoryPressure"
            | "DiskPressure"
            | "PIDPressure"
            | "NetworkUnavailable"
            | "ReplicaFailure"
    );
    match (status, good_when_true) {
        ("True", true) | ("False", false) => Tone::Good,
        ("False", true) | ("True", false) => Tone::Bad,
        // "Unknown" — the kubelet stopped reporting, or the controller hasn't yet.
        _ => Tone::Warn,
    }
}

/// One condition, flattened from the per-kind condition types (which share these
/// fields but no common trait).
struct Condition {
    type_: String,
    status: String,
    reason: String,
    message: String,
    /// RFC3339 last transition time, if reported.
    since: Option<String>,
}

/// Build the standard Conditions table.
fn conditions_section(props: &mut Properties, conds: Vec<Condition>) {
    let rows = conds
        .into_iter()
        .map(|c0| {
            vec![
                name_cell(c0.type_.clone()),
                Cell::new(c0.status.clone(), condition_tone(&c0.type_, &c0.status)),
                c(c0.reason),
                c(c0.message),
                match c0.since {
                    Some(t) => Cell::age(Some(t)),
                    None => muted(DASH),
                },
            ]
        })
        .collect();
    props.push_table(
        "Conditions",
        Some("no conditions reported"),
        &["TYPE", "STATUS", "REASON", "MESSAGE", "SINCE"],
        rows,
    );
}

/// Labels + annotations, the tail of every kind's panel.
fn meta_sections<K: ResourceExt>(props: &mut Properties, obj: &K) {
    props.chips("Labels", to_kv(obj.meta().labels.as_ref()));
    props.chips("Annotations", to_kv(obj.meta().annotations.as_ref()));
}

/// Gather properties for `kind`. Errors for a kind with no gatherer — the frontend
/// only offers the tab for the kinds listed here (see `KINDS_WITH_PROPERTIES`).
pub async fn gather(
    client: Client,
    kind: &str,
    namespace: &str,
    name: &str,
) -> AppResult<Properties> {
    match kind {
        "pods" => gather_pod(client, namespace, name).await,
        "deployments" => gather_deployment(client, namespace, name).await,
        "services" => gather_service(client, namespace, name).await,
        "statefulsets" => gather_statefulset(client, namespace, name).await,
        "ingresses" => gather_ingress(client, namespace, name).await,
        "nodes" => gather_node(client, name).await,
        "configmaps" => gather_configmap(client, namespace, name).await,
        "secrets" => gather_secret(client, namespace, name).await,
        "namespaces" => gather_namespace(client, name).await,
        "storageclasses" => gather_storageclass(client, name).await,
        "serviceaccounts" => gather_serviceaccount(client, namespace, name).await,
        "persistentvolumeclaims" => gather_pvc(client, namespace, name).await,
        "persistentvolumes" => gather_pv(client, name).await,
        "jobs" => gather_job(client, namespace, name).await,
        "cronjobs" => gather_cronjob(client, namespace, name).await,
        "horizontalpodautoscalers" => gather_hpa(client, namespace, name).await,
        "networkpolicies" => gather_networkpolicy(client, namespace, name).await,
        "resourcequotas" => gather_resourcequota(client, namespace, name).await,
        "roles" => gather_role(client, namespace, name).await,
        "clusterroles" => gather_clusterrole(client, name).await,
        "rolebindings" => gather_rolebinding(client, namespace, name).await,
        "clusterrolebindings" => gather_clusterrolebinding(client, name).await,
        "helm" => gather_helm(client, namespace, name).await,
        "poddisruptionbudgets" => gather_pdb(client, namespace, name).await,
        "mutatingwebhookconfigurations" => gather_webhook(client, name, true).await,
        "validatingwebhookconfigurations" => gather_webhook(client, name, false).await,
        "apiservices" => gather_api_service(client, name).await,
        other if other.contains('/') => gather_crd_detail(client, other).await,
        other => Err(AppError::Other(format!("no properties for kind {other}"))),
    }
}

// ---------------------------------------------------------------------------
// Ingresses (B43)
// ---------------------------------------------------------------------------

/// An Ingress backend port, which is *either* a number or a named port on the
/// Service — murphy-yi's only Ingress uses a name, which is the case a
/// number-only reading would silently drop.
fn backend_port(p: Option<&k8s_openapi::api::networking::v1::ServiceBackendPort>) -> String {
    match p {
        Some(port) => port
            .number
            .map(|n| n.to_string())
            .or_else(|| port.name.clone())
            .unwrap_or_else(|| DASH.into()),
        None => DASH.into(),
    }
}

/// Properties for an Ingress: what it routes, to which Services, over which
/// certificates.
///
/// The routing table is the whole point — an Ingress is a pile of rules pointing
/// at Services, and until now the app showed only HOSTS and CLASS, so the
/// backends were invisible rather than merely unlinked. Every Service and Secret
/// it names is existence-checked, because an Ingress pointing at a Service that
/// isn't there is one of the most common ways this breaks.
async fn gather_ingress(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<Ingress> = Api::namespaced(client.clone(), namespace);
    let ing = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = ing.spec.clone().unwrap_or_default();
    let mut props = Properties::default();

    // Resolve every referenced Service/Secret once, not once per rule: an Ingress
    // routinely points many paths at the same backend.
    let svc_api: Api<Service> = Api::namespaced(client.clone(), namespace);
    let sec_api: Api<Secret> = Api::namespaced(client.clone(), namespace);
    let mut svc_exists: BTreeMap<String, bool> = BTreeMap::new();
    let mut sec_exists: BTreeMap<String, bool> = BTreeMap::new();

    let backends = spec
        .rules
        .iter()
        .flatten()
        .flat_map(|r| r.http.iter().flat_map(|h| h.paths.iter()))
        .filter_map(|p| p.backend.service.as_ref())
        .chain(spec.default_backend.iter().filter_map(|b| b.service.as_ref()))
        .map(|b| b.name.clone())
        .filter(|n| !n.is_empty())
        .collect::<std::collections::BTreeSet<_>>();
    for n in backends {
        let ok = svc_api.get_metadata(&n).await.is_ok();
        svc_exists.insert(n, ok);
    }
    for t in spec.tls.iter().flatten() {
        if let Some(s) = t.secret_name.clone().filter(|s| !s.is_empty()) {
            let ok = sec_api.get_metadata(&s).await.is_ok();
            sec_exists.insert(s, ok);
        }
    }

    // ---- overview ----
    let class = spec.ingress_class_name.clone().unwrap_or_else(|| DASH.into());
    let default_backend = spec
        .default_backend
        .as_ref()
        .and_then(|b| b.service.as_ref())
        .map(|b| b.name.clone())
        .unwrap_or_else(|| DASH.into());
    // Where the controller is actually answering, from status.
    let address = ing
        .status
        .as_ref()
        .and_then(|s| s.load_balancer.as_ref())
        .and_then(|lb| lb.ingress.as_ref())
        .map(|items| {
            items
                .iter()
                .filter_map(|i| i.ip.clone().or_else(|| i.hostname.clone()))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .filter(|a| !a.is_empty())
        .unwrap_or_else(|| DASH.into());

    props.fields(
        "Overview",
        vec![
            nav_field(
                "class",
                class.clone(),
                (class != DASH).then(|| NavTarget::cluster("ingressclasses", class.clone())),
            ),
            nav_field(
                "default backend",
                default_backend.clone(),
                (default_backend != DASH)
                    .then(|| NavTarget::namespaced("services", namespace, default_backend.clone())),
            ),
            field("address", address),
        ],
    );

    // ---- rules ----
    let mut rule_rows: Vec<Vec<Cell>> = Vec::new();
    for rule in spec.rules.iter().flatten() {
        // No host is a catch-all, which kubectl prints as "*".
        let host = rule.host.clone().filter(|h| !h.is_empty()).unwrap_or_else(|| "*".into());
        for path in rule.http.iter().flat_map(|h| h.paths.iter()) {
            let svc = path.backend.service.as_ref();
            let svc_name = svc.map(|b| b.name.clone()).unwrap_or_else(|| DASH.into());
            let exists = svc_exists.get(&svc_name).copied().unwrap_or(false);
            rule_rows.push(vec![
                name_cell(host.clone()),
                c(path.path.clone().unwrap_or_else(|| "/".into())),
                c(path.path_type.clone()),
                ref_cell(
                    &svc_name,
                    exists,
                    NavTarget::namespaced("services", namespace, svc_name.clone()),
                ),
                c(backend_port(svc.and_then(|b| b.port.as_ref()))),
            ]);
        }
    }
    props.push_table(
        "Rules",
        Some("no rules — this Ingress routes nothing"),
        &["HOST", "PATH", "PATH TYPE", "SERVICE", "PORT"],
        rule_rows,
    );

    // ---- tls ----
    let tls_rows: Vec<Vec<Cell>> = spec
        .tls
        .iter()
        .flatten()
        .map(|t| {
            let secret = t.secret_name.clone().unwrap_or_else(|| DASH.into());
            let exists = sec_exists.get(&secret).copied().unwrap_or(false);
            vec![
                name_cell(
                    t.hosts
                        .as_ref()
                        .map(|h| h.join(", "))
                        .filter(|h| !h.is_empty())
                        .unwrap_or_else(|| "*".into()),
                ),
                ref_cell(
                    &secret,
                    exists,
                    NavTarget::namespaced("secrets", namespace, secret.clone()),
                ),
            ]
        })
        .collect();
    props.push_table("TLS", Some("no TLS — served over HTTP"), &["HOSTS", "SECRET"], tls_rows);

    meta_sections(&mut props, &ing);
    Ok(props)
}

// ---------------------------------------------------------------------------
// Helm releases (B35)
// ---------------------------------------------------------------------------

/// Properties for a Helm release: an Overview, the full revision History, and the
/// user-supplied Values.
///
/// Every revision is its own `helm.sh/release.v1` Secret (B26). Where the table
/// keeps only the newest via `latest_only`, this is the inverse view: it decodes
/// *all* of a release's revision Secrets — found by Helm's own `owner=helm,name=…`
/// labels — to reconstruct the history. Still zero writes.
async fn gather_helm(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<Secret> = Api::namespaced(client, namespace);
    // Helm labels every release Secret with owner + release name; filtering here
    // avoids decoding every Secret in the namespace.
    let lp = ListParams::default().labels(&format!("owner=helm,name={name}"));
    let secrets = api.list(&lp).await.map_err(|e| AppError::Kube(e.to_string()))?;

    let releases: Vec<helm::Release> =
        secrets.items.iter().filter_map(helm::decode_release).collect();
    if releases.is_empty() {
        return Err(AppError::NotFound(format!("no Helm release {name} in {namespace}")));
    }
    Ok(build_helm_properties(releases))
}

/// Build the release document from its decoded revisions (pure, so the ordering
/// and toning are testable without a cluster). Newest revision leads the Overview
/// and the History.
fn build_helm_properties(mut releases: Vec<helm::Release>) -> Properties {
    // Newest revision first — the current release leads, history follows.
    releases.sort_by_key(|r| std::cmp::Reverse(r.revision));
    let current = &releases[0];

    let mut props = Properties::default();

    // ---- overview (from the current revision) ----
    props.fields(
        "Overview",
        vec![
            field("chart", current.chart.clone()),
            field("app version", current.app_version.clone()),
            field_toned("status", current.status.clone(), helm::status_tone(&current.status)),
            field("revision", current.revision.to_string()),
            Field {
                label: "first deployed".into(),
                value: Cell::age(Some(current.first_deployed.clone()).filter(|s| !s.is_empty())),
                nav: None,
            },
            Field {
                label: "last deployed".into(),
                value: Cell::age(Some(current.updated.clone()).filter(|s| !s.is_empty())),
                nav: None,
            },
            field("description", current.description.clone()),
        ],
    );

    // ---- history (every revision, newest first) ----
    let rows: Vec<Vec<Cell>> = releases
        .iter()
        .map(|r| {
            vec![
                name_cell(r.revision.to_string()),
                Cell::status(r.status.clone(), helm::status_tone(&r.status)),
                c(r.chart.clone()),
                c(r.description.clone()),
                Cell::age(Some(r.updated.clone()).filter(|s| !s.is_empty())),
            ]
        })
        .collect();
    props.push_table(
        "History",
        Some("no revisions"),
        &["REVISION", "STATUS", "CHART", "DESCRIPTION", "UPDATED"],
        rows,
    );

    // ---- values (user overrides, redacted, flattened) ----
    let value_rows: Vec<Vec<Cell>> = helm::flatten_values(&current.config)
        .into_iter()
        .map(|(k, v)| vec![name_cell(k), c(v)])
        .collect();
    props.push_table(
        "Values",
        // An empty config isn't missing data — the release runs on the chart's
        // own defaults, which is worth saying rather than showing a blank table.
        Some("chart defaults (no overrides)"),
        &["KEY", "VALUE"],
        value_rows,
    );

    props
}

// ---------------------------------------------------------------------------
// Pods (B13)
// ---------------------------------------------------------------------------

async fn gather_pod(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let pods: Api<Pod> = Api::namespaced(client.clone(), namespace);
    let pod = pods.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;

    let spec = pod.spec.clone().unwrap_or_default();
    let status = pod.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    // ---- overview ----
    // The owner is a click-through link (B33); a ReplicaSet owner resolves through
    // to its Deployment, since that's the workload the user means and we don't list
    // ReplicaSets as a kind.
    let (owner_text, owner_nav) = resolve_owner(&client, namespace, &pod).await;

    props.fields(
        "Overview",
        vec![
            nav_field(
                "node",
                or_dash(spec.node_name.clone()),
                // Nodes are cluster-scoped, so no namespace on the target.
                spec.node_name.clone().filter(|n| !n.is_empty()).map(|n| NavTarget::cluster("nodes", n)),
            ),
            field("pod IP", or_dash(status.pod_ip.clone())),
            field("host IP", or_dash(status.host_ip.clone())),
            field("QoS", or_dash(status.qos_class.clone())),
            nav_field("owner", owner_text, owner_nav),
            nav_field(
                "service account",
                or_dash(spec.service_account_name.clone()),
                spec.service_account_name
                    .clone()
                    .filter(|s| !s.is_empty())
                    .map(|s| NavTarget::namespaced("serviceaccounts", namespace, s)),
            ),
            field("restart policy", or_dash(spec.restart_policy.clone())),
            field("priority class", or_dash(spec.priority_class_name.clone())),
            Field {
                label: "started".into(),
                value: match status.start_time.as_ref() {
                    Some(t) => Cell::age(Some(t.0.to_rfc3339())),
                    None => muted(DASH),
                },
                nav: None,
            },
        ],
    );

    // ---- containers ----
    let statuses = status.container_statuses.clone().unwrap_or_default();
    let rows = spec
        .containers
        .iter()
        .map(|ct| {
            let cs = statuses.iter().find(|s| s.name == ct.name);
            let state = cs
                .and_then(|s| s.state.as_ref())
                .map(|st| {
                    if st.running.is_some() {
                        "Running".to_string()
                    } else if let Some(w) = &st.waiting {
                        format!("Waiting: {}", w.reason.clone().unwrap_or_default())
                    } else if let Some(t) = &st.terminated {
                        format!("Terminated: {}", t.reason.clone().unwrap_or_default())
                    } else {
                        "Unknown".to_string()
                    }
                })
                .unwrap_or_else(|| "Unknown".into());
            let state_tone = if state.starts_with("Running") {
                Tone::Good
            } else if state.starts_with("Waiting") {
                Tone::Warn
            } else if state.starts_with("Terminated") {
                Tone::Bad
            } else {
                Tone::Secondary
            };

            // "request / limit" per resource.
            let (cpu, memory) = match &ct.resources {
                Some(r) => {
                    let fmt = |key: &str| {
                        let req = r.requests.as_ref().and_then(|m| m.get(key)).map(|q| q.0.clone());
                        let lim = r.limits.as_ref().and_then(|m| m.get(key)).map(|q| q.0.clone());
                        match (&req, &lim) {
                            (None, None) => DASH.to_string(),
                            _ => format!(
                                "{} / {}",
                                req.unwrap_or_else(|| DASH.into()),
                                lim.unwrap_or_else(|| DASH.into())
                            ),
                        }
                    };
                    (fmt("cpu"), fmt("memory"))
                }
                None => (DASH.to_string(), DASH.to_string()),
            };

            let ports = ct
                .ports
                .as_ref()
                .map(|ps| {
                    ps.iter()
                        .map(|p| {
                            format!(
                                "{}/{}",
                                p.container_port,
                                p.protocol.clone().unwrap_or_else(|| "TCP".into())
                            )
                        })
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| DASH.into());

            let ready = cs.map(|s| s.ready).unwrap_or(false);
            let restarts = cs.map(|s| s.restart_count).unwrap_or(0);
            vec![
                name_cell(ct.name.clone()),
                c(ct.image.clone().unwrap_or_else(|| DASH.into())),
                Cell::new(state, state_tone),
                Cell::new(if ready { "yes" } else { "no" }, if ready { Tone::Good } else { Tone::Warn }),
                Cell::new(
                    restarts.to_string(),
                    if restarts > 5 { Tone::Bad } else { Tone::Secondary },
                ),
                c(cpu),
                c(memory),
                c(ports),
            ]
        })
        .collect();
    props.push_table(
        "Containers",
        Some("no containers"),
        &["NAME", "IMAGE", "STATE", "READY", "RESTARTS", "CPU R/L", "MEM R/L", "PORTS"],
        rows,
    );

    // ---- volumes (resolving PVC → PV) ----
    let volumes = gather_volumes(&client, namespace, &spec).await;
    let (pvc_vols, other_vols): (Vec<_>, Vec<_>) = volumes.into_iter().partition(|v| v.kind == "PVC");

    props.push_table(
        "Storage",
        Some("no persistent volumes attached"),
        &["VOLUME", "CLAIM", "PV", "CAPACITY", "CLASS", "ACCESS", "PHASE", "MOUNTED AT"],
        pvc_vols
            .iter()
            .map(|v| {
                vec![
                    name_cell(v.name.clone()),
                    // The claim, its volume and its class are all listed kinds
                    // now, so each cell links through (B40). `Cell::link` drops
                    // the link when the value is an em dash — an unbound claim
                    // has no PV to go to.
                    Cell::link(
                        v.claim.clone(),
                        Tone::Secondary,
                        Some(NavTarget::namespaced("persistentvolumeclaims", namespace, v.claim.clone())),
                    ),
                    Cell::link(
                        v.pv.clone(),
                        Tone::Secondary,
                        Some(NavTarget::cluster("persistentvolumes", v.pv.clone())),
                    ),
                    c(v.capacity.clone()),
                    Cell::link(
                        v.storage_class.clone(),
                        Tone::Secondary,
                        Some(NavTarget::cluster("storageclasses", v.storage_class.clone())),
                    ),
                    c(v.access_modes.clone()),
                    Cell::new(
                        v.phase.clone(),
                        if v.phase == "Bound" { Tone::Good } else { Tone::Warn },
                    ),
                    c(mount_text(v)),
                ]
            })
            .collect(),
    );

    // ---- services selecting this pod ----
    let services = gather_services(&client, namespace, pod.metadata.labels.as_ref()).await;
    props.push_table(
        "Services",
        Some("no services select this pod"),
        &["NAME", "TYPE", "CLUSTER-IP", "PORTS"],
        services,
    );

    // Config/secret/projected volumes: interesting, but not worth a section of
    // their own when there are none.
    props.push_table(
        "Other volumes",
        None,
        &["VOLUME", "KIND", "SOURCE", "MOUNTED AT"],
        other_vols
            .iter()
            .map(|v| {
                vec![
                    name_cell(v.name.clone()),
                    c(v.kind.clone()),
                    if v.source_missing {
                        // The mount is empty; that's the answer to "why is this
                        // config not applying", so it's worth colouring.
                        Cell::new(format!("{} (not found)", v.source), Tone::Warn)
                    } else {
                        Cell::link(v.source.clone(), Tone::Secondary, v.source_nav.clone())
                    },
                    c(mount_text(v)),
                ]
            })
            .collect(),
    );

    meta_sections(&mut props, &pod);
    Ok(props)
}

/// A volume attached to a pod; PVC-backed ones carry resolved claim/PV details.
struct VolumeInfo {
    name: String,
    kind: String,
    mount_paths: String,
    read_only: bool,
    claim: String,
    pv: String,
    capacity: String,
    storage_class: String,
    access_modes: String,
    phase: String,
    /// For a ConfigMap/Secret-backed volume, the object it mounts, and a link to
    /// it. The classification alone ("Secret") doesn't say *which* Secret, which
    /// is the thing you opened the panel to find out.
    source: String,
    source_nav: Option<NavTarget>,
    /// The referenced ConfigMap/Secret doesn't exist. Legal — a volume source can
    /// be `optional: true` — but worth saying, because the mount is then empty.
    source_missing: bool,
}

/// "/data, /var/lib (ro)".
fn mount_text(v: &VolumeInfo) -> String {
    if v.read_only {
        format!("{} (ro)", v.mount_paths)
    } else {
        v.mount_paths.clone()
    }
}

/// Build the volume list, resolving PVC → PV where possible (best-effort).
async fn gather_volumes(
    client: &Client,
    namespace: &str,
    spec: &k8s_openapi::api::core::v1::PodSpec,
) -> Vec<VolumeInfo> {
    let pvcs: Api<PersistentVolumeClaim> = Api::namespaced(client.clone(), namespace);
    let pvs: Api<PersistentVolume> = Api::all(client.clone());

    let mut out = Vec::new();
    for v in spec.volumes.iter().flatten() {
        // Where do containers mount this volume?
        let mut mounts: Vec<String> = Vec::new();
        let mut read_only = false;
        for ct in &spec.containers {
            for m in ct.volume_mounts.iter().flatten() {
                if m.name == v.name {
                    mounts.push(m.mount_path.clone());
                    read_only |= m.read_only.unwrap_or(false);
                }
            }
        }
        let mount_paths = if mounts.is_empty() { DASH.to_string() } else { mounts.join(", ") };

        let (source, source_nav) = volume_source(v, namespace);
        let mut info = VolumeInfo {
            name: v.name.clone(),
            kind: volume_kind(v).to_string(),
            mount_paths,
            read_only,
            claim: String::new(),
            pv: String::new(),
            capacity: String::new(),
            storage_class: String::new(),
            access_modes: String::new(),
            phase: String::new(),
            source,
            source_nav,
            source_missing: false,
        };

        // A volume source may be `optional: true` and simply not exist (Argo's
        // repo-server declares a TLS Secret that's only created if you enable
        // TLS). Linking to it would be a link to a 404 — worse than the plain
        // text it replaced — so confirm it's there first. `get_metadata` is used
        // deliberately: an existence check must not pull a Secret's contents.
        if let Some(nav) = info.source_nav.clone() {
            let exists = match nav.kind.as_str() {
                "configmaps" => {
                    let api: Api<ConfigMap> = Api::namespaced(client.clone(), namespace);
                    api.get_metadata(&nav.name).await.is_ok()
                }
                "secrets" => {
                    let api: Api<Secret> = Api::namespaced(client.clone(), namespace);
                    api.get_metadata(&nav.name).await.is_ok()
                }
                _ => true,
            };
            if !exists {
                info.source_missing = true;
                info.source_nav = None;
            }
        }

        // Resolve PVC-backed volumes.
        if let Some(src) = &v.persistent_volume_claim {
            info.claim = src.claim_name.clone();
            if let Ok(pvc) = pvcs.get(&src.claim_name).await {
                let pvc_spec = pvc.spec.clone().unwrap_or_default();
                let pvc_status = pvc.status.clone().unwrap_or_default();
                info.phase = or_dash(pvc_status.phase.clone());
                info.storage_class = or_dash(pvc_spec.storage_class_name.clone());
                info.access_modes = pvc_spec
                    .access_modes
                    .map(|a| a.join(", "))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| DASH.into());
                // Capacity: prefer the bound status, fall back to the request.
                info.capacity = pvc_status
                    .capacity
                    .as_ref()
                    .and_then(|cap| cap.get("storage"))
                    .map(|q| q.0.clone())
                    .or_else(|| {
                        pvc_spec
                            .resources
                            .as_ref()
                            .and_then(|r| r.requests.as_ref())
                            .and_then(|r| r.get("storage"))
                            .map(|q| q.0.clone())
                    })
                    .unwrap_or_else(|| DASH.into());
                // Bound PV.
                if let Some(pv_name) = pvc_spec.volume_name.filter(|n| !n.is_empty()) {
                    info.pv = pv_name.clone();
                    // PV capacity is authoritative when present.
                    if let Ok(pv) = pvs.get(&pv_name).await {
                        if let Some(cap) = pv
                            .spec
                            .as_ref()
                            .and_then(|s| s.capacity.as_ref())
                            .and_then(|cap| cap.get("storage"))
                        {
                            info.capacity = cap.0.clone();
                        }
                    }
                } else {
                    info.pv = DASH.into();
                }
            } else {
                // PVC unreadable (deleted or RBAC): show what we know.
                info.phase = DASH.into();
                info.pv = DASH.into();
                info.capacity = DASH.into();
                info.storage_class = DASH.into();
                info.access_modes = DASH.into();
            }
        }

        out.push(info);
    }
    out
}

/// The source detail behind a volume: *which* object, host path, or NFS export it
/// mounts. `volume_kind` only classifies ("ConfigMap", "HostPath", "NFS"), which
/// leaves the panel saying a pod mounts *a* HostPath without saying which — and
/// that path is the thing you opened the panel to find.
///
/// ConfigMap/Secret sources are listed kinds, so they link through (B40); the rest
/// (a host directory, an NFS server, a CSI driver) aren't cluster objects, so they
/// are shown as plain text with no nav target.
fn volume_source(
    v: &k8s_openapi::api::core::v1::Volume,
    namespace: &str,
) -> (String, Option<NavTarget>) {
    if let Some(name) = v
        .config_map
        .as_ref()
        .map(|cm| cm.name.clone())
        .filter(|n| !n.is_empty())
    {
        let nav = NavTarget::namespaced("configmaps", namespace, name.clone());
        return (name, Some(nav));
    }
    if let Some(name) = v
        .secret
        .as_ref()
        .and_then(|s| s.secret_name.clone())
        .filter(|n| !n.is_empty())
    {
        let nav = NavTarget::namespaced("secrets", namespace, name.clone());
        return (name, Some(nav));
    }
    // A hostPath mounts a directory on the node — the path is the whole point.
    if let Some(hp) = v.host_path.as_ref().filter(|hp| !hp.path.is_empty()) {
        return (hp.path.clone(), None);
    }
    // An NFS mount is identified by "server:/export", as `mount` writes it.
    if let Some(nfs) = v.nfs.as_ref() {
        if !nfs.server.is_empty() || !nfs.path.is_empty() {
            return (format!("{}:{}", nfs.server, nfs.path), None);
        }
    }
    // A CSI ephemeral volume: the driver is what says who backs it.
    if let Some(csi) = v.csi.as_ref().filter(|csi| !csi.driver.is_empty()) {
        return (csi.driver.clone(), None);
    }
    (DASH.to_string(), None)
}

/// Classify a volume by its source.
fn volume_kind(v: &k8s_openapi::api::core::v1::Volume) -> &'static str {
    if v.persistent_volume_claim.is_some() {
        "PVC"
    } else if v.config_map.is_some() {
        "ConfigMap"
    } else if v.secret.is_some() {
        "Secret"
    } else if v.empty_dir.is_some() {
        "EmptyDir"
    } else if v.host_path.is_some() {
        "HostPath"
    } else if v.projected.is_some() {
        "Projected"
    } else if v.downward_api.is_some() {
        "DownwardAPI"
    } else if v.nfs.is_some() {
        "NFS"
    } else if v.csi.is_some() {
        "CSI"
    } else {
        "Other"
    }
}

/// Services in the namespace whose selector matches the pod's labels.
async fn gather_services(
    client: &Client,
    namespace: &str,
    pod_labels: Option<&BTreeMap<String, String>>,
) -> Vec<Vec<Cell>> {
    let Some(labels) = pod_labels else {
        return Vec::new();
    };
    let svcs: Api<Service> = Api::namespaced(client.clone(), namespace);
    let list = match svcs.list(&ListParams::default()).await {
        Ok(l) => l,
        Err(_) => return Vec::new(), // RBAC or transient: degrade to empty
    };

    list.items
        .into_iter()
        .filter_map(|s| {
            let spec = s.spec.as_ref()?;
            let selector = spec.selector.as_ref()?;
            // A service selects this pod when every selector entry matches a label.
            if selector.is_empty()
                || !selector.iter().all(|(k, v)| labels.get(k).map(|lv| lv == v).unwrap_or(false))
            {
                return None;
            }
            let name = s.metadata.name.clone().unwrap_or_default();
            Some(vec![
                Cell::link(
                    name.clone(),
                    Tone::Primary,
                    Some(NavTarget::namespaced("services", namespace, name)),
                ),
                c(spec.type_.clone().unwrap_or_else(|| "ClusterIP".into())),
                c(or_dash(spec.cluster_ip.clone())),
                c(service_ports_text(spec)),
            ])
        })
        .collect()
}

/// "8080/TCP, 443/TCP" for a service spec.
fn service_ports_text(spec: &k8s_openapi::api::core::v1::ServiceSpec) -> String {
    spec.ports
        .as_ref()
        .map(|ps| {
            ps.iter()
                .map(|p| format!("{}/{}", p.port, p.protocol.clone().unwrap_or_else(|| "TCP".into())))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| DASH.into())
}

// ---------------------------------------------------------------------------
// Deployments (B18)
// ---------------------------------------------------------------------------

async fn gather_deployment(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<Deployment> = Api::namespaced(client.clone(), namespace);
    let dep = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = dep.spec.clone().unwrap_or_default();
    let status = dep.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    let desired = spec.replicas.unwrap_or(1);
    let ready = status.ready_replicas.unwrap_or(0);

    // Rollout strategy, with the surge/unavailable knobs that actually govern it.
    let strategy = spec
        .strategy
        .as_ref()
        .map(|s| {
            let type_ = s.type_.clone().unwrap_or_else(|| "RollingUpdate".into());
            match &s.rolling_update {
                Some(ru) => {
                    let surge = ru.max_surge.as_ref().map(int_or_string).unwrap_or_else(|| "—".into());
                    let unavail =
                        ru.max_unavailable.as_ref().map(int_or_string).unwrap_or_else(|| "—".into());
                    format!("{type_} (max surge {surge}, max unavailable {unavail})")
                }
                None => type_,
            }
        })
        .unwrap_or_else(|| DASH.into());

    props.fields(
        "Overview",
        vec![
            field_toned("replicas", format!("{ready}/{desired} ready"), ready_tone(ready, desired)),
            field("up-to-date", status.updated_replicas.unwrap_or(0).to_string()),
            field("available", status.available_replicas.unwrap_or(0).to_string()),
            field_toned(
                "unavailable",
                status.unavailable_replicas.unwrap_or(0).to_string(),
                if status.unavailable_replicas.unwrap_or(0) > 0 { Tone::Warn } else { Tone::Secondary },
            ),
            field("strategy", strategy),
            field("selector", selector_text(spec.selector.match_labels.as_ref())),
            field("generation", dep.metadata.generation.unwrap_or(0).to_string()),
            field_toned(
                "paused",
                if spec.paused.unwrap_or(false) { "yes" } else { "no" },
                if spec.paused.unwrap_or(false) { Tone::Warn } else { Tone::Secondary },
            ),
        ],
    );

    // ---- owned ReplicaSets ----
    // Ownership is by uid, not name: a deleted-and-recreated Deployment reuses the
    // name, and matching on it would adopt the old generation's ReplicaSets.
    let rs_rows = match Api::<ReplicaSet>::namespaced(client.clone(), namespace)
        .list(&ListParams::default())
        .await
    {
        Ok(list) => {
            let mut owned: Vec<ReplicaSet> = list
                .items
                .into_iter()
                .filter(|rs| {
                    rs.metadata
                        .owner_references
                        .iter()
                        .flatten()
                        .any(|o| Some(&o.uid) == dep.metadata.uid.as_ref())
                })
                .collect();
            // Newest revision first — that's the one being rolled out.
            owned.sort_by_key(|rs| std::cmp::Reverse(revision_of(rs)));
            owned
                .iter()
                .map(|rs| {
                    let s = rs.status.clone().unwrap_or_default();
                    let want = rs.spec.as_ref().and_then(|sp| sp.replicas).unwrap_or(0);
                    let rs_ready = s.ready_replicas.unwrap_or(0);
                    vec![
                        // ReplicaSets are a listed kind now (B40), so a revision
                        // row opens the generation it names.
                        Cell::link(
                            rs.name_any(),
                            Tone::Primary,
                            Some(NavTarget::namespaced("replicasets", namespace, rs.name_any())),
                        ),
                        c(revision_of(rs).map(|r| r.to_string()).unwrap_or_else(|| DASH.into())),
                        c(want.to_string()),
                        c(s.replicas.to_string()),
                        Cell::new(rs_ready.to_string(), ready_tone(rs_ready, want)),
                        Cell::age(rs.creation_timestamp().map(|t| t.0.to_rfc3339())),
                    ]
                })
                .collect()
        }
        Err(_) => Vec::new(), // RBAC/transient: degrade to an empty section
    };
    props.push_table(
        "ReplicaSets",
        Some("no replica sets (or none readable)"),
        &["NAME", "REVISION", "DESIRED", "CURRENT", "READY", "AGE"],
        rs_rows,
    );

    conditions_section(
        &mut props,
        status
            .conditions
            .unwrap_or_default()
            .into_iter()
            .map(|cd| Condition {
                type_: cd.type_,
                status: cd.status,
                reason: or_dash(cd.reason),
                message: or_dash(cd.message),
                since: cd.last_transition_time.map(|t| t.0.to_rfc3339()),
            })
            .collect(),
    );

    meta_sections(&mut props, &dep);
    Ok(props)
}

/// A ReplicaSet's rollout revision, from the annotation the Deployment controller
/// stamps on it.
fn revision_of(rs: &ReplicaSet) -> Option<i64> {
    rs.metadata
        .annotations
        .as_ref()
        .and_then(|a| a.get("deployment.kubernetes.io/revision"))
        .and_then(|v| v.parse().ok())
}

/// Render an IntOrString ("25%" or "1").
fn int_or_string(v: &k8s_openapi::apimachinery::pkg::util::intstr::IntOrString) -> String {
    use k8s_openapi::apimachinery::pkg::util::intstr::IntOrString;
    match v {
        IntOrString::Int(i) => i.to_string(),
        IntOrString::String(s) => s.clone(),
    }
}

// ---------------------------------------------------------------------------
// Services (B18)
// ---------------------------------------------------------------------------

async fn gather_service(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<Service> = Api::namespaced(client.clone(), namespace);
    let svc = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = svc.spec.clone().unwrap_or_default();
    let mut props = Properties::default();

    // LoadBalancer ingress addresses, once assigned.
    let lb = svc
        .status
        .as_ref()
        .and_then(|s| s.load_balancer.as_ref())
        .and_then(|lb| lb.ingress.as_ref())
        .map(|ing| {
            ing.iter()
                .filter_map(|i| i.ip.clone().or_else(|| i.hostname.clone()))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DASH.into());

    props.fields(
        "Overview",
        vec![
            field("type", spec.type_.clone().unwrap_or_else(|| "ClusterIP".into())),
            field("cluster IP", or_dash(spec.cluster_ip.clone())),
            field("load balancer", lb),
            field(
                "external IPs",
                spec.external_ips
                    .as_ref()
                    .map(|v| v.join(", "))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| DASH.into()),
            ),
            field("selector", selector_text(spec.selector.as_ref())),
            field("session affinity", or_dash(spec.session_affinity.clone())),
            field("traffic policy", or_dash(spec.external_traffic_policy.clone())),
        ],
    );

    // ---- ports ----
    props.push_table(
        "Ports",
        Some("no ports"),
        &["NAME", "PORT", "TARGET", "NODE PORT", "PROTOCOL"],
        spec.ports
            .iter()
            .flatten()
            .map(|p| {
                vec![
                    name_cell(p.name.clone().unwrap_or_else(|| DASH.into())),
                    c(p.port.to_string()),
                    c(p.target_port.as_ref().map(int_or_string).unwrap_or_else(|| p.port.to_string())),
                    c(p.node_port.map(|n| n.to_string()).unwrap_or_else(|| DASH.into())),
                    c(p.protocol.clone().unwrap_or_else(|| "TCP".into())),
                ]
            })
            .collect(),
    );

    // ---- endpoints ----
    // EndpointSlices, not the legacy Endpoints object: slices are what modern
    // clusters actually populate, and they carry the target pod and node.
    let slices = Api::<EndpointSlice>::namespaced(client, namespace)
        .list(&ListParams::default().labels(&format!("kubernetes.io/service-name={name}")))
        .await;
    let mut ep_rows: Vec<Vec<Cell>> = Vec::new();
    if let Ok(list) = slices {
        for slice in list.items {
            for ep in slice.endpoints {
                let ready = ep.conditions.as_ref().and_then(|c0| c0.ready).unwrap_or(true);
                let target = ep
                    .target_ref
                    .as_ref()
                    .and_then(|t| t.name.clone())
                    .unwrap_or_else(|| DASH.into());
                let node = ep.node_name.clone().unwrap_or_else(|| DASH.into());
                for addr in &ep.addresses {
                    ep_rows.push(vec![
                        name_cell(addr.clone()),
                        Cell::new(
                            if ready { "ready" } else { "not ready" },
                            if ready { Tone::Good } else { Tone::Warn },
                        ),
                        // "which pod is actually serving this, and where" is the
                        // question this table answers, so both open (B41).
                        Cell::link(
                            target.clone(),
                            Tone::Secondary,
                            Some(NavTarget::namespaced("pods", namespace, target.clone())),
                        ),
                        Cell::link(
                            node.clone(),
                            Tone::Secondary,
                            Some(NavTarget::cluster("nodes", node.clone())),
                        ),
                    ]);
                }
            }
        }
    }
    props.push_table(
        "Endpoints",
        Some("no endpoints — nothing is backing this service"),
        &["ADDRESS", "READY", "POD", "NODE"],
        ep_rows,
    );

    meta_sections(&mut props, &svc);
    Ok(props)
}

// ---------------------------------------------------------------------------
// StatefulSets (B18)
// ---------------------------------------------------------------------------

async fn gather_statefulset(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<StatefulSet> = Api::namespaced(client.clone(), namespace);
    let sts = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = sts.spec.clone().unwrap_or_default();
    let status = sts.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    // The governing headless Service is what gives the pods stable DNS.
    // `serviceName` is a required field but *not* a guarantee the Service exists
    // — Argo's application-controller names one that was never created — so
    // verify before linking, the same rule the volume sources follow. A missing
    // one is worth flagging rather than quietly linking nowhere: without it the
    // pods' DNS names don't resolve.
    let svc_name = spec.service_name.clone();
    let svc_exists = !svc_name.is_empty()
        && Api::<Service>::namespaced(client.clone(), namespace)
            .get_metadata(&svc_name)
            .await
            .is_ok();
    let service_field = match (svc_name.is_empty(), svc_exists) {
        (true, _) => field("service name", DASH),
        (false, true) => nav_field(
            "service name",
            svc_name.clone(),
            Some(NavTarget::namespaced("services", namespace, svc_name.clone())),
        ),
        (false, false) => {
            field_toned("service name", format!("{svc_name} (not found)"), Tone::Warn)
        }
    };

    let desired = spec.replicas.unwrap_or(1);
    let ready = status.ready_replicas.unwrap_or(0);

    props.fields(
        "Overview",
        vec![
            field_toned("replicas", format!("{ready}/{desired} ready"), ready_tone(ready, desired)),
            field("current", status.current_replicas.unwrap_or(0).to_string()),
            field("updated", status.updated_replicas.unwrap_or(0).to_string()),
            service_field,
            field(
                "update strategy",
                spec.update_strategy
                    .as_ref()
                    .and_then(|u| u.type_.clone())
                    .unwrap_or_else(|| DASH.into()),
            ),
            field("pod management", or_dash(spec.pod_management_policy.clone())),
            field("selector", selector_text(spec.selector.match_labels.as_ref())),
            field("current revision", or_dash(status.current_revision.clone())),
        ],
    );

    // ---- volume claim templates ----
    let templates = spec.volume_claim_templates.clone().unwrap_or_default();
    props.push_table(
        "Volume claim templates",
        None,
        &["NAME", "CLASS", "ACCESS", "REQUEST"],
        templates
            .iter()
            .map(|t| {
                let ts = t.spec.clone().unwrap_or_default();
                let class = or_dash(ts.storage_class_name.clone());
                vec![
                    // The template itself isn't an object you can open — only the
                    // class it provisions from is.
                    name_cell(t.metadata.name.clone().unwrap_or_default()),
                    Cell::link(
                        class.clone(),
                        Tone::Secondary,
                        Some(NavTarget::cluster("storageclasses", class)),
                    ),
                    c(ts
                        .access_modes
                        .as_ref()
                        .map(|a| a.join(", "))
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| DASH.into())),
                    c(qty(ts
                        .resources
                        .as_ref()
                        .and_then(|r| r.requests.as_ref())
                        .and_then(|r| r.get("storage")))),
                ]
            })
            .collect(),
    );

    // ---- the PVCs those templates actually produced ----
    // StatefulSet PVCs are named "<template>-<statefulset>-<ordinal>" by the
    // controller; that convention is the only link back (they carry no owner ref
    // to the StatefulSet).
    if !templates.is_empty() {
        let prefixes: Vec<String> = templates
            .iter()
            .filter_map(|t| t.metadata.name.clone())
            .map(|n| format!("{n}-{name}-"))
            .collect();
        let pvc_rows = match Api::<PersistentVolumeClaim>::namespaced(client, namespace)
            .list(&ListParams::default())
            .await
        {
            Ok(list) => {
                let mut claims: Vec<PersistentVolumeClaim> = list
                    .items
                    .into_iter()
                    .filter(|p| {
                        let n = p.name_any();
                        prefixes.iter().any(|pre| n.starts_with(pre.as_str()))
                    })
                    .collect();
                claims.sort_by_key(|a| a.name_any());
                claims
                    .iter()
                    .map(|p| {
                        let ps = p.spec.clone().unwrap_or_default();
                        let pst = p.status.clone().unwrap_or_default();
                        let phase = or_dash(pst.phase.clone());
                        let class = or_dash(ps.storage_class_name.clone());
                        let volume = or_dash(ps.volume_name.clone());
                        vec![
                            // A StatefulSet's storage is the one panel where every
                            // reference used to dead-end (B41).
                            Cell::link(
                                p.name_any(),
                                Tone::Primary,
                                Some(NavTarget::namespaced(
                                    "persistentvolumeclaims",
                                    namespace,
                                    p.name_any(),
                                )),
                            ),
                            Cell::new(
                                phase.clone(),
                                if phase == "Bound" { Tone::Good } else { Tone::Warn },
                            ),
                            c(qty(pst.capacity.as_ref().and_then(|cap| cap.get("storage")))),
                            Cell::link(
                                class.clone(),
                                Tone::Secondary,
                                Some(NavTarget::cluster("storageclasses", class)),
                            ),
                            Cell::link(
                                volume.clone(),
                                Tone::Secondary,
                                Some(NavTarget::cluster("persistentvolumes", volume)),
                            ),
                            Cell::age(p.creation_timestamp().map(|t| t.0.to_rfc3339())),
                        ]
                    })
                    .collect()
            }
            Err(_) => Vec::new(),
        };
        props.push_table(
            "Persistent volume claims",
            Some("no claims yet"),
            &["NAME", "PHASE", "CAPACITY", "CLASS", "PV", "AGE"],
            pvc_rows,
        );
    }

    conditions_section(
        &mut props,
        status
            .conditions
            .unwrap_or_default()
            .into_iter()
            .map(|cd| Condition {
                type_: cd.type_,
                status: cd.status,
                reason: or_dash(cd.reason),
                message: or_dash(cd.message),
                since: cd.last_transition_time.map(|t| t.0.to_rfc3339()),
            })
            .collect(),
    );

    meta_sections(&mut props, &sts);
    Ok(props)
}

// ---------------------------------------------------------------------------
// Nodes (B18)
// ---------------------------------------------------------------------------

async fn gather_node(client: Client, name: &str) -> AppResult<Properties> {
    let api: Api<Node> = Api::all(client);
    let node = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = node.spec.clone().unwrap_or_default();
    let status = node.status.clone().unwrap_or_default();
    let info = status.node_info.clone();
    let mut props = Properties::default();

    let unschedulable = spec.unschedulable.unwrap_or(false);
    props.fields(
        "Overview",
        vec![
            field_toned(
                "schedulable",
                if unschedulable { "no (cordoned)" } else { "yes" },
                if unschedulable { Tone::Warn } else { Tone::Good },
            ),
            field("kubelet", info.as_ref().map(|i| i.kubelet_version.clone()).unwrap_or_else(|| DASH.into())),
            field("runtime", info.as_ref().map(|i| i.container_runtime_version.clone()).unwrap_or_else(|| DASH.into())),
            field("OS image", info.as_ref().map(|i| i.os_image.clone()).unwrap_or_else(|| DASH.into())),
            field("kernel", info.as_ref().map(|i| i.kernel_version.clone()).unwrap_or_else(|| DASH.into())),
            field("architecture", info.as_ref().map(|i| i.architecture.clone()).unwrap_or_else(|| DASH.into())),
            field("pod CIDR", or_dash(spec.pod_cidr.clone())),
            field("provider", or_dash(spec.provider_id.clone())),
        ],
    );

    // ---- capacity vs allocatable ----
    // Allocatable is capacity minus what the kubelet reserves for the system, so
    // it — not capacity — is what pods can actually request.
    let capacity = status.capacity.clone().unwrap_or_default();
    let allocatable = status.allocatable.clone().unwrap_or_default();
    // Union of both maps: extended resources (GPUs) may appear in only one.
    let mut resource_names: Vec<&String> = capacity.keys().chain(allocatable.keys()).collect();
    resource_names.sort();
    resource_names.dedup();
    props.push_table(
        "Capacity",
        Some("not reported"),
        &["RESOURCE", "CAPACITY", "ALLOCATABLE"],
        resource_names
            .iter()
            .map(|r| {
                vec![
                    name_cell((*r).clone()),
                    c(qty(capacity.get(*r))),
                    c(qty(allocatable.get(*r))),
                ]
            })
            .collect(),
    );

    conditions_section(
        &mut props,
        status
            .conditions
            .unwrap_or_default()
            .into_iter()
            .map(|cd| Condition {
                type_: cd.type_,
                status: cd.status,
                reason: or_dash(cd.reason),
                message: or_dash(cd.message),
                since: cd.last_transition_time.map(|t| t.0.to_rfc3339()),
            })
            .collect(),
    );

    // ---- taints ----
    props.push_table(
        "Taints",
        Some("no taints"),
        &["KEY", "VALUE", "EFFECT"],
        spec.taints
            .iter()
            .flatten()
            .map(|t| {
                vec![
                    name_cell(t.key.clone()),
                    c(or_dash(t.value.clone())),
                    // NoSchedule/NoExecute actively keep pods off; worth the amber.
                    Cell::new(t.effect.clone(), Tone::Warn),
                ]
            })
            .collect(),
    );

    // ---- addresses ----
    props.push_table(
        "Addresses",
        Some("no addresses"),
        &["TYPE", "ADDRESS"],
        status
            .addresses
            .iter()
            .flatten()
            .map(|a| vec![name_cell(a.type_.clone()), c(a.address.clone())])
            .collect(),
    );

    meta_sections(&mut props, &node);
    Ok(props)
}

// ---------------------------------------------------------------------------
// ConfigMaps (B18-ish) — the question is "what keys does this carry, and
// how big". A user hunting a misconfigured ConfigMap wants the key list
// and the values side-by-side, so the YAML view stays a fallback.
// ---------------------------------------------------------------------------

async fn gather_configmap(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<ConfigMap> = Api::namespaced(client, namespace);
    let cm = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let data = cm.data.as_ref();
    let binary = cm.binary_data.as_ref();
    let mut props = Properties::default();

    let data_count = data.map(|m| m.len()).unwrap_or(0);
    let binary_count = binary.map(|m| m.len()).unwrap_or(0);
    let immutable = cm.immutable.unwrap_or(false);
    props.fields(
        "Overview",
        vec![
            field("data keys", data_count.to_string()),
            field("binary keys", binary_count.to_string()),
            field_toned(
                "immutable",
                if immutable { "yes" } else { "no" },
                if immutable { Tone::Good } else { Tone::Secondary },
            ),
        ],
    );

    // ---- data ----
    // The two maps are mutually exclusive at the key level (the apiserver
    // rejects overlap), but a single ConfigMap can have keys in both, so we
    // show them as two tables rather than collapsing.
    props.push_table(
        "Data",
        Some("no data keys"),
        &["KEY", "VALUE"],
        data.iter()
            .flat_map(|m| m.iter())
            .map(|(k, v)| vec![name_cell(k.clone()), c(v.clone())])
            .collect(),
    );
    props.push_table(
        "Binary data",
        Some("no binary keys"),
        &["KEY", "BYTES"],
        binary
            .iter()
            .flat_map(|m| m.iter())
            .map(|(k, v)| {
                // ByteString derefs to &[u8] for length; printing a count is
                // far more useful than dumping base64 of a TLS cert.
                vec![name_cell(k.clone()), c(format!("{} bytes", v.0.len()))]
            })
            .collect(),
    );

    meta_sections(&mut props, &cm);
    Ok(props)
}

// ---------------------------------------------------------------------------
// Secrets — same shape as ConfigMaps, but every value is redacted. Showing
// the base64 of `data` is the same kind of leak the YAML view guards
// against; the tab is for "what keys are in here, and how big", not the
// contents themselves. (kubectl get -o yaml still works for users with
// the right RBAC — we just don't widen the surface area in the UI.)
// ---------------------------------------------------------------------------

async fn gather_secret(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<Secret> = Api::namespaced(client, namespace);
    let sec = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let data = sec.data.as_ref();
    let string_data = sec.string_data.as_ref();
    let mut props = Properties::default();

    let data_count = data.map(|m| m.len()).unwrap_or(0);
    let string_count = string_data.map(|m| m.len()).unwrap_or(0);
    let immutable = sec.immutable.unwrap_or(false);
    props.fields(
        "Overview",
        vec![
            field("type", or_dash(sec.type_.clone())),
            field("data keys", data_count.to_string()),
            field("stringData keys", string_count.to_string()),
            field_toned(
                "immutable",
                if immutable { "yes" } else { "no" },
                if immutable { Tone::Good } else { Tone::Secondary },
            ),
        ],
    );

    // ---- data ----
    // Redact values: only key + byte count, never the contents. Length is
    // useful (a 4096-byte tls.crt is the same shape as 32-byte one, and
    // the user can tell which keys are unexpectedly large).
    props.push_table(
        "Data",
        Some("no data keys"),
        &["KEY", "BYTES"],
        data.iter()
            .flat_map(|m| m.iter())
            .map(|(k, v)| vec![name_cell(k.clone()), c(format!("{} bytes", v.0.len()))])
            .collect(),
    );
    // stringData is write-only on the apiserver (it's never echoed back on
    // GET), so this table is almost always empty — but if it does come
    // through (some custom resources or shims), we'd still want to redact.
    props.push_table(
        "stringData",
        Some("no stringData keys"),
        &["KEY", "BYTES"],
        string_data
            .iter()
            .flat_map(|m| m.iter())
            .map(|(k, v)| vec![name_cell(k.clone()), c(format!("{} bytes", v.len()))])
            .collect(),
    );

    meta_sections(&mut props, &sec);
    Ok(props)
}

// ---------------------------------------------------------------------------
// Namespaces — a thin "what is it" view. The cluster-scoped equivalent of
// labels-on-anything: phase, the well-known status flags, and a name
// column for the labels people actually use to organise their clusters.
// ---------------------------------------------------------------------------

async fn gather_namespace(client: Client, name: &str) -> AppResult<Properties> {
    let api: Api<Namespace> = Api::all(client);
    let ns = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let status = ns.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    // Phase is the headline: Active is the only "normal" state, anything
    // else is a reason to look closer. Terminating in particular is the
    // common one — a stuck finalizer, etc.
    let phase = status.phase.clone().unwrap_or_else(|| DASH.into());
    let phase_tone = match phase.as_str() {
        "Active" => Tone::Good,
        "Terminating" => Tone::Warn,
        _ => Tone::Secondary,
    };
    let label_count = ns
        .metadata
        .labels
        .as_ref()
        .map(|m| m.len())
        .unwrap_or(0);
    props.fields(
        "Overview",
        vec![
            field_toned("phase", phase, phase_tone),
            field("labels", label_count.to_string()),
        ],
    );

    meta_sections(&mut props, &ns);
    Ok(props)
}

// ---------------------------------------------------------------------------
// StorageClasses — provisioner + reclaim policy are the two questions that
// actually matter; the rest is "what knobs does it expose", and that lives
// in the parameters table.
// ---------------------------------------------------------------------------

async fn gather_storageclass(client: Client, name: &str) -> AppResult<Properties> {
    let api: Api<StorageClass> = Api::all(client);
    let sc = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let mut props = Properties::default();

    let allow_expand = sc.allow_volume_expansion.unwrap_or(false);
    props.fields(
        "Overview",
        vec![
            field("provisioner", sc.provisioner.clone()),
            field(
                "reclaim policy",
                sc.reclaim_policy.clone().unwrap_or_else(|| DASH.into()),
            ),
            field(
                "volume binding",
                sc.volume_binding_mode
                    .clone()
                    .unwrap_or_else(|| "Immediate".into()),
            ),
            field_toned(
                "allow expansion",
                if allow_expand { "yes" } else { "no" },
                if allow_expand { Tone::Good } else { Tone::Secondary },
            ),
        ],
    );

    // ---- parameters ----
    props.push_table(
        "Parameters",
        Some("no parameters"),
        &["KEY", "VALUE"],
        sc.parameters
            .iter()
            .flatten()
            .map(|(k, v)| vec![name_cell(k.clone()), c(v.clone())])
            .collect(),
    );

    // ---- mount options ----
    props.push_table(
        "Mount options",
        Some("no mount options"),
        &["OPTION"],
        sc.mount_options
            .iter()
            .flatten()
            .map(|m| vec![c(m.clone())])
            .collect(),
    );

    meta_sections(&mut props, &sc);
    Ok(props)
}

// ---------------------------------------------------------------------------
// ServiceAccounts — the two lists (imagePullSecrets and Secrets) are the
// whole story: what registries this SA can pull from, and what secrets a
// pod using it can mount. automount is the toggle that trips people up most.
// ---------------------------------------------------------------------------

async fn gather_serviceaccount(
    client: Client,
    namespace: &str,
    name: &str,
) -> AppResult<Properties> {
    let api: Api<ServiceAccount> = Api::namespaced(client, namespace);
    let sa = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let mut props = Properties::default();

    let ips_count = sa.image_pull_secrets.as_ref().map(|v| v.len()).unwrap_or(0);
    let sec_count = sa.secrets.as_ref().map(|v| v.len()).unwrap_or(0);
    // `automountServiceAccountToken` is a tri-state: unset means "default"
    // (which is true unless the pod opts out). Showing the literal field
    // is the honest answer — kubectl does the same.
    let automount = match sa.automount_service_account_token {
        Some(true) => "true",
        Some(false) => "false",
        None => "(default)",
    };
    props.fields(
        "Overview",
        vec![
            field("automount token", automount),
            field("image pull secrets", ips_count.to_string()),
            field("secrets", sec_count.to_string()),
        ],
    );

    // ---- image pull secrets ----
    props.push_table(
        "Image pull secrets",
        Some("no image pull secrets"),
        &["NAME"],
        sa.image_pull_secrets
            .iter()
            .flat_map(|v| v.iter())
            // `LocalObjectReference.name` is a bare String (not Option), but
            // the apiserver allows empty values for backwards-compat — show
            // a dash so the row isn't blank.
            .map(|r| {
                vec![name_cell(
                    if r.name.is_empty() { DASH.into() } else { r.name.clone() },
                )]
            })
            .collect(),
    );

    // ---- secrets ----
    props.push_table(
        "Secrets",
        Some("no secrets"),
        &["NAME"],
        sa.secrets
            .iter()
            .flat_map(|v| v.iter())
            .map(|r| vec![name_cell(r.name.clone().unwrap_or_else(|| DASH.into()))])
            .collect(),
    );

    meta_sections(&mut props, &sa);
    Ok(props)
}

// ---------------------------------------------------------------------------
// PersistentVolumeClaims (storage)
// ---------------------------------------------------------------------------

async fn gather_pvc(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<PersistentVolumeClaim> = Api::namespaced(client.clone(), namespace);
    let pvc = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = pvc.spec.clone().unwrap_or_default();
    let status = pvc.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    let phase = or_dash(status.phase.clone());
    let phase_tone = match phase.as_str() {
        "Bound" => Tone::Good,
        "Pending" => Tone::Warn,
        "Lost" => Tone::Bad,
        _ => Tone::Secondary,
    };
    let volume = or_dash(spec.volume_name.clone());
    let class = or_dash(spec.storage_class_name.clone());
    let access_modes = spec
        .access_modes
        .as_ref()
        .map(|a| a.join(", "))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DASH.into());
    let capacity = status
        .capacity
        .as_ref()
        .and_then(|cap| cap.get("storage"))
        .map(|q| q.0.clone())
        .or_else(|| {
            spec.resources
                .as_ref()
                .and_then(|r| r.requests.as_ref())
                .and_then(|r| r.get("storage"))
                .map(|q| q.0.clone())
        })
        .unwrap_or_else(|| DASH.into());

    props.fields(
        "Overview",
        vec![
            field_toned("phase", phase, phase_tone),
            nav_field(
                "volume",
                volume.clone(),
                (volume != DASH).then(|| NavTarget::cluster("persistentvolumes", volume)),
            ),
            nav_field(
                "storage class",
                class.clone(),
                (class != DASH).then(|| NavTarget::cluster("storageclasses", class)),
            ),
            field("access modes", access_modes),
            field("capacity", capacity),
            field("volume mode", or_dash(spec.volume_mode.clone())),
        ],
    );

    // ---- conditions ----
    conditions_section(
        &mut props,
        status
            .conditions
            .unwrap_or_default()
            .into_iter()
            .map(|cd| Condition {
                type_: cd.type_,
                status: cd.status,
                reason: or_dash(cd.reason),
                message: or_dash(cd.message),
                since: cd.last_transition_time.map(|t| t.0.to_rfc3339()),
            })
            .collect(),
    );

    meta_sections(&mut props, &pvc);
    Ok(props)
}

// ---------------------------------------------------------------------------
// PersistentVolumes (storage)
// ---------------------------------------------------------------------------

async fn gather_pv(client: Client, name: &str) -> AppResult<Properties> {
    let api: Api<PersistentVolume> = Api::all(client);
    let pv = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = pv.spec.clone().unwrap_or_default();
    let status = pv.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    let phase = or_dash(status.phase.clone());
    let phase_tone = match phase.as_str() {
        "Bound" => Tone::Good,
        "Available" => Tone::Good,
        "Pending" => Tone::Warn,
        "Released" => Tone::Warn,
        "Failed" => Tone::Bad,
        _ => Tone::Secondary,
    };
    let class = or_dash(spec.storage_class_name.clone());
    let capacity = spec
        .capacity
        .as_ref()
        .and_then(|cap| cap.get("storage"))
        .map(|q| q.0.clone())
        .unwrap_or_else(|| DASH.into());
    let access_modes = spec
        .access_modes
        .as_ref()
        .map(|a| a.iter().map(|m| format!("{m:?}")).collect::<Vec<_>>().join(", "))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DASH.into());
    let reclaim = spec.persistent_volume_reclaim_policy.clone().unwrap_or_else(|| DASH.into());
    let claim_ref = spec.claim_ref.as_ref();
    let claim_ns = claim_ref.and_then(|c| c.namespace.clone());
    let claim_name = claim_ref.map(|c| c.name.clone().unwrap_or_default()).unwrap_or_default();

    props.fields(
        "Overview",
        vec![
            field_toned("phase", phase, phase_tone),
            nav_field(
                "storage class",
                class.clone(),
                (class != DASH).then(|| NavTarget::cluster("storageclasses", class)),
            ),
            field("capacity", capacity),
            field("access modes", access_modes),
            field("reclaim policy", reclaim),
            field("volume mode", or_dash(spec.volume_mode.clone())),
            nav_field(
                "claim",
                if claim_name.is_empty() { DASH.into() } else { format!("{}/{}", claim_ns.as_deref().unwrap_or(""), claim_name) },
                if claim_name.is_empty() {
                    None
                } else {
                    Some(NavTarget::namespaced(
                        "persistentvolumeclaims",
                        claim_ns.as_deref().unwrap_or(""),
                        claim_name,
                    ))
                },
            ),
        ],
    );

    // ---- source ----
    let source_text = if let Some(local) = &spec.local {
        format!("local: {}", local.path)
    } else if let Some(host) = &spec.host_path {
        format!("hostPath: {}", host.path)
    } else if let Some(nfs) = &spec.nfs {
        format!("nfs: {}:{}", nfs.server, nfs.path)
    } else if spec.csi.is_some() {
        "CSI".into()
    } else {
        DASH.into()
    };
    props.fields("Source", vec![field("type", source_text)]);

    meta_sections(&mut props, &pv);
    Ok(props)
}

// ---------------------------------------------------------------------------
// Jobs (workloads)
// ---------------------------------------------------------------------------

async fn gather_job(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<Job> = Api::namespaced(client.clone(), namespace);
    let job = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = job.spec.clone().unwrap_or_default();
    let status = job.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    let completions = spec.completions.unwrap_or(1);
    let succeeded = status.succeeded.unwrap_or(0);
    let failed = status.failed.unwrap_or(0);
    let completion_tone = if succeeded >= completions {
        Tone::Good
    } else if failed > 0 {
        Tone::Bad
    } else {
        Tone::Warn
    };

    // Check if this Job is owned by a CronJob.
    let cronjob_ref = job
        .metadata
        .owner_references
        .as_ref()
        .and_then(|refs| refs.iter().find(|r| r.controller == Some(true) && r.kind == "CronJob"));

    props.fields(
        "Overview",
        vec![
            field_toned(
                "completions",
                format!("{succeeded}/{completions} completed"),
                completion_tone,
            ),
            field("parallelism", spec.parallelism.unwrap_or(1).to_string()),
            field("backoff limit", spec.backoff_limit.unwrap_or(6).to_string()),
            field("failed", failed.to_string()),
            nav_field(
                "cronjob",
                cronjob_ref.map(|r| r.name.clone()).unwrap_or_else(|| DASH.into()),
                cronjob_ref.map(|r| NavTarget::namespaced("cronjobs", namespace, r.name.clone())),
            ),
        ],
    );

    // ---- conditions ----
    conditions_section(
        &mut props,
        status
            .conditions
            .unwrap_or_default()
            .into_iter()
            .map(|cd| Condition {
                type_: cd.type_,
                status: cd.status,
                reason: or_dash(cd.reason),
                message: or_dash(cd.message),
                since: cd.last_transition_time.map(|t| t.0.to_rfc3339()),
            })
            .collect(),
    );

    meta_sections(&mut props, &job);
    Ok(props)
}

// ---------------------------------------------------------------------------
// CronJobs (workloads)
// ---------------------------------------------------------------------------

async fn gather_cronjob(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<CronJob> = Api::namespaced(client.clone(), namespace);
    let cj = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = cj.spec.clone().unwrap_or_default();
    let status = cj.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    let suspend = spec.suspend.unwrap_or(false);
    props.fields(
        "Overview",
        vec![
            field("schedule", spec.schedule.clone()),
            field("concurrency policy", spec.concurrency_policy.clone().unwrap_or_else(|| "Allow".into())),
            field("suspend", if suspend { "yes" } else { "no" }),
            field("successful jobs", spec.successful_jobs_history_limit.map(|n| n.to_string()).unwrap_or_else(|| DASH.into())),
            field("failed jobs", spec.failed_jobs_history_limit.map(|n| n.to_string()).unwrap_or_else(|| DASH.into())),
            field("starting deadline", spec.starting_deadline_seconds.map(|n| format!("{n}s")).unwrap_or_else(|| DASH.into())),
            Field {
                label: "last schedule".into(),
                value: Cell::age(status.last_schedule_time.map(|t| t.0.to_rfc3339())),
                nav: None,
            },
        ],
    );

    // ---- recent jobs owned by this CronJob ----
    let job_api: Api<Job> = Api::namespaced(client, namespace);
    let job_rows = match job_api.list(&ListParams::default()).await {
        Ok(list) => {
            let mut owned: Vec<Job> = list
                .items
                .into_iter()
                .filter(|j| {
                    j.metadata
                        .owner_references
                        .iter()
                        .flatten()
                        .any(|o| o.kind == "CronJob" && o.name == name)
                })
                .collect();
            owned.sort_by_key(|j| {
                std::cmp::Reverse(
                    j.status
                        .as_ref()
                        .and_then(|s| s.completion_time.as_ref())
                        .or_else(|| j.status.as_ref().and_then(|s| s.start_time.as_ref()))
                        .map(|t| t.0.to_rfc3339())
                        .unwrap_or_default(),
                )
            });
            owned
                .iter()
                .map(|j| {
                    let s = j.status.clone().unwrap_or_default();
                    let succeeded = s.succeeded.unwrap_or(0);
                    let failed = s.failed.unwrap_or(0);
                    let (status_text, status_tone) = if succeeded > 0 {
                        ("Complete", Tone::Good)
                    } else if failed > 0 {
                        ("Failed", Tone::Bad)
                    } else {
                        ("Running", Tone::Warn)
                    };
                    vec![
                        Cell::link(
                            j.name_any(),
                            Tone::Primary,
                            Some(NavTarget::namespaced("jobs", namespace, j.name_any())),
                        ),
                        Cell::new(status_text, status_tone),
                        Cell::age(
                            s.completion_time
                                .as_ref()
                                .or_else(|| s.start_time.as_ref())
                                .map(|t| t.0.to_rfc3339()),
                        ),
                    ]
                })
                .collect()
        }
        Err(_) => Vec::new(),
    };
    props.push_table(
        "Jobs",
        Some("no jobs yet"),
        &["NAME", "STATUS", "AGE"],
        job_rows,
    );

    meta_sections(&mut props, &cj);
    Ok(props)
}

// ---------------------------------------------------------------------------
// HorizontalPodAutoscalers (workloads)
// ---------------------------------------------------------------------------

async fn gather_hpa(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<HorizontalPodAutoscaler> = Api::namespaced(client, namespace);
    let hpa = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = hpa.spec.clone().unwrap_or_default();
    let status = hpa.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    let target = spec.scale_target_ref;
    let target_kind = target.kind.clone();
    let target_name = target.name.clone();
    let target_nav = builtin_nav_id(&target_kind).map(|nav_id| {
        let ns = (nav_id != "nodes").then(|| namespace.to_string());
        NavTarget { kind: nav_id.into(), namespace: ns, name: target_name.clone() }
    });

    props.fields(
        "Overview",
        vec![
            nav_field(
                "target",
                format!("{target_kind}/{target_name}"),
                target_nav,
            ),
            field("min replicas", spec.min_replicas.map(|n| n.to_string()).unwrap_or_else(|| DASH.into())),
            field("max replicas", spec.max_replicas.to_string()),
            field(
                "current replicas",
                status.current_replicas.map(|n| n.to_string()).unwrap_or_else(|| DASH.into()),
            ),
            field("desired replicas", status.desired_replicas.to_string()),
        ],
    );

    // ---- metrics ----
    let metric_rows: Vec<Vec<Cell>> = status
        .current_metrics
        .iter()
        .flatten()
        .enumerate()
        .map(|(_i, m)| {
            let type_ = m.type_.clone();
            let (resource_name, current, target_val) = match &m.resource {
                Some(r) => {
                    let name = r.name.clone();
                    let current = r.current.average_utilization
                        .map(|v| format!("{v}%"))
                        .or_else(|| r.current.average_value.as_ref().map(|q| q.0.clone()))
                        .or_else(|| r.current.value.as_ref().map(|q| q.0.clone()))
                        .unwrap_or_else(|| DASH.into());
                    (name, current, DASH.to_string())
                }
                None => (DASH.into(), DASH.into(), DASH.into()),
            };
            vec![
                c(format!("{type_}/{resource_name}")),
                c(current),
                c(target_val),
            ]
        })
        .collect();
    props.push_table(
        "Metrics",
        Some("no metrics configured"),
        &["METRIC", "CURRENT", "TARGET"],
        metric_rows,
    );

    // ---- conditions ----
    conditions_section(
        &mut props,
        status
            .conditions
            .unwrap_or_default()
            .into_iter()
            .map(|cd| Condition {
                type_: cd.type_,
                status: cd.status,
                reason: or_dash(cd.reason),
                message: or_dash(cd.message),
                since: cd.last_transition_time.map(|t| t.0.to_rfc3339()),
            })
            .collect(),
    );

    meta_sections(&mut props, &hpa);
    Ok(props)
}

// ---------------------------------------------------------------------------
// NetworkPolicies (network)
// ---------------------------------------------------------------------------

async fn gather_networkpolicy(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<NetworkPolicy> = Api::namespaced(client.clone(), namespace);
    let np = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = np.spec.clone().unwrap_or_default();
    let mut props = Properties::default();

    let policy_types_str = spec
        .policy_types
        .as_ref()
        .map(|v| v.join(", "))
        .unwrap_or_default();

    let pod_sel = spec
        .pod_selector
        .match_labels
        .as_ref()
        .map(|m| selector_text(Some(m)))
        .unwrap_or_else(|| DASH.into());

    props.fields(
        "Overview",
        vec![
            field("pod selector", pod_sel),
            field("policy types", if policy_types_str.is_empty() { DASH.into() } else { policy_types_str }),
        ],
    );

    // ---- pods selected by this policy ----
    // List the pods whose labels match the policy's podSelector. When the
    // selector is empty (matchLabels: {}), the policy selects ALL pods in the
    // namespace — listing them is the most useful thing the panel can do.
    let pod_api: Api<Pod> = Api::namespaced(client.clone(), namespace);
    let selector_match = spec.pod_selector.match_labels.as_ref();
    let lp = match selector_match {
        Some(m) if !m.is_empty() => {
            let label_str = m.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join(",");
            ListParams::default().labels(&label_str)
        }
        _ => ListParams::default(), // empty selector matches all pods
    };
    let pod_rows: Vec<Vec<Cell>> = match pod_api.list(&lp).await {
        Ok(list) => list
            .items
            .iter()
            .map(|p| {
                let pod_name = p.name_any();
                let phase = p
                    .status
                    .as_ref()
                    .and_then(|s| s.phase.clone())
                    .unwrap_or_else(|| DASH.into());
                let phase_tone = match phase.as_str() {
                    "Running" => Tone::Good,
                    "Pending" => Tone::Warn,
                    "Succeeded" | "Failed" => Tone::Muted,
                    _ => Tone::Secondary,
                };
                vec![
                    Cell::link(
                        pod_name.clone(),
                        Tone::Primary,
                        Some(NavTarget::namespaced("pods", namespace, pod_name)),
                    ),
                    Cell::new(phase, phase_tone),
                    Cell::age(p.creation_timestamp().map(|t| t.0.to_rfc3339())),
                ]
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    props.push_table(
        "Selected pods",
        Some("no pods match this selector"),
        &["NAME", "STATUS", "AGE"],
        pod_rows,
    );

    // ---- ingress rules ----
    // Each peer is shown as a cell with nav links where possible: a namespace
    // selector with `kubernetes.io/metadata.name` links directly to that
    // namespace.
    let ingress_rows: Vec<Vec<Cell>> = spec
        .ingress
        .iter()
        .flatten()
        .flat_map(|rule| {
            let froms = rule.from.iter().flatten().map(|from| {
                let (peer_text, peer_nav) = if let Some(pod) = &from.pod_selector {
                    (format!("pod: {}", selector_text(pod.match_labels.as_ref())), None)
                } else if let Some(ns) = &from.namespace_selector {
                    // If the selector targets a specific namespace by metadata.name,
                    // link directly to it.
                    let ns_name = ns
                        .match_labels
                        .as_ref()
                        .and_then(|m| m.get("kubernetes.io/metadata.name"))
                        .cloned();
                    let text = format!("ns: {}", selector_text(ns.match_labels.as_ref()));
                    let nav = ns_name
                        .filter(|n| !n.is_empty())
                        .map(|n| NavTarget::cluster("namespaces", n));
                    (text, nav)
                } else if let Some(cidr) = &from.ip_block {
                    let except = cidr
                        .except
                        .as_ref()
                        .map(|e| format!(" (except {})", e.join(", ")))
                        .unwrap_or_default();
                    (format!("cidr: {}{}", cidr.cidr, except), None)
                } else {
                    (DASH.into(), None)
                };
                let ports = rule
                    .ports
                    .iter()
                    .flatten()
                    .map(|p| {
                        format!(
                            "{}/{}",
                            p.port.as_ref().map(int_or_string).unwrap_or_else(|| "*".into()),
                            p.protocol.clone().unwrap_or_else(|| "TCP".into())
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                let from_cell = match peer_nav {
                    Some(nav) => Cell::link(peer_text, Tone::Secondary, Some(nav)),
                    None => c(peer_text),
                };
                vec![from_cell, c(if ports.is_empty() { DASH.into() } else { ports })]
            });
            froms.collect::<Vec<_>>()
        })
        .collect();
    props.push_table(
        "Ingress rules",
        Some("no ingress rules"),
        &["FROM", "PORTS"],
        ingress_rows,
    );

    // ---- egress rules ----
    let egress_rows: Vec<Vec<Cell>> = spec
        .egress
        .iter()
        .flatten()
        .flat_map(|rule| {
            let tos = rule.to.iter().flatten().map(|to| {
                let (peer_text, peer_nav) = if let Some(pod) = &to.pod_selector {
                    (format!("pod: {}", selector_text(pod.match_labels.as_ref())), None)
                } else if let Some(ns) = &to.namespace_selector {
                    let ns_name = ns
                        .match_labels
                        .as_ref()
                        .and_then(|m| m.get("kubernetes.io/metadata.name"))
                        .cloned();
                    let text = format!("ns: {}", selector_text(ns.match_labels.as_ref()));
                    let nav = ns_name
                        .filter(|n| !n.is_empty())
                        .map(|n| NavTarget::cluster("namespaces", n));
                    (text, nav)
                } else if let Some(cidr) = &to.ip_block {
                    let except = cidr
                        .except
                        .as_ref()
                        .map(|e| format!(" (except {})", e.join(", ")))
                        .unwrap_or_default();
                    (format!("cidr: {}{}", cidr.cidr, except), None)
                } else {
                    (DASH.into(), None)
                };
                let ports = rule
                    .ports
                    .iter()
                    .flatten()
                    .map(|p| {
                        format!(
                            "{}/{}",
                            p.port.as_ref().map(int_or_string).unwrap_or_else(|| "*".into()),
                            p.protocol.clone().unwrap_or_else(|| "TCP".into())
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                let to_cell = match peer_nav {
                    Some(nav) => Cell::link(peer_text, Tone::Secondary, Some(nav)),
                    None => c(peer_text),
                };
                vec![to_cell, c(if ports.is_empty() { DASH.into() } else { ports })]
            });
            tos.collect::<Vec<_>>()
        })
        .collect();
    props.push_table(
        "Egress rules",
        Some("no egress rules"),
        &["TO", "PORTS"],
        egress_rows,
    );

    meta_sections(&mut props, &np);
    Ok(props)
}

// ---------------------------------------------------------------------------
// ResourceQuotas (config)
// ---------------------------------------------------------------------------

async fn gather_resourcequota(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<ResourceQuota> = Api::namespaced(client, namespace);
    let rq = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = rq.spec.clone().unwrap_or_default();
    let status = rq.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    let scopes = spec
        .scopes
        .iter()
        .flatten()
        .map(|s| s.clone())
        .collect::<Vec<_>>()
        .join(", ");
    let scope_selector = spec
        .scope_selector
        .as_ref()
        .and_then(|sel| {
            let exprs: Vec<String> = sel
                .match_expressions
                .iter()
                .flatten()
                .map(|e| format!("{} {} {}", e.scope_name, e.operator, e.values.iter().flatten().cloned().collect::<Vec<_>>().join(",")))
                .collect();
            if exprs.is_empty() { None } else { Some(exprs.join("; ")) }
        })
        .unwrap_or_else(|| DASH.into());

    props.fields(
        "Overview",
        vec![
            field("scopes", if scopes.is_empty() { DASH.into() } else { scopes }),
            field("scope selector", scope_selector),
        ],
    );

    // ---- hard vs used ----
    let hard = spec.hard.as_ref();
    let used = status.used.as_ref();
    // Union of both maps.
    let mut resource_names: Vec<&String> = hard
        .map(|m| m.keys().collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .chain(used.map(|m| m.keys().collect::<Vec<_>>()).unwrap_or_default().into_iter())
        .collect();
    resource_names.sort();
    resource_names.dedup();

    let quota_rows: Vec<Vec<Cell>> = resource_names
        .iter()
        .map(|r| {
            let hard_val = hard.and_then(|m| m.get(*r)).map(|q| q.0.clone()).unwrap_or_else(|| DASH.into());
            let used_val = used.and_then(|m| m.get(*r)).map(|q| q.0.clone()).unwrap_or_else(|| DASH.into());
            // Tone: warn when usage is >= 80% of hard limit (if parseable).
            let tone = match (used_val.parse::<f64>(), hard_val.parse::<f64>()) {
                (Ok(u), Ok(h)) if h > 0.0 && u / h >= 0.8 => Tone::Warn,
                _ => Tone::Secondary,
            };
            vec![
                name_cell((*r).clone()),
                c(hard_val),
                Cell::new(used_val, tone),
            ]
        })
        .collect();
    props.push_table(
        "Quotas",
        Some("no quota resources"),
        &["RESOURCE", "HARD", "USED"],
        quota_rows,
    );

    meta_sections(&mut props, &rq);
    Ok(props)
}

// ---------------------------------------------------------------------------
// Roles / ClusterRoles (RBAC)
// ---------------------------------------------------------------------------

async fn gather_role(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<Role> = Api::namespaced(client, namespace);
    let role = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let mut props = Properties::default();

    props.fields(
        "Overview",
        vec![
            field("name", role.metadata.name.clone().unwrap_or_else(|| DASH.into())),
        ],
    );

    let rule_rows: Vec<Vec<Cell>> = role
        .rules
        .iter()
        .flatten()
        .map(|r| {
            vec![
                c(r.verbs.join(", ")),
                c(r.api_groups.iter().flatten().cloned().collect::<Vec<_>>().join(", ")),
                c(r.resources.iter().flatten().cloned().collect::<Vec<_>>().join(", ")),
                c(r.resource_names.iter().flatten().cloned().collect::<Vec<_>>().join(", ")),
            ]
        })
        .collect();
    props.push_table(
        "Rules",
        Some("no rules"),
        &["VERBS", "API GROUPS", "RESOURCES", "RESOURCE NAMES"],
        rule_rows,
    );

    meta_sections(&mut props, &role);
    Ok(props)
}

async fn gather_clusterrole(client: Client, name: &str) -> AppResult<Properties> {
    let api: Api<ClusterRole> = Api::all(client);
    let role = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let mut props = Properties::default();

    props.fields(
        "Overview",
        vec![
            field("name", role.metadata.name.clone().unwrap_or_else(|| DASH.into())),
            field("aggregation", role
                .aggregation_rule
                .as_ref()
                .and_then(|ar| ar.cluster_role_selectors.as_ref())
                .map(|sels| {
                    sels.iter()
                        .map(|s| selector_text(s.match_labels.as_ref()))
                        .collect::<Vec<_>>()
                        .join("; ")
                })
                .unwrap_or_else(|| DASH.into())),
        ],
    );

    let rule_rows: Vec<Vec<Cell>> = role
        .rules
        .iter()
        .flatten()
        .map(|r| {
            vec![
                c(r.verbs.join(", ")),
                c(r.api_groups.iter().flatten().cloned().collect::<Vec<_>>().join(", ")),
                c(r.resources.iter().flatten().cloned().collect::<Vec<_>>().join(", ")),
                c(r.resource_names.iter().flatten().cloned().collect::<Vec<_>>().join(", ")),
            ]
        })
        .collect();
    props.push_table(
        "Rules",
        Some("no rules"),
        &["VERBS", "API GROUPS", "RESOURCES", "RESOURCE NAMES"],
        rule_rows,
    );

    meta_sections(&mut props, &role);
    Ok(props)
}

// ---------------------------------------------------------------------------
// RoleBindings / ClusterRoleBindings (RBAC)
// ---------------------------------------------------------------------------

async fn gather_rolebinding(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<RoleBinding> = Api::namespaced(client.clone(), namespace);
    let rb = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let binding_ns = namespace;
    let mut props = Properties::default();

    let role_nav = match rb.role_ref.kind.as_str() {
        "Role" => Some(NavTarget::namespaced("roles", binding_ns, rb.role_ref.name.clone())),
        "ClusterRole" => Some(NavTarget::cluster("clusterroles", rb.role_ref.name.clone())),
        _ => None,
    };

    props.fields(
        "Overview",
        vec![
            field("name", rb.metadata.name.clone().unwrap_or_else(|| DASH.into())),
            nav_field(
                "role",
                format!("{}/{}", rb.role_ref.kind, rb.role_ref.name),
                role_nav,
            ),
        ],
    );

    let subject_rows: Vec<Vec<Cell>> = rb
        .subjects
        .iter()
        .flatten()
        .map(|s| {
            let kind = s.kind.clone();
            let ns = s.namespace.clone().unwrap_or_default();
            let name = s.name.clone();
            let nav = if kind == "ServiceAccount" {
                Some(NavTarget::namespaced(
                    "serviceaccounts",
                    if ns.is_empty() { binding_ns } else { &ns },
                    name.clone(),
                ))
            } else {
                None
            };
            vec![
                c(kind),
                Cell::link(name, Tone::Secondary, nav),
                c(if ns.is_empty() { DASH.into() } else { ns }),
            ]
        })
        .collect();
    props.push_table(
        "Subjects",
        Some("no subjects"),
        &["KIND", "NAME", "NAMESPACE"],
        subject_rows,
    );

    meta_sections(&mut props, &rb);
    Ok(props)
}

async fn gather_clusterrolebinding(client: Client, name: &str) -> AppResult<Properties> {
    let api: Api<ClusterRoleBinding> = Api::all(client);
    let crb = api.get(name).await.map_err(|e| AppError::Kube(e.to_string()))?;
    let mut props = Properties::default();

    let role_nav = match crb.role_ref.kind.as_str() {
        "ClusterRole" => Some(NavTarget::cluster("clusterroles", crb.role_ref.name.clone())),
        // A ClusterRoleBinding can technically reference a Role, but that's unusual.
        _ => None,
    };

    props.fields(
        "Overview",
        vec![
            field("name", crb.metadata.name.clone().unwrap_or_else(|| DASH.into())),
            nav_field(
                "role",
                format!("{}/{}", crb.role_ref.kind, crb.role_ref.name),
                role_nav,
            ),
        ],
    );

    let subject_rows: Vec<Vec<Cell>> = crb
        .subjects
        .iter()
        .flatten()
        .map(|s| {
            let kind = s.kind.clone();
            let ns = s.namespace.clone().unwrap_or_default();
            let name = s.name.clone();
            let nav = if kind == "ServiceAccount" {
                Some(NavTarget::namespaced(
                    "serviceaccounts",
                    &ns,
                    name.clone(),
                ))
            } else {
                None
            };
            vec![
                c(kind),
                Cell::link(name, Tone::Secondary, nav),
                c(if ns.is_empty() { DASH.into() } else { ns }),
            ]
        })
        .collect();
    props.push_table(
        "Subjects",
        Some("no subjects"),
        &["KIND", "NAME", "NAMESPACE"],
        subject_rows,
    );

    meta_sections(&mut props, &crb);
    Ok(props)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ready/Available read green when True; the same status on a pressure
    /// condition reads red, because those inverted types mean the opposite.
    #[test]
    fn condition_polarity_is_per_type() {
        assert_eq!(condition_tone("Ready", "True"), Tone::Good);
        assert_eq!(condition_tone("Ready", "False"), Tone::Bad);
        assert_eq!(condition_tone("Available", "True"), Tone::Good);
        // A node under memory pressure is unhealthy, not healthy.
        assert_eq!(condition_tone("MemoryPressure", "True"), Tone::Bad);
        assert_eq!(condition_tone("MemoryPressure", "False"), Tone::Good);
        assert_eq!(condition_tone("DiskPressure", "True"), Tone::Bad);
        assert_eq!(condition_tone("ReplicaFailure", "True"), Tone::Bad);
    }

    /// An unreported condition ("Unknown") is a warning either way.
    #[test]
    fn unknown_condition_is_a_warning() {
        assert_eq!(condition_tone("Ready", "Unknown"), Tone::Warn);
        assert_eq!(condition_tone("MemoryPressure", "Unknown"), Tone::Warn);
    }

    /// Helm history (B35): revisions decoded in any order render newest-first,
    /// the current revision's status leads the Overview, superseded rows read
    /// muted and the current deployed row reads ok, and values are redacted.
    #[test]
    fn helm_history_orders_and_tones() {
        let rel = |revision: i64, status: &str| helm::Release {
            name: "redis".into(),
            namespace: "prod".into(),
            chart: "redis-1.2.3".into(),
            app_version: "7.2".into(),
            revision,
            status: status.into(),
            updated: format!("2026-06-0{revision}T00:00:00Z"),
            first_deployed: "2026-06-01T00:00:00Z".into(),
            description: "Upgrade complete".into(),
            config: serde_json::json!({ "auth": { "password": "hunter2" }, "replicas": 3 }),
            manifest: String::new(),
        };
        // Deliberately unsorted input: v1, v3, v2.
        let props = build_helm_properties(vec![
            rel(1, "superseded"),
            rel(3, "deployed"),
            rel(2, "superseded"),
        ]);

        // Overview leads with the current (highest) revision.
        let overview = match &props.sections[0].body {
            Body::Fields { fields } => fields,
            _ => panic!("first section is the Overview grid"),
        };
        let status = overview.iter().find(|f| f.label == "status").unwrap();
        assert_eq!(status.value.text, "deployed");
        assert_eq!(status.value.tone, Tone::Good, "current deployed reads ok");
        let revision = overview.iter().find(|f| f.label == "revision").unwrap();
        assert_eq!(revision.value.text, "3");

        // History is newest-first, with the right per-row toning.
        let history = props.sections.iter().find(|s| s.title == "History").unwrap();
        let rows = match &history.body {
            Body::Table { rows, .. } => rows,
            _ => panic!("History is a table"),
        };
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0][0].text, "3");
        assert_eq!(rows[0][1].tone, Tone::Good, "current revision ok");
        assert_eq!(rows[1][0].text, "2");
        assert_eq!(rows[1][1].tone, Tone::Muted, "superseded reads muted");
        assert_eq!(rows[2][0].text, "1");

        // Values are redacted, and the password never reaches the cells.
        let values = props.sections.iter().find(|s| s.title == "Values").unwrap();
        let vrows = match &values.body {
            Body::Table { rows, .. } => rows,
            _ => panic!("Values is a table"),
        };
        let dumped = format!("{vrows:?}");
        assert!(!dumped.contains("hunter2"), "the password must never reach the payload");
        assert!(vrows.iter().any(|r| r[0].text == "auth.password" && r[1].text == "<redacted>"));
        assert!(vrows.iter().any(|r| r[0].text == "replicas" && r[1].text == "3"));
    }

    /// An Ingress backend port is a number *or* a name; murphy-yi's only Ingress uses
    /// a name, so a number-only reading would silently show nothing.
    #[test]
    fn backend_port_takes_a_number_or_a_name() {
        let port = |v: serde_json::Value| -> k8s_openapi::api::networking::v1::ServiceBackendPort {
            serde_json::from_value(v).unwrap()
        };
        assert_eq!(backend_port(Some(&port(serde_json::json!({ "number": 8080 })))), "8080");
        assert_eq!(backend_port(Some(&port(serde_json::json!({ "name": "http" })))), "http");
        // A number wins when both are somehow set, matching the API's precedence.
        assert_eq!(backend_port(Some(&port(serde_json::json!({ "number": 80, "name": "http" })))), "80");
        assert_eq!(backend_port(None), "—");
    }

    /// A reference that resolves becomes a link; one that doesn't says so rather
    /// than linking to a 404 (B42) — the rule the whole audit kept re-learning.
    #[test]
    fn ref_cell_links_only_what_exists() {
        let target = || NavTarget::namespaced("services", "prod", "api");

        let present = ref_cell("api", true, target());
        assert_eq!(present.text, "api");
        assert!(present.nav.is_some());
        assert_eq!(present.tone, Tone::Secondary);

        let missing = ref_cell("api", false, target());
        assert_eq!(missing.text, "api (not found)");
        assert!(missing.nav.is_none(), "never link to something that isn't there");
        assert_eq!(missing.tone, Tone::Warn);

        // "nothing referenced" is not the same as "referenced but missing".
        let none = ref_cell(DASH, false, target());
        assert_eq!(none.text, DASH);
        assert!(none.nav.is_none());
        assert_eq!(none.tone, Tone::Secondary);
    }

    /// Owner-kind → nav id: kinds we list resolve; kinds we don't return None so
    /// the reference stays plain text rather than becoming a dead link (B33).
    #[test]
    fn builtin_nav_id_only_maps_listed_kinds() {
        assert_eq!(builtin_nav_id("Deployment"), Some("deployments"));
        assert_eq!(builtin_nav_id("StatefulSet"), Some("statefulsets"));
        assert_eq!(builtin_nav_id("DaemonSet"), Some("daemonsets"));
        assert_eq!(builtin_nav_id("Node"), Some("nodes"));
        // Listed as of B40 — these used to be the canonical dead ends.
        assert_eq!(builtin_nav_id("ReplicaSet"), Some("replicasets"));
        assert_eq!(builtin_nav_id("StorageClass"), Some("storageclasses"));
        assert_eq!(builtin_nav_id("PersistentVolumeClaim"), Some("persistentvolumeclaims"));
        assert_eq!(builtin_nav_id("ServiceAccount"), Some("serviceaccounts"));
        // Still unlisted, so still correctly None.
        assert_eq!(builtin_nav_id("Endpoints"), None);
        assert_eq!(builtin_nav_id("PriorityClass"), None);
        assert_eq!(builtin_nav_id("FooBar"), None);
    }

    /// Inline volume sources resolve to the detail that identifies them: a
    /// ConfigMap links through, while a host path / NFS export / CSI driver is
    /// plain text (they aren't cluster objects to navigate to). Before this, every
    /// non-ConfigMap/Secret volume showed a bare em dash for its source.
    #[test]
    fn volume_source_names_inline_backings() {
        use serde_json::json;
        let vol = |body: serde_json::Value| -> k8s_openapi::api::core::v1::Volume {
            serde_json::from_value(body).unwrap()
        };

        let (src, nav) = volume_source(&vol(json!({ "name": "cfg", "configMap": { "name": "app-config" } })), "prod");
        assert_eq!(src, "app-config");
        assert!(nav.is_some(), "a ConfigMap is a listed kind, so it links");

        let (src, nav) = volume_source(&vol(json!({ "name": "data", "hostPath": { "path": "/var/lib/data" } })), "prod");
        assert_eq!(src, "/var/lib/data");
        assert!(nav.is_none(), "a host directory is not a cluster object");

        let (src, _) = volume_source(&vol(json!({ "name": "exports", "nfs": { "server": "nfs01", "path": "/exports/prod" } })), "prod");
        assert_eq!(src, "nfs01:/exports/prod", "shown as mount writes it");

        let (src, _) = volume_source(&vol(json!({ "name": "vault", "csi": { "driver": "secrets-store.csi.k8s.io" } })), "prod");
        assert_eq!(src, "secrets-store.csi.k8s.io");

        // Nothing to name (e.g. an emptyDir) still falls back to the em dash.
        let (src, nav) = volume_source(&vol(json!({ "name": "scratch", "emptyDir": {} })), "prod");
        assert_eq!(src, DASH);
        assert!(nav.is_none());
    }

    /// Replica readiness: all → green, some → amber, none → red.
    #[test]
    fn ready_tone_reflects_shortfall() {
        assert_eq!(ready_tone(3, 3), Tone::Good);
        assert_eq!(ready_tone(1, 3), Tone::Warn);
        assert_eq!(ready_tone(0, 3), Tone::Bad);
        // Scaled to zero deliberately — nothing is wrong.
        assert_eq!(ready_tone(0, 0), Tone::Muted);
    }

    /// Selectors render in the k=v,k2=v2 form kubectl uses.
    #[test]
    fn selector_rendering() {
        let mut m = BTreeMap::new();
        m.insert("app".to_string(), "valkyrie".to_string());
        m.insert("tier".to_string(), "api".to_string());
        assert_eq!(selector_text(Some(&m)), "app=valkyrie,tier=api");
        assert_eq!(selector_text(None), DASH);
        assert_eq!(selector_text(Some(&BTreeMap::new())), DASH);
    }

    /// An empty table with no note is dropped; with a note it's kept.
    #[test]
    fn empty_tables_are_dropped_unless_noted() {
        let mut p = Properties::default();
        p.push_table("Gone", None, &["A"], vec![]);
        assert!(p.sections.is_empty(), "an empty optional section should not render");

        p.push_table("Kept", Some("nothing here"), &["A"], vec![]);
        assert_eq!(p.sections.len(), 1);
        assert_eq!(p.sections[0].title, "Kept");
    }

    /// Empty chip sections never render (a pod with no annotations shows nothing).
    #[test]
    fn empty_chips_are_dropped() {
        let mut p = Properties::default();
        p.chips("Labels", vec![]);
        assert!(p.sections.is_empty());
        p.chips("Labels", vec![KeyValue { key: "a".into(), value: "b".into() }]);
        assert_eq!(p.sections.len(), 1);
    }

    /// An unsupported kind errors rather than returning an empty panel, so a dead
    /// tab can't appear.
    #[tokio::test]
    async fn unknown_kind_is_an_error() {
        // No client call happens for an unknown kind, so a default client is fine.
        let Ok(client) = Client::try_default().await else {
            return; // no kubeconfig in this environment; nothing to assert
        };
        assert!(gather(client, "configmaps", "default", "x").await.is_err());
    }
}

// ---------------------------------------------------------------------------
// PodDisruptionBudget — Phase 2 KubePi parity
// ---------------------------------------------------------------------------

async fn gather_pdb(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<DynamicObject> = Api::namespaced_with(
        client.clone(),
        namespace,
        &ResourceKind::Poddisruptionbudgets.api_resource(),
    );
    let obj = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = obj.data.get("spec");
    let status = obj.data.get("status");

    let min_avail = spec
        .and_then(|s| s.get("minAvailable"))
        .map(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| v.as_i64().map(|n| n.to_string()))
                .unwrap_or_else(|| "—".into())
        })
        .unwrap_or_else(|| "—".into());
    let max_unavail = spec
        .and_then(|s| s.get("maxUnavailable"))
        .map(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| v.as_i64().map(|n| n.to_string()))
                .unwrap_or_else(|| "—".into())
        })
        .unwrap_or_else(|| "—".into());
    let selector = spec
        .and_then(|s| s.get("selector"))
        .and_then(|s| s.get("matchLabels"))
        .and_then(|m| m.as_object())
        .map(|m| {
            m.iter()
                .map(|(k, v)| format!("{k}={}", v.as_str().unwrap_or("?")))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_else(|| "—".into());

    let mut props = Properties::default();
    props.fields(
        "Overview",
        vec![
            field("Min Available", min_avail),
            field("Max Unavailable", max_unavail),
            field("Selector", selector),
        ],
    );

    if let Some(st) = status {
        let current = st
            .get("currentHealthy")
            .and_then(|v| v.as_i64())
            .map(|n| n.to_string())
            .unwrap_or_else(|| "—".into());
        let desired = st
            .get("desiredHealthy")
            .and_then(|v| v.as_i64())
            .map(|n| n.to_string())
            .unwrap_or_else(|| "—".into());
        let allowed = st
            .get("disruptionsAllowed")
            .and_then(|v| v.as_i64())
            .map(|n| n.to_string())
            .unwrap_or_else(|| "—".into());
        props.fields(
            "Status",
            vec![
                field("Current Healthy", current),
                field("Desired Healthy", desired),
                field("Disruptions Allowed", allowed),
            ],
        );
    }

    Ok(props)
}

// ---------------------------------------------------------------------------
// Webhook configurations (Mutating / Validating) — Phase 2
// ---------------------------------------------------------------------------

async fn gather_webhook(
    client: Client,
    name: &str,
    mutating: bool,
) -> AppResult<Properties> {
    let kind = if mutating {
        ResourceKind::Mutatingwebhookconfigurations
    } else {
        ResourceKind::Validatingwebhookconfigurations
    };
    let api: Api<DynamicObject> = Api::all_with(client.clone(), &kind.api_resource());
    let obj = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;

    let created = obj
        .metadata
        .creation_timestamp
        .as_ref()
        .map(|t| t.0.to_rfc3339())
        .unwrap_or_default();

    let mut props = Properties::default();
    props.fields("Overview", vec![field("Name", obj.name_any()), field("Created", created)]);

    // Webhooks table
    if let Some(wh) = obj.data.get("webhooks").and_then(|w| w.as_array()) {
        let rows: Vec<Vec<Cell>> = wh
            .iter()
            .map(|w| {
                let name = w
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("?");
                let url = w
                    .get("clientConfig")
                    .and_then(|cc| cc.get("url"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let svc = w
                    .get("clientConfig")
                    .and_then(|cc| cc.get("service"))
                    .map(|s| {
                        let ns = s.get("namespace").and_then(|v| v.as_str()).unwrap_or("");
                        let svc_name = s.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                        format!("{ns}/{svc_name}")
                    })
                    .unwrap_or_default();
                let failure = w
                    .get("failurePolicy")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Fail");
                let side_effects = w
                    .get("sideEffects")
                    .and_then(|v| v.as_str())
                    .unwrap_or("None");
                vec![
                    c(name),
                    c(if !url.is_empty() { url } else { &svc }),
                    c(failure),
                    c(side_effects),
                ]
            })
            .collect();
        props.push_table(
            "Webhooks",
            Some("No webhooks defined"),
            &["Name", "Target", "Failure Policy", "Side Effects"],
            rows,
        );
    }

    Ok(props)
}

// ---------------------------------------------------------------------------
// APIService — Phase 2
// ---------------------------------------------------------------------------

async fn gather_api_service(client: Client, name: &str) -> AppResult<Properties> {
    let api: Api<DynamicObject> = Api::all_with(client.clone(), &ResourceKind::Apiservices.api_resource());
    let obj = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;

    let spec = obj.data.get("spec");
    let status = obj.data.get("status");

    let group_version = spec
        .and_then(|s| {
            let group = s.get("group").and_then(|v| v.as_str()).unwrap_or("");
            let version = s.get("version").and_then(|v| v.as_str()).unwrap_or("");
            if group.is_empty() {
                Some(version.to_string())
            } else {
                Some(format!("{group}/{version}"))
            }
        })
        .unwrap_or_else(|| "—".into());
    let svc = spec
        .and_then(|s| s.get("service"))
        .map(|svc| {
            let ns = svc.get("namespace").and_then(|v| v.as_str()).unwrap_or("");
            let svc_name = svc.get("name").and_then(|v| v.as_str()).unwrap_or("?");
            format!("{ns}/{svc_name}")
        })
        .unwrap_or_else(|| "—".into());
    let group_priority = spec
        .and_then(|s| s.get("groupPriorityMinimum"))
        .and_then(|v| v.as_i64())
        .map(|n| n.to_string())
        .unwrap_or_else(|| "—".into());
    let version_priority = spec
        .and_then(|s| s.get("versionPriority"))
        .and_then(|v| v.as_i64())
        .map(|n| n.to_string())
        .unwrap_or_else(|| "—".into());
    let insecure = spec
        .and_then(|s| s.get("insecureSkipTLSVerify"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut props = Properties::default();
    props.fields(
        "Overview",
        vec![
            field("Group/Version", group_version),
            field("Service", svc),
            field("Group Priority", group_priority),
            field("Version Priority", version_priority),
            field("Insecure Skip TLS", if insecure { "Yes" } else { "No" }),
        ],
    );

    // Conditions
    if let Some(conds) = status
        .and_then(|s| s.get("conditions"))
        .and_then(|c| c.as_array())
    {
        let cond_rows: Vec<Vec<Cell>> = conds
            .iter()
            .map(|cond| {
                let type_ = cond.get("type").and_then(|v| v.as_str()).unwrap_or("?");
                let status = cond.get("status").and_then(|v| v.as_str()).unwrap_or("?");
                let reason = cond.get("reason").and_then(|v| v.as_str()).unwrap_or("");
                let msg = cond.get("message").and_then(|v| v.as_str()).unwrap_or("");
                vec![c(type_), c(status), c(reason), c(msg)]
            })
            .collect();
        props.push_table(
            "Conditions",
            Some("No conditions"),
            &["Type", "Status", "Reason", "Message"],
            cond_rows,
        );
    }

    Ok(props)
}

// ---------------------------------------------------------------------------
// CRD detail (custom kinds) — B15+
// ---------------------------------------------------------------------------

/// Properties for a CRD (CustomResourceDefinition) itself.
///
/// `kind_id` is the custom kind id in "group/plural" format
/// (e.g. "argoproj.io/applications"). We fetch the CRD object and build
/// sections for its overview, schema fields, conditions, and printer columns.
async fn gather_crd_detail(client: Client, kind_id: &str) -> AppResult<Properties> {
    // Parse the "group/plural" id to find the CRD name.
    // CRD metadata.name is always "{plural}.{group}".
    let (group, plural) = kind_id
        .split_once('/')
        .ok_or_else(|| AppError::Other(format!("invalid custom kind id: {kind_id}")))?;
    let crd_name = format!("{plural}.{group}");

    let api: Api<CustomResourceDefinition> = Api::all(client.clone());
    let crd = api
        .get(&crd_name)
        .await
        .map_err(|e| AppError::Kube(format!("CRD {crd_name}: {e}")))?;

    let spec = &crd.spec;
    let status = crd.status.as_ref();
    let mut props = Properties::default();

    // --- Section 1: Overview ---
    let storage_ver = spec
        .versions
        .iter()
        .find(|v| v.storage)
        .or_else(|| spec.versions.first());
    let served_versions: Vec<String> = spec
        .versions
        .iter()
        .filter(|v| v.served)
        .map(|v| v.name.clone())
        .collect();

    let created = crd
        .metadata
        .creation_timestamp
        .as_ref()
        .map(|t| t.0.to_rfc3339())
        .unwrap_or_default();

    props.fields(
        "Overview",
        vec![
            field("Group", spec.group.clone()),
            field("Kind", spec.names.kind.clone()),
            field("Plural", spec.names.plural.clone()),
            field(
                "Singular",
                spec.names.singular.clone().unwrap_or_default(),
            ),
            field("Scope", spec.scope.clone()),
            field(
                "Storage Version",
                storage_ver.map(|v| v.name.clone()).unwrap_or_else(|| "-".into()),
            ),
            field("Served Versions", served_versions.join(", ")),
            field("Created", created),
        ],
    );

    // --- Section 2: Additional Printer Columns ---
    if let Some(ver) = storage_ver {
        if let Some(cols) = &ver.additional_printer_columns {
            let col_rows: Vec<Vec<Cell>> = cols
                .iter()
                .map(|col| {
                    vec![
                        c(col.name.clone()),
                        c(col.json_path.clone()),
                        c(col.type_.clone()),
                        c(col.description.as_deref().unwrap_or("")),
                    ]
                })
                .collect();
            props.push_table(
                "Printer Columns",
                Some("No additional printer columns"),
                &["Name", "JSON Path", "Type", "Description"],
                col_rows,
            );
        }
    }

    // --- Section 3: Schema (top-level fields) ---
    if let Some(ver) = storage_ver {
        if let Some(schema) = &ver.schema {
            if let Some(openapi) = &schema.open_api_v3_schema {
                if let Some(props_map) = &openapi.properties {
                    let field_rows: Vec<Vec<Cell>> = props_map
                        .iter()
                        .map(|(name, prop)| {
                            let type_str = prop
                                .type_
                                .as_deref()
                                .unwrap_or("object");
                            let desc = prop.description.as_deref().unwrap_or("");
                            let required = openapi
                                .required
                                .as_ref()
                                .map(|r| r.contains(name))
                                .unwrap_or(false);
                            vec![
                                c(name),
                                c(type_str),
                                c(if required { "Yes" } else { "No" }),
                                c(desc),
                            ]
                        })
                        .collect();
                    props.push_table(
                        "Schema Fields",
                        Some("No schema defined"),
                        &["Field", "Type", "Required", "Description"],
                        field_rows,
                    );
                }
            }
        }
    }

    // --- Section 4: Conditions ---
    if let Some(st) = status {
        if let Some(conditions) = &st.conditions {
            let cond_rows: Vec<Vec<Cell>> = conditions
                .iter()
                .map(|cond| {
                    vec![
                        c(cond.type_.clone()),
                        c(cond.status.clone()),
                        c(cond.reason.as_deref().unwrap_or("")),
                        c(cond.message.as_deref().unwrap_or("")),
                    ]
                })
                .collect();
            props.push_table(
                "Conditions",
                Some("No conditions"),
                &["Type", "Status", "Reason", "Message"],
                cond_rows,
            );
        }
    }

    Ok(props)
}

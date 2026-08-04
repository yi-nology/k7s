//! Pod properties (B13): containers, volumes, services, and metadata.

use super::*;
use crate::error::AppResult;
use k8s_openapi::api::core::v1::{
    ConfigMap, PersistentVolume, PersistentVolumeClaim, Pod, Secret, Service,
};
use kube::api::{Api, ListParams};
use kube::Client;

pub async fn gather_pod(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let pods: Api<Pod> = Api::namespaced(client.clone(), namespace);
    let pod = pods
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;

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
                spec.node_name
                    .clone()
                    .filter(|n| !n.is_empty())
                    .map(|n| NavTarget::cluster("nodes", n)),
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
                        let req = r
                            .requests
                            .as_ref()
                            .and_then(|m| m.get(key))
                            .map(|q| q.0.clone());
                        let lim = r
                            .limits
                            .as_ref()
                            .and_then(|m| m.get(key))
                            .map(|q| q.0.clone());
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
                Cell::new(
                    if ready { "yes" } else { "no" },
                    if ready { Tone::Good } else { Tone::Warn },
                ),
                Cell::new(
                    restarts.to_string(),
                    if restarts > 5 {
                        Tone::Bad
                    } else {
                        Tone::Secondary
                    },
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
        &[
            "NAME", "IMAGE", "STATE", "READY", "RESTARTS", "CPU R/L", "MEM R/L", "PORTS",
        ],
        rows,
    );

    // ---- volumes (resolving PVC → PV) ----
    let volumes = gather_volumes(&client, namespace, &spec).await;
    let (pvc_vols, other_vols): (Vec<_>, Vec<_>) =
        volumes.into_iter().partition(|v| v.kind == "PVC");

    props.push_table(
        "Storage",
        Some("no persistent volumes attached"),
        &[
            "VOLUME",
            "CLAIM",
            "PV",
            "CAPACITY",
            "CLASS",
            "ACCESS",
            "PHASE",
            "MOUNTED AT",
        ],
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
                        Some(NavTarget::namespaced(
                            "persistentvolumeclaims",
                            namespace,
                            v.claim.clone(),
                        )),
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
                        Some(NavTarget::cluster(
                            "storageclasses",
                            v.storage_class.clone(),
                        )),
                    ),
                    c(v.access_modes.clone()),
                    Cell::new(
                        v.phase.clone(),
                        if v.phase == "Bound" {
                            Tone::Good
                        } else {
                            Tone::Warn
                        },
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
pub(super) struct VolumeInfo {
    pub name: String,
    pub kind: String,
    pub mount_paths: String,
    pub read_only: bool,
    pub claim: String,
    pub pv: String,
    pub capacity: String,
    pub storage_class: String,
    pub access_modes: String,
    pub phase: String,
    /// For a ConfigMap/Secret-backed volume, the object it mounts, and a link to
    /// it. The classification alone ("Secret") doesn't say *which* Secret, which
    /// is the thing you opened the panel to find out.
    pub source: String,
    pub source_nav: Option<NavTarget>,
    /// The referenced ConfigMap/Secret doesn't exist. Legal — a volume source can
    /// be `optional: true` — but worth saying, because the mount is then empty.
    pub source_missing: bool,
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
        let mount_paths = if mounts.is_empty() {
            DASH.to_string()
        } else {
            mounts.join(", ")
        };

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
pub(super) fn volume_source(
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
                || !selector
                    .iter()
                    .all(|(k, v)| labels.get(k).map(|lv| lv == v).unwrap_or(false))
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
                .map(|p| {
                    format!(
                        "{}/{}",
                        p.port,
                        p.protocol.clone().unwrap_or_else(|| "TCP".into())
                    )
                })
                .collect::<Vec<_>>()
                .join(", ")
        })
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| DASH.into())
}

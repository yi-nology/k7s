//! Network properties: Services, Ingresses, NetworkPolicies.

use super::*;
use crate::error::AppResult;
use k7s_deps::k8s_openapi::api::core::v1::Pod;
use k7s_deps::k8s_openapi::api::core::v1::{Secret, Service};
use k7s_deps::k8s_openapi::api::discovery::v1::EndpointSlice;
use k7s_deps::k8s_openapi::api::networking::v1::{Ingress, NetworkPolicy};
use k7s_deps::kube::api::{Api, ListParams};
use k7s_deps::kube::Client;

/// An Ingress backend port, which is *either* a number or a named port on the
/// Service — murphy-yi's only Ingress uses a name, which is the case a
/// number-only reading would silently drop.
pub(crate) fn backend_port(
    p: Option<&k7s_deps::k8s_openapi::api::networking::v1::ServiceBackendPort>,
) -> String {
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
pub(super) async fn gather_ingress(
    client: Client,
    namespace: &str,
    name: &str,
) -> AppResult<Properties> {
    let api: Api<Ingress> = Api::namespaced(client.clone(), namespace);
    let ing = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = ing.spec.clone().unwrap_or_default();
    let mut props = Properties::default();

    // Resolve every referenced Service/Secret once, not once per rule: an Ingress
    // routinely points many paths at the same backend.
    let svc_api: Api<Service> = Api::namespaced(client.clone(), namespace);
    let sec_api: Api<Secret> = Api::namespaced(client.clone(), namespace);
    let mut svc_exists: BTreeMap<String, bool> = BTreeMap::new();
    let mut sec_exists: BTreeMap<String, bool> = BTreeMap::new();

    // Collect unique service and secret names from rules and TLS.
    let mut svc_names: Vec<String> = Vec::new();
    let mut sec_names: Vec<String> = Vec::new();
    for rule in spec.rules.iter().flatten() {
        if let Some(http) = &rule.http {
            for path in &http.paths {
                if let Some(svc) = &path.backend.service {
                    svc_names.push(svc.name.clone());
                }
            }
        }
    }
    for tls in spec.tls.iter().flatten() {
        if let Some(sn) = &tls.secret_name {
            sec_names.push(sn.clone());
        }
    }
    svc_names.sort();
    svc_names.dedup();
    sec_names.sort();
    sec_names.dedup();

    // Existence-check once each.
    for sn in &svc_names {
        svc_exists.insert(sn.clone(), svc_api.get_metadata(sn).await.is_ok());
    }
    for sn in &sec_names {
        sec_exists.insert(sn.clone(), sec_api.get_metadata(sn).await.is_ok());
    }

    let class = spec
        .ingress_class_name
        .clone()
        .unwrap_or_else(|| DASH.into());
    let lb = ing
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
            field("class", class),
            field("load balancer", lb),
            field(
                "default backend",
                spec.default_backend
                    .as_ref()
                    .map(|db| {
                        db.service
                            .as_ref()
                            .map(|svc| format!("{}:{}", svc.name, backend_port(svc.port.as_ref())))
                            .unwrap_or_else(|| DASH.into())
                    })
                    .unwrap_or_else(|| DASH.into()),
            ),
        ],
    );

    // ---- rules ----
    let mut rule_rows: Vec<Vec<Cell>> = Vec::new();
    for rule in spec.rules.iter().flatten() {
        let host = rule
            .host
            .as_deref()
            .filter(|h| !h.is_empty())
            .unwrap_or("*");
        if let Some(http) = &rule.http {
            for p in &http.paths {
                let svc = p
                    .backend
                    .service
                    .as_ref()
                    .map(|svc| {
                        let exists = svc_exists.get(&svc.name).copied().unwrap_or(false);
                        ref_cell(
                            &svc.name,
                            exists,
                            NavTarget::namespaced("services", namespace, svc.name.clone()),
                        )
                    })
                    .unwrap_or_else(|| c(DASH));
                rule_rows.push(vec![
                    c(host),
                    c(p.path.clone().unwrap_or_else(|| DASH.into())),
                    c(p.path_type.clone()),
                    svc,
                    c(backend_port(
                        p.backend.service.as_ref().and_then(|s| s.port.as_ref()),
                    )),
                ]);
            }
        }
    }
    props.push_table(
        "Rules",
        Some("no rules"),
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
    props.push_table(
        "TLS",
        Some("no TLS — served over HTTP"),
        &["HOSTS", "SECRET"],
        tls_rows,
    );

    meta_sections(&mut props, &ing);
    Ok(props)
}

pub(super) async fn gather_service(
    client: Client,
    namespace: &str,
    name: &str,
) -> AppResult<Properties> {
    let api: Api<Service> = Api::namespaced(client.clone(), namespace);
    let svc = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
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
            field(
                "type",
                spec.type_.clone().unwrap_or_else(|| "ClusterIP".into()),
            ),
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
            field(
                "traffic policy",
                or_dash(spec.external_traffic_policy.clone()),
            ),
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
                    c(p.target_port
                        .as_ref()
                        .map(int_or_string)
                        .unwrap_or_else(|| p.port.to_string())),
                    c(p.node_port
                        .map(|n| n.to_string())
                        .unwrap_or_else(|| DASH.into())),
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
            for ep in slice.endpoints.into_iter().flatten() {
                let ready = ep
                    .conditions
                    .as_ref()
                    .and_then(|c0| c0.ready)
                    .unwrap_or(true);
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

pub(super) async fn gather_networkpolicy(
    client: Client,
    namespace: &str,
    name: &str,
) -> AppResult<Properties> {
    let api: Api<NetworkPolicy> = Api::namespaced(client.clone(), namespace);
    let np = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = np.spec.clone().unwrap_or_default();
    let mut props = Properties::default();

    let policy_types_str = spec
        .policy_types
        .as_ref()
        .map(|v| v.join(", "))
        .unwrap_or_default();

    let pod_sel = spec
        .pod_selector
        .as_ref()
        .and_then(|s| s.match_labels.as_ref())
        .map(|m| selector_text(Some(m)))
        .unwrap_or_else(|| DASH.into());

    props.fields(
        "Overview",
        vec![
            field("pod selector", pod_sel),
            field(
                "policy types",
                if policy_types_str.is_empty() {
                    DASH.into()
                } else {
                    policy_types_str
                },
            ),
        ],
    );

    // ---- pods selected by this policy ----
    // List the pods whose labels match the policy's podSelector. When the
    // selector is empty (matchLabels: {}), the policy selects ALL pods in the
    // namespace — listing them is the most useful thing the panel can do.
    let pod_api: Api<Pod> = Api::namespaced(client.clone(), namespace);
    let selector_match = spec
        .pod_selector
        .as_ref()
        .and_then(|s| s.match_labels.as_ref());
    let lp = match selector_match {
        Some(m) if !m.is_empty() => {
            let label_str = m
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join(",");
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
                    Cell::age(p.creation_timestamp().map(|t| t.0.to_string())),
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
                    (
                        format!("pod: {}", selector_text(pod.match_labels.as_ref())),
                        None,
                    )
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
                            p.port
                                .as_ref()
                                .map(int_or_string)
                                .unwrap_or_else(|| "*".into()),
                            p.protocol.clone().unwrap_or_else(|| "TCP".into())
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                let from_cell = match peer_nav {
                    Some(nav) => Cell::link(peer_text, Tone::Secondary, Some(nav)),
                    None => c(peer_text),
                };
                vec![
                    from_cell,
                    c(if ports.is_empty() { DASH.into() } else { ports }),
                ]
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
                    (
                        format!("pod: {}", selector_text(pod.match_labels.as_ref())),
                        None,
                    )
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
                            p.port
                                .as_ref()
                                .map(int_or_string)
                                .unwrap_or_else(|| "*".into()),
                            p.protocol.clone().unwrap_or_else(|| "TCP".into())
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                let to_cell = match peer_nav {
                    Some(nav) => Cell::link(peer_text, Tone::Secondary, Some(nav)),
                    None => c(peer_text),
                };
                vec![
                    to_cell,
                    c(if ports.is_empty() { DASH.into() } else { ports }),
                ]
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

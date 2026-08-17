//! Network mapping: Service, Ingress, IngressClass, NetworkPolicy.

use super::*;
use k7s_deps::k8s_openapi::api::core::v1::Service;
use k7s_deps::k8s_openapi::api::networking::v1::{Ingress, IngressClass};
use k7s_deps::kube::core::DynamicObject;
use k7s_deps::kube::ResourceExt;

/// Services: NAME, NAMESPACE, TYPE, CLUSTER-IP, PORTS, AGE.
pub fn map_service(svc: &Service) -> Row {
    let spec = svc.spec.as_ref();
    let ty = spec
        .and_then(|s| s.type_.clone())
        .unwrap_or_else(|| "ClusterIP".into());
    let cluster_ip = spec
        .and_then(|s| s.cluster_ip.clone())
        .unwrap_or_else(|| "None".into());
    // "8080/TCP, 443/TCP" from the port list.
    let ports = spec
        .and_then(|s| s.ports.as_ref())
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
        .unwrap_or_default();
    let cells = vec![
        name_cell(svc),
        ns_cell(svc),
        Cell::new(ty, Tone::Secondary),
        Cell::new(cluster_ip, Tone::Secondary),
        Cell::new(ports, Tone::Secondary),
        age_cell(svc),
    ];
    let mut row = simple_row(svc, cells);
    // Expose the Service's pod selector so the topology graph can match
    // Services to Pods even when EndpointSlices are unavailable.
    row.selector = spec.and_then(|s| s.selector.clone());
    row
}

/// Ingresses: NAME, NAMESPACE, HOSTS, CLASS, AGE.
pub fn map_ingress(ing: &Ingress) -> Row {
    let spec = ing.spec.as_ref();
    let hosts = spec
        .and_then(|s| s.rules.as_ref())
        .map(|rs| {
            rs.iter()
                .filter_map(|r| r.host.clone())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let class = spec
        .and_then(|s| s.ingress_class_name.clone())
        .unwrap_or_else(|| "—".into());
    // Carry TLS state so the frontend topology can detect it reliably
    // instead of relying on class-name heuristics.
    let has_tls = spec
        .map(|s| s.tls.as_ref().is_some_and(|t| !t.is_empty()))
        .unwrap_or(false);
    let mut labels = std::collections::BTreeMap::new();
    if has_tls {
        labels.insert("tls".to_string(), "true".to_string());
    }
    let cells = vec![
        name_cell(ing),
        ns_cell(ing),
        Cell::new(hosts, Tone::Secondary),
        Cell::new(class, Tone::Secondary),
        age_cell(ing),
    ];
    let mut row = simple_row(ing, cells);
    if !labels.is_empty() {
        row.labels = Some(labels);
    }
    row
}

/// The annotation marking an IngressClass as the cluster default.
const DEFAULT_INGRESS_CLASS_ANNOTATION: &str = "ingressclass.kubernetes.io/is-default-class";

/// IngressClasses: NAME, CONTROLLER, PARAMETERS, AGE. Cluster-scoped.
/// The default is marked in the name, as kubectl does — which controller picks up
/// an Ingress that names no class is the question this answers.
pub fn map_ingressclass(ic: &IngressClass) -> Row {
    let is_default = ic
        .metadata
        .annotations
        .as_ref()
        .and_then(|a| a.get(DEFAULT_INGRESS_CLASS_ANNOTATION))
        .is_some_and(|v| v == "true");
    let name = if is_default {
        format!("{} (default)", ic.name_any())
    } else {
        ic.name_any()
    };
    let spec = ic.spec.as_ref();

    // Parameters point at a controller-specific config object when set; usually
    // absent, but when present it's the only pointer to how the class is tuned.
    let parameters = spec
        .and_then(|s| s.parameters.as_ref())
        .map(|p| format!("{}/{}", p.kind, p.name))
        .unwrap_or_else(|| "—".into());

    let cells = vec![
        Cell::new(name, Tone::Primary),
        Cell::new(
            spec.and_then(|s| s.controller.clone())
                .unwrap_or_else(|| "—".into()),
            Tone::Secondary,
        ),
        Cell::new(parameters, Tone::Secondary),
        age_cell(ic),
    ];
    Row {
        uid: uid_of(ic),
        name: ic.name_any(),
        namespace: None,
        cells,
        ..Default::default()
    }
}

/// NetworkPolicy: NAME, NAMESPACE, POD_SELECTOR, AGE.
pub fn map_networkpolicy(obj: &DynamicObject) -> Row {
    let pod_selector = obj
        .data
        .get("spec")
        .and_then(|s| s.get("podSelector"))
        .map(|p| k7s_deps::serde_json::to_string(p).unwrap_or_default())
        .unwrap_or_else(|| "—".to_string());
    let age = obj
        .metadata
        .creation_timestamp
        .as_ref()
        .map(|t| t.0.to_string())
        .unwrap_or_default();
    let cells = vec![
        Cell::new(obj.name_any(), Tone::Primary),
        Cell::new(obj.namespace().unwrap_or_default(), Tone::Muted),
        Cell::new(pod_selector, Tone::Secondary),
        Cell::age(Some(age).filter(|s| !s.is_empty())),
    ];
    Row {
        uid: format!(
            "networkpolicy:{}/{}",
            obj.namespace().unwrap_or_default(),
            obj.name_any()
        ),
        name: obj.name_any(),
        namespace: Some(obj.namespace().unwrap_or_default()),
        cells,
        ..Default::default()
    }
}

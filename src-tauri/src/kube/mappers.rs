//! Convert k8s_openapi objects → DTO rows.
//!
//! This is the **semantic** layer: it knows what "CrashLoopBackOff" means
//! (red), what "1/2" ready containers mean (amber), what age formatting
//! looks like. The UI never decides tone — it just maps `Tone` to a
//! CSS variable.
//!
//! Adding a new resource kind? Write a `xxx_to_row` here and call it
//! from the matching `list_xxx` command. Nothing in the UI needs to
//! change.

use chrono::{DateTime, Utc};
use k8s_openapi::api::apps::v1::{DaemonSet, Deployment, ReplicaSet, StatefulSet};
use k8s_openapi::api::batch::v1::{CronJob, Job};
use k8s_openapi::api::core::v1::{
    ConfigMap, Event, Namespace, Node, PersistentVolumeClaim, Pod, Secret, Service,
};
use k8s_openapi::api::networking::v1::Ingress;
use k8s_openapi::api::autoscaling::v1::HorizontalPodAutoscaler;
use kube::{Resource, ResourceExt};

use super::dto::{Cell, NavTarget, PodMeta, Row, Tone};

// ---------------------------------------------------------------------------
// Age formatting
// ---------------------------------------------------------------------------

/// Compact "4d2h" / "38s" age string used in cell display.
pub fn age_of(ts: &Option<k8s_openapi::apimachinery::pkg::apis::meta::v1::Time>) -> String {
    let Some(t) = ts else {
        return "—".to_string();
    };
    let created: DateTime<Utc> = t.0;
    let dur = Utc::now().signed_duration_since(created);
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

// ---------------------------------------------------------------------------
// Per-kind row mappers
// ---------------------------------------------------------------------------

pub fn pod_to_row(p: &Pod) -> Row {
    let status = p
        .status
        .as_ref()
        .and_then(|s| s.phase.clone())
        .unwrap_or_else(|| "Unknown".to_string());

    // Derive a status tone from phase + container statuses.
    let status_tone = pod_status_tone(p);

    // "1/2" ready, restart count.
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
            (format!("{}/{}", ready_count, total), restarts as i32)
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
        })
        .unwrap_or_default();

    let node = p
        .spec
        .as_ref()
        .and_then(|s| s.node_name.clone())
        .unwrap_or_default();
    let ip = p
        .status
        .as_ref()
        .and_then(|s| s.pod_ip.clone())
        .unwrap_or_default();

    let cells = vec![
        Cell::primary(p.name_any()).with_nav(
            NavTarget::new(super::dto::KIND_PODS, p.name_any())
                .in_ns(p.namespace().unwrap_or_default()),
        ),
        Cell::muted(p.namespace().unwrap_or_default()),
        Cell::new(ready.clone(), ready_tone(p, &ready)),
        Cell::new(status.clone(), status_tone).with_dot(),
        Cell::new(
            restarts.to_string(),
            if restarts > 5 {
                Tone::Err
            } else if restarts > 0 {
                Tone::Warn
            } else {
                Tone::Muted
            },
        )
        .with_sort(restarts as f64),
        {
            let ts = p.meta().creation_timestamp.clone();
            match ts {
                Some(t) => Cell::age(t.0),
                None => Cell::muted("—"),
            }
        },
        Cell::muted(node.clone()),
        Cell::muted(ip),
    ];

    let labels = p
        .meta()
        .labels
        .clone()
        .map(|m| m.into_iter().collect());

    let pod_meta = PodMeta {
        node: node.clone(),
        containers: containers.clone(),
        status: status.clone(),
        ready,
        restarts,
        creation_ts: p
            .meta()
            .creation_timestamp
            .as_ref()
            .map(|t| t.0.to_rfc3339())
            .unwrap_or_default(),
        status_tone,
    };

    Row {
        uid: p.meta().uid.clone().unwrap_or_default(),
        name: p.name_any(),
        namespace: Some(p.namespace().unwrap_or_default()),
        cells,
        pod: Some(pod_meta),
        labels,
        selector: None,
    }
}

fn pod_status_tone(p: &Pod) -> Tone {
    // Container-state based tone takes precedence over phase, because
    // a pod in "Running" phase with CrashLoopBackOff containers is
    // very much not green.
    if let Some(status) = p.status.as_ref() {
        if let Some(cs) = status.container_statuses.as_ref() {
            for c in cs {
                if let Some(waiting) = c.state.as_ref().and_then(|s| s.waiting.as_ref()) {
                    let r = waiting.reason.as_deref();
                    match r {
                        Some("CrashLoopBackOff" | "Error" | "ImagePullBackOff" | "ErrImagePull") => {
                            return Tone::Err
                        }
                        Some("ContainerCreating" | "PodInitializing") => return Tone::Warn,
                        _ => {}
                    }
                }
            }
        }
    }
    match p
        .status
        .as_ref()
        .and_then(|s| s.phase.as_deref())
        .unwrap_or("Unknown")
    {
        "Running" => Tone::Ok,
        "Pending" => Tone::Warn,
        "Succeeded" => Tone::Muted,
        "Failed" => Tone::Err,
        _ => Tone::Muted,
    }
}

fn ready_tone(p: &Pod, ready: &str) -> Tone {
    let Some((ok, total)) = ready.split_once('/') else {
        return Tone::Muted;
    };
    let (ok, total) = (ok.parse::<u32>().unwrap_or(0), total.parse::<u32>().unwrap_or(0));
    if total == 0 {
        return Tone::Muted;
    }
    if ok == total {
        Tone::Ok
    } else if ok == 0 {
        // Could be CrashLoopBackOff; if so, escalate to red.
        if is_crashloop(p) {
            Tone::Err
        } else {
            Tone::Warn
        }
    } else {
        Tone::Warn
    }
}

fn is_crashloop(p: &Pod) -> bool {
    p.status
        .as_ref()
        .and_then(|s| s.container_statuses.as_ref())
        .map(|cs| {
            cs.iter().any(|c| {
                c.state
                    .as_ref()
                    .and_then(|s| s.waiting.as_ref())
                    .and_then(|w| w.reason.as_deref())
                    .map(|r| r == "CrashLoopBackOff")
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

pub fn deployment_to_row(d: &Deployment) -> Row {
    let desired = d.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0);
    let ready = d
        .status
        .as_ref()
        .and_then(|s| s.ready_replicas)
        .unwrap_or(0);
    let available = d
        .status
        .as_ref()
        .and_then(|s| s.available_replicas)
        .unwrap_or(0);
    let updated = d
        .status
        .as_ref()
        .and_then(|s| s.updated_replicas)
        .unwrap_or(0);
    let ready_str = format!("{}/{}", ready, desired);
    let tone = if desired == 0 {
        Tone::Muted
    } else if ready >= desired {
        Tone::Ok
    } else if ready == 0 {
        Tone::Err
    } else {
        Tone::Warn
    };
    let cells = vec![
        Cell::primary(d.name_any()).with_nav(
            NavTarget::new(super::dto::KIND_DEPLOYMENTS, d.name_any())
                .in_ns(d.namespace().unwrap_or_default()),
        ),
        Cell::muted(d.namespace().unwrap_or_default()),
        Cell::new(ready_str, tone),
        Cell::muted(updated.to_string()).with_sort(updated as f64),
        Cell::muted(available.to_string()).with_sort(available as f64),
        match d.meta().creation_timestamp.as_ref() {
            Some(t) => Cell::age(t.0),
            None => Cell::muted("—"),
        },
    ];
    let selector = d
        .spec
        .as_ref()
        .and_then(|s| s.selector.match_labels.clone())
        .map(|m| m.into_iter().collect());
    Row {
        uid: d.meta().uid.clone().unwrap_or_default(),
        name: d.name_any(),
        namespace: Some(d.namespace().unwrap_or_default()),
        cells,
        pod: None,
        labels: d
            .meta()
            .labels
            .clone()
            .map(|m| m.into_iter().collect()),
        selector,
    }
}

pub fn statefulset_to_row(s: &StatefulSet) -> Row {
    let desired = s.spec.as_ref().and_then(|sp| sp.replicas).unwrap_or(0);
    let ready = s.status.as_ref().and_then(|st| st.ready_replicas).unwrap_or(0);
    let ready_str = format!("{}/{}", ready, desired);
    let tone = if desired == 0 {
        Tone::Muted
    } else if ready >= desired {
        Tone::Ok
    } else if ready == 0 {
        Tone::Err
    } else {
        Tone::Warn
    };
    let cells = vec![
        Cell::primary(s.name_any()).with_nav(
            NavTarget::new(super::dto::KIND_STATEFULSETS, s.name_any())
                .in_ns(s.namespace().unwrap_or_default()),
        ),
        Cell::muted(s.namespace().unwrap_or_default()),
        Cell::new(ready_str, tone),
        match s.meta().creation_timestamp.as_ref() {
            Some(t) => Cell::age(t.0),
            None => Cell::muted("—"),
        },
    ];
    let selector = s
        .spec
        .as_ref()
        .and_then(|sp| sp.selector.match_labels.clone())
        .map(|m| m.into_iter().collect());
    Row {
        uid: s.meta().uid.clone().unwrap_or_default(),
        name: s.name_any(),
        namespace: Some(s.namespace().unwrap_or_default()),
        cells,
        pod: None,
        labels: s
            .meta()
            .labels
            .clone()
            .map(|m| m.into_iter().collect()),
        selector,
    }
}

pub fn daemonset_to_row(d: &DaemonSet) -> Row {
    let desired = d
        .status
        .as_ref()
        .map(|s| s.desired_number_scheduled)
        .unwrap_or(0);
    let ready = d.status.as_ref().map(|s| s.number_ready).unwrap_or(0);
    let tone = if desired == 0 {
        Tone::Muted
    } else if ready >= desired {
        Tone::Ok
    } else {
        Tone::Warn
    };
    let cells = vec![
        Cell::primary(d.name_any()).with_nav(
            NavTarget::new(super::dto::KIND_DAEMONSETS, d.name_any())
                .in_ns(d.namespace().unwrap_or_default()),
        ),
        Cell::muted(d.namespace().unwrap_or_default()),
        Cell::muted(desired.to_string()).with_sort(desired as f64),
        Cell::new(ready.to_string(), tone).with_sort(ready as f64),
        match d.meta().creation_timestamp.as_ref() {
            Some(t) => Cell::age(t.0),
            None => Cell::muted("—"),
        },
    ];
    Row {
        uid: d.meta().uid.clone().unwrap_or_default(),
        name: d.name_any(),
        namespace: Some(d.namespace().unwrap_or_default()),
        cells,
        pod: None,
        labels: d
            .meta()
            .labels
            .clone()
            .map(|m| m.into_iter().collect()),
        selector: None,
    }
}

pub fn replicaset_to_row(r: &ReplicaSet) -> Row {
    let desired = r.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0);
    let ready = r.status.as_ref().and_then(|s| s.ready_replicas).unwrap_or(0);
    let ready_str = format!("{}/{}", ready, desired);
    let tone = if desired == 0 {
        Tone::Muted
    } else if ready >= desired {
        Tone::Ok
    } else {
        Tone::Warn
    };
    let cells = vec![
        Cell::primary(r.name_any()).with_nav(
            NavTarget::new(super::dto::KIND_REPLICASETS, r.name_any())
                .in_ns(r.namespace().unwrap_or_default()),
        ),
        Cell::muted(r.namespace().unwrap_or_default()),
        Cell::muted(desired.to_string()).with_sort(desired as f64),
        Cell::new(ready_str, tone),
        match r.meta().creation_timestamp.as_ref() {
            Some(t) => Cell::age(t.0),
            None => Cell::muted("—"),
        },
    ];
    let selector = r
        .spec
        .as_ref()
        .and_then(|s| s.selector.match_labels.clone())
        .map(|m| m.into_iter().collect());
    Row {
        uid: r.meta().uid.clone().unwrap_or_default(),
        name: r.name_any(),
        namespace: Some(r.namespace().unwrap_or_default()),
        cells,
        pod: None,
        labels: r
            .meta()
            .labels
            .clone()
            .map(|m| m.into_iter().collect()),
        selector,
    }
}

pub fn job_to_row(j: &Job) -> Row {
    let status = j
        .status
        .as_ref()
        .and_then(|s| {
            if s.succeeded.unwrap_or(0) > 0 {
                Some(("Complete", Tone::Ok))
            } else if s.failed.unwrap_or(0) > 0 {
                Some(("Failed", Tone::Err))
            } else if s.active.unwrap_or(0) > 0 {
                Some(("Running", Tone::Warn))
            } else {
                Some(("Pending", Tone::Muted))
            }
        })
        .unwrap_or(("Unknown", Tone::Muted));
    let completions = match (
        j.spec.as_ref().and_then(|s| s.completions),
        j.status.as_ref().and_then(|s| s.succeeded),
    ) {
        (Some(d), Some(s)) => format!("{}/{}", s, d),
        (Some(d), None) => format!("0/{}", d),
        _ => "—".to_string(),
    };
    let cells = vec![
        Cell::primary(j.name_any()).with_nav(
            NavTarget::new(super::dto::KIND_JOBS, j.name_any())
                .in_ns(j.namespace().unwrap_or_default()),
        ),
        Cell::muted(j.namespace().unwrap_or_default()),
        Cell::new(status.0.to_string(), status.1),
        Cell::muted(completions),
        match j.meta().creation_timestamp.as_ref() {
            Some(t) => Cell::age(t.0),
            None => Cell::muted("—"),
        },
    ];
    Row {
        uid: j.meta().uid.clone().unwrap_or_default(),
        name: j.name_any(),
        namespace: Some(j.namespace().unwrap_or_default()),
        cells,
        pod: None,
        labels: j
            .meta()
            .labels
            .clone()
            .map(|m| m.into_iter().collect()),
        selector: j
            .spec
            .as_ref()
            .and_then(|s| s.selector.as_ref())
            .and_then(|sel| sel.match_labels.clone())
            .map(|m| m.into_iter().collect()),
    }
}

pub fn cronjob_to_row(c: &CronJob) -> Row {
    let schedule = c
        .spec
        .as_ref()
        .map(|s| s.schedule.clone())
        .unwrap_or_default();
    let suspend = c.spec.as_ref().and_then(|s| s.suspend).unwrap_or(false);
    let last = c
        .status
        .as_ref()
        .and_then(|s| s.last_schedule_time.as_ref())
        .map(|t| age_of(&Some(k8s_openapi::apimachinery::pkg::apis::meta::v1::Time(t.0))))
        .unwrap_or_else(|| "<none>".to_string());
    let cells = vec![
        Cell::primary(c.name_any()).with_nav(
            NavTarget::new(super::dto::KIND_CRONJOBS, c.name_any())
                .in_ns(c.namespace().unwrap_or_default()),
        ),
        Cell::muted(c.namespace().unwrap_or_default()),
        Cell::secondary(schedule),
        Cell::muted(if suspend { "true" } else { "false" }),
        Cell::muted(last),
        match c.meta().creation_timestamp.as_ref() {
            Some(t) => Cell::age(t.0),
            None => Cell::muted("—"),
        },
    ];
    Row {
        uid: c.meta().uid.clone().unwrap_or_default(),
        name: c.name_any(),
        namespace: Some(c.namespace().unwrap_or_default()),
        cells,
        pod: None,
        labels: c
            .meta()
            .labels
            .clone()
            .map(|m| m.into_iter().collect()),
        selector: None,
    }
}

pub fn service_to_row(s: &Service) -> Row {
    use k8s_openapi::apimachinery::pkg::util::intstr::IntOrString;
    let ports = s
        .spec
        .as_ref()
        .and_then(|spec| spec.ports.as_ref())
        .map(|ports| {
            ports
                .iter()
                .map(|p| {
                    let proto = p.protocol.clone().unwrap_or_else(|| "TCP".to_string());
                    let target = p
                        .target_port
                        .as_ref()
                        .map(|tp| match tp {
                            IntOrString::Int(i) => i.to_string(),
                            IntOrString::String(s) => s.clone(),
                        })
                        .unwrap_or_default();
                    format!("{}→{}/{}", p.port, target, proto)
                })
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default();
    let kind = s
        .spec
        .as_ref()
        .and_then(|spec| spec.type_.clone())
        .unwrap_or_else(|| "ClusterIP".to_string());
    let cluster_ip = s
        .spec
        .as_ref()
        .and_then(|spec| spec.cluster_ip.clone())
        .unwrap_or_default();
    let cells = vec![
        Cell::primary(s.name_any()).with_nav(
            NavTarget::new(super::dto::KIND_SERVICES, s.name_any())
                .in_ns(s.namespace().unwrap_or_default()),
        ),
        Cell::muted(s.namespace().unwrap_or_default()),
        Cell::secondary(kind),
        Cell::muted(cluster_ip),
        Cell::secondary(ports),
        match s.meta().creation_timestamp.as_ref() {
            Some(t) => Cell::age(t.0),
            None => Cell::muted("—"),
        },
    ];
    let selector = s
        .spec
        .as_ref()
        .and_then(|sp| sp.selector.clone())
        .map(|m| m.into_iter().collect());
    Row {
        uid: s.meta().uid.clone().unwrap_or_default(),
        name: s.name_any(),
        namespace: Some(s.namespace().unwrap_or_default()),
        cells,
        pod: None,
        labels: s
            .meta()
            .labels
            .clone()
            .map(|m| m.into_iter().collect()),
        selector,
    }
}

pub fn configmap_to_row(c: &ConfigMap) -> Row {
    let data_keys = c
        .data
        .as_ref()
        .map(|d| d.len() as i32)
        .or_else(|| c.binary_data.as_ref().map(|d| d.len() as i32))
        .unwrap_or(0);
    let cells = vec![
        Cell::primary(c.name_any()).with_nav(
            NavTarget::new(super::dto::KIND_CONFIGMAPS, c.name_any())
                .in_ns(c.namespace().unwrap_or_default()),
        ),
        Cell::muted(c.namespace().unwrap_or_default()),
        Cell::muted(data_keys.to_string()).with_sort(data_keys as f64),
        match c.meta().creation_timestamp.as_ref() {
            Some(t) => Cell::age(t.0),
            None => Cell::muted("—"),
        },
    ];
    Row {
        uid: c.meta().uid.clone().unwrap_or_default(),
        name: c.name_any(),
        namespace: Some(c.namespace().unwrap_or_default()),
        cells,
        pod: None,
        labels: c
            .meta()
            .labels
            .clone()
            .map(|m| m.into_iter().collect()),
        selector: None,
    }
}

pub fn secret_to_row(s: &Secret) -> Row {
    let kind = s.type_.clone().unwrap_or_else(|| "Opaque".to_string());
    let data_keys = s.data.as_ref().map(|d| d.len() as i32).unwrap_or(0);
    let cells = vec![
        Cell::primary(s.name_any()).with_nav(
            NavTarget::new(super::dto::KIND_SECRETS, s.name_any())
                .in_ns(s.namespace().unwrap_or_default()),
        ),
        Cell::muted(s.namespace().unwrap_or_default()),
        Cell::secondary(kind),
        Cell::muted(data_keys.to_string()).with_sort(data_keys as f64),
        match s.meta().creation_timestamp.as_ref() {
            Some(t) => Cell::age(t.0),
            None => Cell::muted("—"),
        },
    ];
    Row {
        uid: s.meta().uid.clone().unwrap_or_default(),
        name: s.name_any(),
        namespace: Some(s.namespace().unwrap_or_default()),
        cells,
        pod: None,
        labels: s
            .meta()
            .labels
            .clone()
            .map(|m| m.into_iter().collect()),
        selector: None,
    }
}

pub fn pvc_to_row(p: &PersistentVolumeClaim) -> Row {
    let status = p
        .status
        .as_ref()
        .and_then(|s| s.phase.clone())
        .unwrap_or_else(|| "—".to_string());
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
    let tone = match status.as_str() {
        "Bound" => Tone::Ok,
        "Pending" => Tone::Warn,
        "Lost" => Tone::Err,
        _ => Tone::Muted,
    };
    let cells = vec![
        Cell::primary(p.name_any()).with_nav(
            NavTarget::new(super::dto::KIND_PERSISTENTVOLUMECLAIMS, p.name_any())
                .in_ns(p.namespace().unwrap_or_default()),
        ),
        Cell::muted(p.namespace().unwrap_or_default()),
        Cell::new(status, tone),
        Cell::muted(volume),
        Cell::muted(capacity),
        match p.meta().creation_timestamp.as_ref() {
            Some(t) => Cell::age(t.0),
            None => Cell::muted("—"),
        },
    ];
    Row {
        uid: p.meta().uid.clone().unwrap_or_default(),
        name: p.name_any(),
        namespace: Some(p.namespace().unwrap_or_default()),
        cells,
        pod: None,
        labels: p
            .meta()
            .labels
            .clone()
            .map(|m| m.into_iter().collect()),
        selector: None,
    }
}

pub fn hpa_to_row(h: &HorizontalPodAutoscaler) -> Row {
    let reference = h
        .spec
        .as_ref()
        .map(|s| format!("{}/{}", s.scale_target_ref.kind, s.scale_target_ref.name))
        .unwrap_or_default();
    let min = h.spec.as_ref().and_then(|s| s.min_replicas).unwrap_or(0);
    let max = h.spec.as_ref().map(|s| s.max_replicas).unwrap_or(0);
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
    let cells = vec![
        Cell::primary(h.name_any()).with_nav(
            NavTarget::new(super::dto::KIND_HPA, h.name_any())
                .in_ns(h.namespace().unwrap_or_default()),
        ),
        Cell::muted(h.namespace().unwrap_or_default()),
        Cell::secondary(reference),
        Cell::muted(format!("{}/{}", current, desired)),
        Cell::muted(min.to_string()),
        Cell::muted(max.to_string()),
        match h.meta().creation_timestamp.as_ref() {
            Some(t) => Cell::age(t.0),
            None => Cell::muted("—"),
        },
    ];
    Row {
        uid: h.meta().uid.clone().unwrap_or_default(),
        name: h.name_any(),
        namespace: Some(h.namespace().unwrap_or_default()),
        cells,
        pod: None,
        labels: h
            .meta()
            .labels
            .clone()
            .map(|m| m.into_iter().collect()),
        selector: None,
    }
}

pub fn node_to_row(n: &Node) -> Row {
    let roles: Vec<String> = n
        .metadata
        .labels
        .as_ref()
        .map(|labels| {
            labels
                .iter()
                .filter(|(k, _)| k.starts_with("node-role.kubernetes.io/"))
                .map(|(k, _)| k.trim_start_matches("node-role.kubernetes.io/").to_string())
                .collect()
        })
        .unwrap_or_default();
    let roles_str = if roles.is_empty() {
        "<none>".to_string()
    } else {
        roles.join(",")
    };
    let status = n
        .status
        .as_ref()
        .and_then(|s| s.conditions.as_ref())
        .and_then(|c| c.iter().find(|c| c.type_ == "Ready"))
        .map(|c| if c.status == "True" { Tone::Ok } else { Tone::Err })
        .unwrap_or(Tone::Muted);
    let status_text = if status == Tone::Ok { "Ready" } else { "NotReady" };
    let internal_ip = n
        .status
        .as_ref()
        .and_then(|s| s.addresses.as_ref())
        .and_then(|addrs| {
            addrs
                .iter()
                .find(|a| a.type_ == "InternalIP")
                .map(|a| a.address.clone())
        })
        .unwrap_or_default();
    let version = n
        .status
        .as_ref()
        .and_then(|s| s.node_info.clone())
        .map(|i| i.kubelet_version)
        .unwrap_or_default();
    let cells = vec![
        Cell::primary(n.name_any()).with_nav(NavTarget::new(
            super::dto::KIND_NODES,
            n.name_any(),
        )),
        Cell::new(status_text, status).with_dot(),
        Cell::muted(roles_str),
        Cell::muted(version),
        Cell::muted(internal_ip),
        match n.meta().creation_timestamp.as_ref() {
            Some(t) => Cell::age(t.0),
            None => Cell::muted("—"),
        },
    ];
    Row {
        uid: n.meta().uid.clone().unwrap_or_default(),
        name: n.name_any(),
        namespace: None,
        cells,
        pod: None,
        labels: n
            .meta()
            .labels
            .clone()
            .map(|m| m.into_iter().collect()),
        selector: None,
    }
}

pub fn namespace_to_row(n: &Namespace) -> Row {
    let status = n
        .status
        .as_ref()
        .and_then(|s| s.phase.clone())
        .unwrap_or_else(|| "Active".to_string());
    let tone = match status.as_str() {
        "Active" => Tone::Ok,
        "Terminating" => Tone::Warn,
        _ => Tone::Muted,
    };
    let cells = vec![
        Cell::primary(n.name_any()).with_nav(NavTarget::new(
            super::dto::KIND_NAMESPACES,
            n.name_any(),
        )),
        Cell::new(status, tone).with_dot(),
        match n.meta().creation_timestamp.as_ref() {
            Some(t) => Cell::age(t.0),
            None => Cell::muted("—"),
        },
    ];
    Row {
        uid: n.meta().uid.clone().unwrap_or_default(),
        name: n.name_any(),
        namespace: None,
        cells,
        pod: None,
        labels: n
            .meta()
            .labels
            .clone()
            .map(|m| m.into_iter().collect()),
        selector: None,
    }
}

pub fn event_to_row(e: &Event) -> Row {
    let object = format!(
        "{}/{}",
        e.involved_object.kind.as_deref().unwrap_or("?"),
        e.involved_object.name.as_deref().unwrap_or("?")
    );
    let type_ = e.type_.clone().unwrap_or_default();
    let kind = e.involved_object.kind.clone().unwrap_or_default();
    let reason = e.reason.clone().unwrap_or_default();
    let message = e.message.clone().unwrap_or_default();
    let count = e.count.unwrap_or(0);
    let last_seen = e
        .last_timestamp
        .as_ref()
        .map(|t| age_of(&Some(k8s_openapi::apimachinery::pkg::apis::meta::v1::Time(t.0))))
        .or_else(|| {
            e.event_time
                .as_ref()
                .map(|t| age_of(&Some(k8s_openapi::apimachinery::pkg::apis::meta::v1::Time(t.0))))
        })
        .unwrap_or_default();
    let tone = match type_.as_str() {
        "Warning" => Tone::Warn,
        _ => Tone::Muted,
    };
    let cells = vec![
        Cell::new(type_, tone).with_dot(),
        Cell::muted(e.namespace().unwrap_or_default()),
        Cell::muted(kind),
        Cell::secondary(object),
        Cell::muted(reason),
        Cell::secondary(message),
        Cell::muted(last_seen),
        Cell::muted(count.to_string()).with_sort(count as f64),
    ];
    Row {
        uid: format!(
            "{}/{}",
            e.metadata
                .namespace
                .as_deref()
                .unwrap_or(""),
            e.metadata.name.as_deref().unwrap_or_default()
        ),
        name: e.name_any(),
        namespace: Some(e.namespace().unwrap_or_default()),
        cells,
        pod: None,
        labels: None,
        selector: None,
    }
}

pub fn ingress_to_row(i: &Ingress) -> Row {
    let class = i
        .spec
        .as_ref()
        .and_then(|s| s.ingress_class_name.clone())
        .unwrap_or_default();
    let hosts = i
        .spec
        .as_ref()
        .and_then(|s| s.rules.as_ref())
        .map(|rules| {
            rules
                .iter()
                .filter_map(|r| r.host.clone())
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default();
    let cells = vec![
        Cell::primary(i.name_any()).with_nav(
            NavTarget::new(super::dto::KIND_INGRESSES, i.name_any())
                .in_ns(i.namespace().unwrap_or_default()),
        ),
        Cell::muted(i.namespace().unwrap_or_default()),
        Cell::secondary(class),
        Cell::muted(hosts),
        match i.meta().creation_timestamp.as_ref() {
            Some(t) => Cell::age(t.0),
            None => Cell::muted("—"),
        },
    ];
    Row {
        uid: i.meta().uid.clone().unwrap_or_default(),
        name: i.name_any(),
        namespace: Some(i.namespace().unwrap_or_default()),
        cells,
        pod: None,
        labels: i
            .meta()
            .labels
            .clone()
            .map(|m| m.into_iter().collect()),
        selector: None,
    }
}

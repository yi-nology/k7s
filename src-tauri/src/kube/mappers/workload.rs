//! Workload mapping: Deployment, ReplicaSet, StatefulSet, DaemonSet, Job, CronJob.

use super::*;
use k8s_openapi::api::apps::v1::{DaemonSet, Deployment, ReplicaSet, StatefulSet};
use k8s_openapi::api::batch::v1::{CronJob, Job};

/// Deployments: NAME, NAMESPACE, READY, UP-TO-DATE, AVAILABLE, AGE.
pub fn map_deployment(d: &Deployment) -> Row {
    let desired = d.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0);
    let status = d.status.as_ref();
    let ready = status.and_then(|s| s.ready_replicas).unwrap_or(0);
    let updated = status.and_then(|s| s.updated_replicas).unwrap_or(0);
    let available = status.and_then(|s| s.available_replicas).unwrap_or(0);
    let degraded = ready != desired;

    let cells = vec![
        name_cell(d),
        ns_cell(d),
        Cell::new(
            format!("{ready}/{desired}"),
            if degraded {
                Tone::Warn
            } else {
                Tone::Secondary
            },
        ),
        Cell::new(updated.to_string(), Tone::Secondary),
        Cell::new(
            available.to_string(),
            if available == 0 && desired > 0 {
                Tone::Warn
            } else {
                Tone::Secondary
            },
        ),
        Cell::new("—", Tone::Muted), // CPU — filled by overlayMetrics
        Cell::new("—", Tone::Muted), // MEM — filled by overlayMetrics
        age_cell(d),
    ];
    let mut row = simple_row(d, cells);
    // The pod selector powers the "view pods" jump (B33).
    row.selector = d
        .spec
        .as_ref()
        .and_then(|s| s.selector.match_labels.clone());
    row
}

/// ReplicaSets: NAME, NAMESPACE, DESIRED, CURRENT, READY, AGE.
///
/// Listed because it's a pod's *immediate* owner and a Deployment's actual
/// generation — the object the owner chain used to have to route around.
/// A scaled-down old generation (0 desired) is normal history, not a fault, so it
/// reads muted rather than amber.
pub fn map_replicaset(rs: &ReplicaSet) -> Row {
    let desired = rs.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0);
    let status = rs.status.as_ref();
    let current = status.map(|s| s.replicas).unwrap_or(0);
    let ready = status.and_then(|s| s.ready_replicas).unwrap_or(0);

    // Desired 0 is a superseded generation sitting at rest; only a shortfall
    // against a non-zero desired is worth colouring.
    let ready_tone = if desired == 0 {
        Tone::Muted
    } else if ready != desired {
        Tone::Warn
    } else {
        Tone::Secondary
    };

    let cells = vec![
        name_cell(rs),
        ns_cell(rs),
        Cell::new(
            desired.to_string(),
            if desired == 0 {
                Tone::Muted
            } else {
                Tone::Secondary
            },
        ),
        Cell::new(current.to_string(), Tone::Secondary),
        Cell::new(ready.to_string(), ready_tone),
        age_cell(rs),
    ];
    let mut row = simple_row(rs, cells);
    row.selector = rs
        .spec
        .as_ref()
        .and_then(|s| s.selector.match_labels.clone());
    row
}

/// StatefulSets: NAME, NAMESPACE, READY, CPU, MEM, AGE.
pub fn map_statefulset(s: &StatefulSet) -> Row {
    let desired = s.spec.as_ref().and_then(|sp| sp.replicas).unwrap_or(0);
    let ready = s
        .status
        .as_ref()
        .and_then(|st| st.ready_replicas)
        .unwrap_or(0);
    let cells = vec![
        name_cell(s),
        ns_cell(s),
        Cell::new(
            format!("{ready}/{desired}"),
            if ready != desired {
                Tone::Warn
            } else {
                Tone::Secondary
            },
        ),
        Cell::new("—", Tone::Muted), // CPU — filled by overlayMetrics
        Cell::new("—", Tone::Muted), // MEM — filled by overlayMetrics
        age_cell(s),
    ];
    let mut row = simple_row(s, cells);
    row.selector = s
        .spec
        .as_ref()
        .and_then(|sp| sp.selector.match_labels.clone());
    row
}

/// DaemonSets: NAME, NAMESPACE, DESIRED, READY, CPU, MEM, AGE.
pub fn map_daemonset(ds: &DaemonSet) -> Row {
    let st = ds.status.as_ref();
    let desired = st.map(|s| s.desired_number_scheduled).unwrap_or(0);
    let ready = st.map(|s| s.number_ready).unwrap_or(0);
    let cells = vec![
        name_cell(ds),
        ns_cell(ds),
        Cell::new(desired.to_string(), Tone::Secondary),
        Cell::new(
            ready.to_string(),
            if ready != desired {
                Tone::Warn
            } else {
                Tone::Secondary
            },
        ),
        Cell::new("—", Tone::Muted), // CPU — filled by overlayMetrics
        Cell::new("—", Tone::Muted), // MEM — filled by overlayMetrics
        age_cell(ds),
    ];
    let mut row = simple_row(ds, cells);
    row.selector = ds
        .spec
        .as_ref()
        .and_then(|s| s.selector.match_labels.clone());
    row
}

/// Jobs: NAME, NAMESPACE, COMPLETIONS, DURATION, AGE.
pub fn map_job(j: &Job) -> Row {
    let completions = j.spec.as_ref().and_then(|s| s.completions).unwrap_or(1);
    let succeeded = j.status.as_ref().and_then(|s| s.succeeded).unwrap_or(0);
    // Duration = completion - start (if both known), else "—".
    let duration = match j.status.as_ref() {
        Some(st) => match (&st.start_time, &st.completion_time) {
            (Some(start), Some(end)) => humanize_duration((end.0 - start.0).num_seconds().max(0)),
            _ => "—".to_string(),
        },
        None => "—".to_string(),
    };
    let complete = succeeded >= completions;
    // Carry ownerReferences so the CronJob Timeline can match Jobs reliably
    // instead of relying on name-prefix heuristics.
    let mut labels = std::collections::BTreeMap::new();
    for owner in j.metadata.owner_references.iter().flatten() {
        if owner.kind == "CronJob" {
            labels.insert("owner.cronjob".to_string(), owner.name.clone());
            break;
        }
    }
    let cells = vec![
        name_cell(j),
        ns_cell(j),
        Cell::new(
            format!("{succeeded}/{completions}"),
            if complete {
                Tone::Secondary
            } else {
                Tone::Warn
            },
        ),
        Cell::new(duration, Tone::Secondary),
        age_cell(j),
    ];
    let mut row = simple_row(j, cells);
    if !labels.is_empty() {
        row.labels = Some(labels);
    }
    row
}

/// CronJobs: NAME, NAMESPACE, SCHEDULE, LAST RUN, AGE.
pub fn map_cronjob(c: &CronJob) -> Row {
    let schedule = c
        .spec
        .as_ref()
        .map(|s| s.schedule.clone())
        .unwrap_or_default();
    let last_run = c
        .status
        .as_ref()
        .and_then(|s| s.last_schedule_time.as_ref())
        .map(|t| format!("{} ago", humanize_duration(secs_since(t))))
        .unwrap_or_else(|| "—".into());
    let cells = vec![
        name_cell(c),
        ns_cell(c),
        Cell::new(schedule, Tone::Secondary),
        Cell::new(last_run, Tone::Secondary),
        age_cell(c),
    ];
    simple_row(c, cells)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A degraded Deployment (0/1) colors the READY cell amber.
    #[test]
    fn degraded_deployment() {
        let dep: Deployment = serde_json::from_value(json!({
            "metadata": { "name": "heimdall", "namespace": "prod", "uid": "d1",
                          "creationTimestamp": "2026-07-15T09:45:00Z" },
            "spec": { "replicas": 1 },
            "status": { "readyReplicas": 0, "updatedReplicas": 1, "availableReplicas": 0 }
        }))
        .unwrap();
        let row = map_deployment(&dep);
        // Columns: NAME,NAMESPACE,READY,UP-TO-DATE,AVAILABLE,AGE
        assert_eq!(row.cells[2].text, "0/1");
        assert_eq!(row.cells[2].tone, Tone::Warn);
        assert_eq!(row.cells[4].tone, Tone::Warn, "0 available with desired>0");
    }

    /// A Deployment carries its pod selector for the "view pods" jump (B33).
    #[test]
    fn deployment_carries_selector() {
        let dep: Deployment = serde_json::from_value(json!({
            "metadata": { "name": "wiki", "namespace": "wiki", "uid": "d2" },
            "spec": { "replicas": 1, "selector": { "matchLabels": { "app": "wiki", "tier": "web" } } },
        }))
        .unwrap();
        let sel = map_deployment(&dep).selector.expect("selector present");
        assert_eq!(sel.get("app").map(String::as_str), Some("wiki"));
        assert_eq!(sel.get("tier").map(String::as_str), Some("web"));
    }

    /// A ReplicaSet at its desired size, and a superseded generation. The point of
    /// the second: 0-desired is normal history, so it must read muted rather than
    /// amber — otherwise every Deployment's old generations look broken.
    #[test]
    fn replicaset_scaled_down_reads_as_history() {
        let rs = |desired: i32, ready: i32| -> ReplicaSet {
            serde_json::from_value(json!({
                "metadata": { "name": "api-6c8d9", "namespace": "prod", "uid": "r1" },
                "spec": { "replicas": desired },
                "status": { "replicas": desired, "readyReplicas": ready },
            }))
            .unwrap()
        };
        // Columns: NAME,NAMESPACE,DESIRED,CURRENT,READY,AGE
        let live = map_replicaset(&rs(2, 2));
        assert_eq!(live.cells[2].text, "2");
        assert_eq!(live.cells[4].tone, Tone::Secondary, "fully ready");

        let degraded = map_replicaset(&rs(2, 1));
        assert_eq!(degraded.cells[4].tone, Tone::Warn, "a shortfall is amber");

        let superseded = map_replicaset(&rs(0, 0));
        assert_eq!(superseded.cells[2].tone, Tone::Muted);
        assert_eq!(
            superseded.cells[4].tone,
            Tone::Muted,
            "0/0 is history, not a fault"
        );
    }
}

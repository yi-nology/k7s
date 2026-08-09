//! Workload properties: Deployments, StatefulSets, Jobs, CronJobs, HPAs.

use super::*;
use crate::error::AppResult;
use k8s_openapi::api::apps::v1::{DaemonSet, Deployment, ReplicaSet, StatefulSet};
use k8s_openapi::api::autoscaling::v2::HorizontalPodAutoscaler;
use k8s_openapi::api::batch::v1::{CronJob, Job};
use k8s_openapi::api::core::v1::{PersistentVolumeClaim, Service};
use kube::api::{Api, ListParams};
use kube::Client;

pub async fn gather_deployment(
    client: Client,
    namespace: &str,
    name: &str,
) -> AppResult<Properties> {
    let api: Api<Deployment> = Api::namespaced(client.clone(), namespace);
    let dep = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
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
                    let surge = ru
                        .max_surge
                        .as_ref()
                        .map(int_or_string)
                        .unwrap_or_else(|| "\u{2014}".into());
                    let unavail = ru
                        .max_unavailable
                        .as_ref()
                        .map(int_or_string)
                        .unwrap_or_else(|| "\u{2014}".into());
                    format!("{type_} (max surge {surge}, max unavailable {unavail})")
                }
                None => type_,
            }
        })
        .unwrap_or_else(|| DASH.into());

    props.fields(
        "Overview",
        vec![
            field_toned(
                "replicas",
                format!("{ready}/{desired} ready"),
                ready_tone(ready, desired),
            ),
            field(
                "up-to-date",
                status.updated_replicas.unwrap_or(0).to_string(),
            ),
            field(
                "available",
                status.available_replicas.unwrap_or(0).to_string(),
            ),
            field_toned(
                "unavailable",
                status.unavailable_replicas.unwrap_or(0).to_string(),
                if status.unavailable_replicas.unwrap_or(0) > 0 {
                    Tone::Warn
                } else {
                    Tone::Secondary
                },
            ),
            field("strategy", strategy),
            field(
                "selector",
                selector_text(spec.selector.match_labels.as_ref()),
            ),
            field(
                "generation",
                dep.metadata.generation.unwrap_or(0).to_string(),
            ),
            field_toned(
                "paused",
                if spec.paused.unwrap_or(false) {
                    "yes"
                } else {
                    "no"
                },
                if spec.paused.unwrap_or(false) {
                    Tone::Warn
                } else {
                    Tone::Secondary
                },
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
                            Some(NavTarget::namespaced(
                                "replicasets",
                                namespace,
                                rs.name_any(),
                            )),
                        ),
                        c(revision_of(rs)
                            .map(|r| r.to_string())
                            .unwrap_or_else(|| DASH.into())),
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

pub async fn gather_statefulset(
    client: Client,
    namespace: &str,
    name: &str,
) -> AppResult<Properties> {
    let api: Api<StatefulSet> = Api::namespaced(client.clone(), namespace);
    let sts = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
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
            Some(NavTarget::namespaced(
                "services",
                namespace,
                svc_name.clone(),
            )),
        ),
        (false, false) => field_toned(
            "service name",
            format!("{svc_name} (not found)"),
            Tone::Warn,
        ),
    };

    let desired = spec.replicas.unwrap_or(1);
    let ready = status.ready_replicas.unwrap_or(0);

    props.fields(
        "Overview",
        vec![
            field_toned(
                "replicas",
                format!("{ready}/{desired} ready"),
                ready_tone(ready, desired),
            ),
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
            field(
                "pod management",
                or_dash(spec.pod_management_policy.clone()),
            ),
            field(
                "selector",
                selector_text(spec.selector.match_labels.as_ref()),
            ),
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
                    c(ts.access_modes
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
                                if phase == "Bound" {
                                    Tone::Good
                                } else {
                                    Tone::Warn
                                },
                            ),
                            c(qty(pst
                                .capacity
                                .as_ref()
                                .and_then(|cap| cap.get("storage")))),
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

pub async fn gather_job(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<Job> = Api::namespaced(client.clone(), namespace);
    let job = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
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
    let cronjob_ref = job.metadata.owner_references.as_ref().and_then(|refs| {
        refs.iter()
            .find(|r| r.controller == Some(true) && r.kind == "CronJob")
    });

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
                cronjob_ref
                    .map(|r| r.name.clone())
                    .unwrap_or_else(|| DASH.into()),
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

pub async fn gather_cronjob(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<CronJob> = Api::namespaced(client.clone(), namespace);
    let cj = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = cj.spec.clone().unwrap_or_default();
    let status = cj.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    let suspend = spec.suspend.unwrap_or(false);
    props.fields(
        "Overview",
        vec![
            field("schedule", spec.schedule.clone()),
            field(
                "concurrency policy",
                spec.concurrency_policy
                    .clone()
                    .unwrap_or_else(|| "Allow".into()),
            ),
            field("suspend", if suspend { "yes" } else { "no" }),
            field(
                "successful jobs",
                spec.successful_jobs_history_limit
                    .map(|n| n.to_string())
                    .unwrap_or_else(|| DASH.into()),
            ),
            field(
                "failed jobs",
                spec.failed_jobs_history_limit
                    .map(|n| n.to_string())
                    .unwrap_or_else(|| DASH.into()),
            ),
            field(
                "starting deadline",
                spec.starting_deadline_seconds
                    .map(|n| format!("{n}s"))
                    .unwrap_or_else(|| DASH.into()),
            ),
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
                                .or(s.start_time.as_ref())
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

pub async fn gather_hpa(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<HorizontalPodAutoscaler> = Api::namespaced(client, namespace);
    let hpa = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = hpa.spec.clone().unwrap_or_default();
    let status = hpa.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    let target = spec.scale_target_ref;
    let target_kind = target.kind.clone();
    let target_name = target.name.clone();
    let target_nav = builtin_nav_id(&target_kind).map(|nav_id| {
        let ns = (nav_id != "nodes").then(|| namespace.to_string());
        NavTarget {
            kind: nav_id.into(),
            namespace: ns,
            name: target_name.clone(),
        }
    });

    props.fields(
        "Overview",
        vec![
            nav_field("target", format!("{target_kind}/{target_name}"), target_nav),
            field(
                "min replicas",
                spec.min_replicas
                    .map(|n| n.to_string())
                    .unwrap_or_else(|| DASH.into()),
            ),
            field("max replicas", spec.max_replicas.to_string()),
            field(
                "current replicas",
                status
                    .current_replicas
                    .map(|n| n.to_string())
                    .unwrap_or_else(|| DASH.into()),
            ),
            field("desired replicas", status.desired_replicas.to_string()),
        ],
    );

    // ---- metrics ----
    let metric_rows: Vec<Vec<Cell>> = status
        .current_metrics
        .iter()
        .flatten()
        .map(|m| {
            let type_ = m.type_.clone();
            let (resource_name, current, target_val) = match &m.resource {
                Some(r) => {
                    let name = r.name.clone();
                    let current = r
                        .current
                        .average_utilization
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

// ---- DaemonSet ----

pub async fn gather_daemonset(
    client: Client,
    namespace: &str,
    name: &str,
) -> AppResult<Properties> {
    let api: Api<DaemonSet> = Api::namespaced(client.clone(), namespace);
    let ds = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = ds.spec.clone().unwrap_or_default();
    let status = ds.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    let desired = status.desired_number_scheduled;
    let ready = status.number_ready;
    let available = status.number_available.unwrap_or(0);
    let unavailable = status.number_unavailable.unwrap_or(0);

    props.fields(
        "Overview",
        vec![
            field_toned(
                "pods",
                format!("{ready}/{desired} ready"),
                ready_tone(ready, desired),
            ),
            field("scheduled", status.current_number_scheduled.to_string()),
            field("available", available.to_string()),
            field_toned(
                "unavailable",
                unavailable.to_string(),
                if unavailable > 0 { Tone::Warn } else { Tone::Secondary },
            ),
            field(
                "selector",
                selector_text(spec.selector.match_labels.as_ref()),
            ),
            field("update strategy", spec.update_strategy.as_ref().map(|s| {
                s.type_.clone().unwrap_or_else(|| "RollingUpdate".into())
            }).unwrap_or_else(|| DASH.into())),
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

    meta_sections(&mut props, &ds);
    Ok(props)
}

// ---- ReplicaSet ----

pub async fn gather_replicaset(
    client: Client,
    namespace: &str,
    name: &str,
) -> AppResult<Properties> {
    let api: Api<ReplicaSet> = Api::namespaced(client.clone(), namespace);
    let rs = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = rs.spec.clone().unwrap_or_default();
    let status = rs.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    let desired = spec.replicas.unwrap_or(1);
    let ready = status.ready_replicas.unwrap_or(0);
    let available = status.available_replicas.unwrap_or(0);

    props.fields(
        "Overview",
        vec![
            field_toned(
                "replicas",
                format!("{ready}/{desired} ready"),
                ready_tone(ready, desired),
            ),
            field("available", available.to_string()),
            field("fully labeled", status.fully_labeled_replicas.unwrap_or(0).to_string()),
            field(
                "selector",
                selector_text(spec.selector.match_labels.as_ref()),
            ),
        ],
    );

    // Owner references (usually a Deployment)
    let owners: Vec<Vec<String>> = rs
        .metadata
        .owner_references
        .as_ref()
        .map(|refs| {
            refs.iter()
                .map(|r| vec![r.kind.clone(), r.name.clone()])
                .collect()
        })
        .unwrap_or_default();
    if !owners.is_empty() {
        props.push_table("Owner References", None, &["KIND", "NAME"], owners);
    }

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

    meta_sections(&mut props, &rs);
    Ok(props)
}

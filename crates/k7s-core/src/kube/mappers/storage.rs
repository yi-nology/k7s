//! Storage mapping: PersistentVolumeClaim, PersistentVolume, StorageClass.

use super::*;
use k7s_deps::k8s_openapi::api::core::v1::{PersistentVolume, PersistentVolumeClaim};
use k7s_deps::k8s_openapi::api::storage::v1::StorageClass;
use k7s_deps::kube::ResourceExt;

/// Access modes in kubectl's shorthand: RWO / ROX / RWX / RWOP, comma-joined.
/// An unrecognised mode passes through verbatim rather than being dropped.
fn access_modes(modes: Option<&Vec<String>>) -> String {
    let short = |m: &String| match m.as_str() {
        "ReadWriteOnce" => "RWO".to_string(),
        "ReadOnlyMany" => "ROX".to_string(),
        "ReadWriteMany" => "RWX".to_string(),
        "ReadWriteOncePod" => "RWOP".to_string(),
        other => other.to_string(),
    };
    match modes {
        Some(ms) if !ms.is_empty() => ms.iter().map(short).collect::<Vec<_>>().join(","),
        _ => "—".to_string(),
    }
}

/// Tone for a PersistentVolumeClaim phase. Unlike the shared `status_tone`, an
/// unknown phase here is a warning rather than an error: a claim in an
/// unrecognised state is odd, not necessarily broken.
fn pvc_tone(phase: &str) -> Tone {
    match phase {
        "Bound" => Tone::Good,
        // A Pending claim is the normal resting state for WaitForFirstConsumer
        // binding — it's waiting for a pod, not failing.
        "Pending" => Tone::Warn,
        "Lost" => Tone::Bad,
        _ => Tone::Warn,
    }
}

/// Tone for a PersistentVolume phase. `Available` is healthy-but-unclaimed, which
/// is why this can't reuse the shared `status_tone` (whose catch-all is red).
fn pv_tone(phase: &str) -> Tone {
    match phase {
        "Bound" => Tone::Good,
        // Provisioned and waiting for a claim: idle, not a problem.
        "Available" => Tone::Secondary,
        // Its claim is gone but the volume (and its data) still exists — it needs
        // a decision, so it reads amber rather than green or red.
        "Released" | "Pending" => Tone::Warn,
        "Failed" => Tone::Bad,
        _ => Tone::Warn,
    }
}

/// PersistentVolumeClaims: NAME, NAMESPACE, STATUS, VOLUME, CAPACITY, ACCESS,
/// CLASS, AGE.
pub fn map_pvc(pvc: &PersistentVolumeClaim) -> Row {
    let spec = pvc.spec.as_ref();
    let status = pvc.status.as_ref();
    let phase = status
        .and_then(|s| s.phase.clone())
        .unwrap_or_else(|| "Pending".into());
    let tone = pvc_tone(&phase);

    // Bound capacity is authoritative; a Pending claim has none yet, so fall back
    // to what it asked for — otherwise the column is empty exactly when you're
    // looking to see how big the claim was.
    let capacity = status
        .and_then(|s| s.capacity.as_ref())
        .and_then(|c| c.get("storage"))
        .or_else(|| {
            spec.and_then(|s| s.resources.as_ref())
                .and_then(|r| r.requests.as_ref())
                .and_then(|r| r.get("storage"))
        })
        .map(|q| q.0.clone())
        .unwrap_or_else(|| "—".into());

    let cells = vec![
        name_cell(pvc),
        ns_cell(pvc),
        Cell::status(&phase, tone),
        Cell::new(
            spec.and_then(|s| s.volume_name.clone())
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| "—".into()),
            Tone::Secondary,
        ),
        Cell::new(capacity, Tone::Secondary),
        Cell::new(
            access_modes(spec.and_then(|s| s.access_modes.as_ref())),
            Tone::Secondary,
        ),
        Cell::new(
            spec.and_then(|s| s.storage_class_name.clone())
                .unwrap_or_else(|| "—".into()),
            Tone::Secondary,
        ),
        age_cell(pvc),
    ];
    simple_row(pvc, cells)
}

/// PersistentVolumes: NAME, CAPACITY, ACCESS, RECLAIM, STATUS, CLAIM, CLASS, AGE.
/// Cluster-scoped, so no NAMESPACE column — the CLAIM carries "namespace/name".
pub fn map_pv(pv: &PersistentVolume) -> Row {
    let spec = pv.spec.as_ref();
    let phase = pv
        .status
        .as_ref()
        .and_then(|s| s.phase.clone())
        .unwrap_or_else(|| "Pending".into());
    let tone = pv_tone(&phase);

    let capacity = spec
        .and_then(|s| s.capacity.as_ref())
        .and_then(|c| c.get("storage"))
        .map(|q| q.0.clone())
        .unwrap_or_else(|| "—".into());

    // The bound claim, as kubectl shows it: "namespace/name".
    let claim = spec
        .and_then(|s| s.claim_ref.as_ref())
        .map(|c| {
            format!(
                "{}/{}",
                c.namespace.clone().unwrap_or_default(),
                c.name.clone().unwrap_or_default()
            )
        })
        .unwrap_or_else(|| "—".into());

    let cells = vec![
        name_cell(pv),
        Cell::new(capacity, Tone::Secondary),
        Cell::new(
            access_modes(spec.and_then(|s| s.access_modes.as_ref())),
            Tone::Secondary,
        ),
        Cell::new(
            spec.and_then(|s| s.persistent_volume_reclaim_policy.clone())
                .unwrap_or_else(|| "—".into()),
            Tone::Secondary,
        ),
        Cell::status(&phase, tone),
        Cell::new(claim, Tone::Secondary),
        Cell::new(
            spec.and_then(|s| s.storage_class_name.clone())
                .filter(|c| !c.is_empty())
                .unwrap_or_else(|| "—".into()),
            Tone::Secondary,
        ),
        age_cell(pv),
    ];
    Row {
        uid: uid_of(pv),
        name: pv.name_any(),
        namespace: None,
        cells,
        ..Default::default()
    }
}

/// The annotation marking a StorageClass as the cluster default.
const DEFAULT_CLASS_ANNOTATION: &str = "storageclass.kubernetes.io/is-default-class";

/// StorageClasses: NAME, PROVISIONER, RECLAIM, BINDING, EXPANSION, AGE.
/// Cluster-scoped. The default class is marked in the name, as kubectl does —
/// which class a claim gets when it names none is the question you open this to
/// answer.
pub fn map_storageclass(sc: &StorageClass) -> Row {
    let is_default = sc
        .metadata
        .annotations
        .as_ref()
        .and_then(|a| a.get(DEFAULT_CLASS_ANNOTATION))
        .is_some_and(|v| v == "true");
    let name = if is_default {
        format!("{} (default)", sc.name_any())
    } else {
        sc.name_any()
    };

    let cells = vec![
        Cell::new(name, Tone::Primary),
        Cell::new(sc.provisioner.clone(), Tone::Secondary),
        Cell::new(
            sc.reclaim_policy.clone().unwrap_or_else(|| "Delete".into()),
            Tone::Secondary,
        ),
        Cell::new(
            sc.volume_binding_mode
                .clone()
                .unwrap_or_else(|| "Immediate".into()),
            Tone::Secondary,
        ),
        Cell::new(
            match sc.allow_volume_expansion {
                Some(true) => "true",
                _ => "false",
            },
            Tone::Secondary,
        ),
        age_cell(sc),
    ];
    Row {
        uid: uid_of(sc),
        name: sc.name_any(),
        namespace: None,
        cells,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use k7s_deps::serde_json::json;

    /// A bound claim: columns NAME,NAMESPACE,STATUS,VOLUME,CAPACITY,ACCESS,CLASS,AGE,
    /// status green with a dot, access modes in kubectl's shorthand.
    #[test]
    fn bound_pvc_columns() {
        let pvc: PersistentVolumeClaim = k7s_deps::serde_json::from_value(json!({
            "metadata": { "name": "wiki-postgres-data", "namespace": "wiki", "uid": "c1" },
            "spec": { "volumeName": "pvc-5a948cc3", "storageClassName": "local-path",
                      "accessModes": ["ReadWriteOnce"],
                      "resources": { "requests": { "storage": "5Gi" } } },
            "status": { "phase": "Bound", "capacity": { "storage": "5Gi" } },
        }))
        .unwrap();
        let row = map_pvc(&pvc);
        assert_eq!(row.cells[2].text, "Bound");
        assert_eq!(row.cells[2].tone, Tone::Good);
        assert!(row.cells[2].dot);
        assert_eq!(row.cells[3].text, "pvc-5a948cc3");
        assert_eq!(row.cells[4].text, "5Gi");
        assert_eq!(
            row.cells[5].text, "RWO",
            "access modes use kubectl's shorthand"
        );
        assert_eq!(row.cells[6].text, "local-path");
    }

    /// A Pending claim has no bound capacity yet, so the column falls back to the
    /// *requested* size — otherwise it's blank exactly when you want to know how
    /// big the claim was.
    #[test]
    fn pending_pvc_shows_requested_capacity() {
        let pvc: PersistentVolumeClaim = k7s_deps::serde_json::from_value(json!({
            "metadata": { "name": "reports", "namespace": "prod", "uid": "c2" },
            "spec": { "accessModes": ["ReadWriteMany"],
                      "resources": { "requests": { "storage": "100Gi" } } },
            "status": { "phase": "Pending" },
        }))
        .unwrap();
        let row = map_pvc(&pvc);
        assert_eq!(
            row.cells[2].tone,
            Tone::Warn,
            "Pending is a wait, not a failure"
        );
        assert_eq!(row.cells[3].text, "—", "no volume bound yet");
        assert_eq!(row.cells[4].text, "100Gi", "falls back to the request");
        assert_eq!(row.cells[5].text, "RWX");
    }

    /// A bound volume: cluster-scoped (no namespace), and CLAIM reads
    /// "namespace/name" the way kubectl prints it.
    #[test]
    fn bound_pv_columns() {
        let pv: PersistentVolume = k7s_deps::serde_json::from_value(json!({
            "metadata": { "name": "pvc-5a948cc3", "uid": "v1" },
            "spec": { "capacity": { "storage": "5Gi" }, "accessModes": ["ReadWriteOnce"],
                      "persistentVolumeReclaimPolicy": "Delete", "storageClassName": "local-path",
                      "claimRef": { "namespace": "wiki", "name": "wiki-postgres-data" } },
            "status": { "phase": "Bound" },
        }))
        .unwrap();
        let row = map_pv(&pv);
        // Columns: NAME,CAPACITY,ACCESS,RECLAIM,STATUS,CLAIM,CLASS,AGE
        assert_eq!(row.namespace, None, "PVs are cluster-scoped");
        assert_eq!(row.cells[1].text, "5Gi");
        assert_eq!(row.cells[3].text, "Delete");
        assert_eq!(row.cells[4].text, "Bound");
        assert_eq!(row.cells[4].tone, Tone::Good);
        assert_eq!(row.cells[5].text, "wiki/wiki-postgres-data");
    }

    /// PV phases the *shared* status_tone would get wrong: an Available volume is
    /// idle (not an error), and a Released one needs a decision (amber, not red).
    /// That divergence is why PVs carry their own tone function.
    #[test]
    fn pv_phase_tones_differ_from_the_shared_helper() {
        let pv_with = |phase: &str| -> Row {
            let pv: PersistentVolume = k7s_deps::serde_json::from_value(json!({
                "metadata": { "name": "v", "uid": "u" },
                "spec": { "capacity": { "storage": "1Gi" } },
                "status": { "phase": phase },
            }))
            .unwrap();
            map_pv(&pv)
        };
        assert_eq!(pv_with("Available").cells[4].tone, Tone::Secondary);
        assert_eq!(pv_with("Released").cells[4].tone, Tone::Warn);
        assert_eq!(pv_with("Failed").cells[4].tone, Tone::Bad);
        // The shared helper would have called both of these failures.
        assert_eq!(status_tone("Available"), Tone::Bad);
        assert_eq!(status_tone("Released"), Tone::Bad);
    }

    /// Multiple access modes join, and an unknown mode passes through rather than
    /// being silently dropped.
    #[test]
    fn access_mode_shorthand() {
        assert_eq!(access_modes(Some(&vec!["ReadWriteOnce".into()])), "RWO");
        assert_eq!(
            access_modes(Some(&vec!["ReadOnlyMany".into(), "ReadWriteMany".into()])),
            "ROX,RWX"
        );
        assert_eq!(access_modes(Some(&vec!["ReadWriteOncePod".into()])), "RWOP");
        assert_eq!(access_modes(Some(&vec!["FutureMode".into()])), "FutureMode");
        assert_eq!(access_modes(None), "—");
    }

    /// The default StorageClass is marked in the NAME the way kubectl does — which
    /// class a claim gets when it names none is what you open this table to learn.
    /// The row's `name` stays the bare object name.
    #[test]
    fn storageclass_marks_the_default() {
        let sc = |default: bool| -> StorageClass {
            k7s_deps::serde_json::from_value(json!({
                "metadata": { "name": "local-path", "uid": "s1",
                              "annotations": if default {
                                  json!({ "storageclass.kubernetes.io/is-default-class": "true" })
                              } else { json!({}) } },
                "provisioner": "rancher.io/local-path",
                "reclaimPolicy": "Delete",
                "volumeBindingMode": "WaitForFirstConsumer",
            }))
            .unwrap()
        };
        let row = map_storageclass(&sc(true));
        assert_eq!(row.cells[0].text, "local-path (default)");
        assert_eq!(
            row.name, "local-path",
            "identity is the real name, not the label"
        );
        assert_eq!(row.namespace, None, "StorageClasses are cluster-scoped");
        assert_eq!(row.cells[1].text, "rancher.io/local-path");
        assert_eq!(row.cells[3].text, "WaitForFirstConsumer");
        // Defaults when the fields are absent.
        assert_eq!(row.cells[4].text, "false", "expansion absent -> false");

        assert_eq!(map_storageclass(&sc(false)).cells[0].text, "local-path");
    }
}

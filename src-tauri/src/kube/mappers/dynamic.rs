//! Dynamic/CRD mapping: DynamicObject, PDB, Webhooks, APIService, HPA, ResourceQuota, LimitRange.
//!
//! We use the dynamic `DynamicObject` mapper path because each of these
//! kinds pulls from a different API group (networking.k8s.io,
//! autoscaling, core) and we don't want a separate k8s-openapi typed
//! mapper per kind — the columns are uniformly name + namespace + age,
//! and any deeper columns would be a separate feature.

use super::*;
use kube::core::DynamicObject;
use kube::ResourceExt;

/// Generic columns for a CRD-backed object: NAME, NAMESPACE (namespaced kinds
/// only), AGE.
///
/// A CRD's schema is arbitrary, so there is no meaningful status or ready column
/// to derive without per-CRD knowledge; the YAML tab is where the detail lives.
/// The column set must match `kinds.ts`'s generic custom columns.
pub fn map_dynamic(o: &kube::core::DynamicObject, namespaced: bool) -> Row {
    let mut cells = vec![Cell::new(o.name_any(), Tone::Primary)];
    if namespaced {
        cells.push(Cell::new(o.namespace().unwrap_or_default(), Tone::Muted));
    }
    cells.push(Cell::age(o.creation_timestamp().map(|t| t.0.to_string())));

    Row {
        uid: uid_of(o),
        name: o.name_any(),
        namespace: o.namespace(),
        cells,
        ..Default::default()
    }
}

/// PodDisruptionBudget: NAME, NAMESPACE, MIN AVAILABLE, MAX UNAVAILABLE, ALLOWED DISRUPTIONS, AGE.
pub fn map_pdb(obj: &DynamicObject) -> Row {
    let min_avail = json_value_to_string(obj.data.get("spec").and_then(|s| s.get("minAvailable")));
    let max_unavail =
        json_value_to_string(obj.data.get("spec").and_then(|s| s.get("maxUnavailable")));
    let allowed = obj
        .data
        .get("status")
        .and_then(|s| s.get("disruptionsAllowed"))
        .and_then(|v| v.as_i64())
        .map(|n| n.to_string())
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
        Cell::new(min_avail, Tone::Secondary),
        Cell::new(max_unavail, Tone::Secondary),
        Cell::new(allowed, Tone::Secondary),
        Cell::age(Some(age).filter(|s| !s.is_empty())),
    ];
    Row {
        uid: format!(
            "poddisruptionbudget:{}/{}",
            obj.namespace().unwrap_or_default(),
            obj.name_any()
        ),
        name: obj.name_any(),
        namespace: Some(obj.namespace().unwrap_or_default()),
        cells,
        ..Default::default()
    }
}

/// MutatingWebhookConfiguration: NAME, WEBHOOKS, AGE.
pub fn map_mutating_webhook(obj: &DynamicObject) -> Row {
    let webhook_count = obj
        .data
        .get("webhooks")
        .and_then(|w| w.as_array())
        .map(|a| a.len().to_string())
        .unwrap_or_else(|| "0".to_string());
    let age = obj
        .metadata
        .creation_timestamp
        .as_ref()
        .map(|t| t.0.to_string())
        .unwrap_or_default();
    let cells = vec![
        Cell::new(obj.name_any(), Tone::Primary),
        Cell::new(webhook_count, Tone::Secondary),
        Cell::age(Some(age).filter(|s| !s.is_empty())),
    ];
    Row {
        uid: format!("mutatingwebhookconfiguration:{}", obj.name_any()),
        name: obj.name_any(),
        namespace: None,
        cells,
        ..Default::default()
    }
}

/// ValidatingWebhookConfiguration: NAME, WEBHOOKS, AGE.
pub fn map_validating_webhook(obj: &DynamicObject) -> Row {
    let webhook_count = obj
        .data
        .get("webhooks")
        .and_then(|w| w.as_array())
        .map(|a| a.len().to_string())
        .unwrap_or_else(|| "0".to_string());
    let age = obj
        .metadata
        .creation_timestamp
        .as_ref()
        .map(|t| t.0.to_string())
        .unwrap_or_default();
    let cells = vec![
        Cell::new(obj.name_any(), Tone::Primary),
        Cell::new(webhook_count, Tone::Secondary),
        Cell::age(Some(age).filter(|s| !s.is_empty())),
    ];
    Row {
        uid: format!("validatingwebhookconfiguration:{}", obj.name_any()),
        name: obj.name_any(),
        namespace: None,
        cells,
        ..Default::default()
    }
}

/// APIService: NAME, SERVICE, AVAILABLE, AGE.
pub fn map_api_service(obj: &DynamicObject) -> Row {
    let svc = obj
        .data
        .get("spec")
        .and_then(|s| s.get("service"))
        .map(|svc| {
            let ns = svc.get("namespace").and_then(|v| v.as_str()).unwrap_or("");
            let name = svc.get("name").and_then(|v| v.as_str()).unwrap_or("?");
            if ns.is_empty() {
                name.to_string()
            } else {
                format!("{ns}/{name}")
            }
        })
        .unwrap_or_else(|| "—".to_string());
    let available = obj
        .data
        .get("status")
        .and_then(|s| s.get("conditions"))
        .and_then(|c| c.as_array())
        .and_then(|conds| {
            conds
                .iter()
                .find(|c| c.get("type").and_then(|t| t.as_str()) == Some("Available"))
        })
        .and_then(|c| c.get("status").and_then(|s| s.as_str()))
        .unwrap_or("Unknown");
    let tone = if available == "True" {
        Tone::Good
    } else if available == "False" {
        Tone::Bad
    } else {
        Tone::Warn
    };
    let age = obj
        .metadata
        .creation_timestamp
        .as_ref()
        .map(|t| t.0.to_string())
        .unwrap_or_default();
    let cells = vec![
        Cell::new(obj.name_any(), Tone::Primary),
        Cell::new(svc, Tone::Secondary),
        Cell::new(available.to_string(), tone),
        Cell::age(Some(age).filter(|s| !s.is_empty())),
    ];
    Row {
        uid: format!("apiservice:{}", obj.name_any()),
        name: obj.name_any(),
        namespace: None,
        cells,
        ..Default::default()
    }
}

/// HorizontalPodAutoscaler: NAME, NAMESPACE, TARGET, MIN, MAX, REPLICAS, AGE.
pub fn map_hpa(obj: &DynamicObject) -> Row {
    let target = obj
        .data
        .get("spec")
        .and_then(|s| s.get("scaleTargetRef"))
        .map(|t| {
            let kind = t.get("kind").and_then(|v| v.as_str()).unwrap_or("?");
            let name = t.get("name").and_then(|v| v.as_str()).unwrap_or("?");
            format!("{kind}/{name}")
        })
        .unwrap_or_else(|| "—".to_string());
    let min = obj
        .data
        .get("spec")
        .and_then(|s| s.get("minReplicas"))
        .and_then(|v| v.as_i64())
        .map(|n| n.to_string())
        .unwrap_or_else(|| "—".to_string());
    let max = obj
        .data
        .get("spec")
        .and_then(|s| s.get("maxReplicas"))
        .and_then(|v| v.as_i64())
        .map(|n| n.to_string())
        .unwrap_or_else(|| "—".to_string());
    let replicas = obj
        .data
        .get("status")
        .and_then(|s| s.get("currentReplicas"))
        .and_then(|v| v.as_i64())
        .map(|n| n.to_string())
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
        Cell::new(target, Tone::Secondary),
        Cell::new(min, Tone::Secondary),
        Cell::new(max, Tone::Secondary),
        Cell::new(replicas, Tone::Secondary),
        Cell::age(Some(age).filter(|s| !s.is_empty())),
    ];
    Row {
        uid: format!(
            "horizontalpodautoscaler:{}/{}",
            obj.namespace().unwrap_or_default(),
            obj.name_any()
        ),
        name: obj.name_any(),
        namespace: Some(obj.namespace().unwrap_or_default()),
        cells,
        ..Default::default()
    }
}

/// ResourceQuota: NAME, NAMESPACE, HARD, USED, AGE.
pub fn map_resourcequota(obj: &DynamicObject) -> Row {
    let hard = obj
        .data
        .get("status")
        .and_then(|s| s.get("hard"))
        .map(|h| serde_json::to_string(h).unwrap_or_default())
        .unwrap_or_else(|| "—".to_string());
    let used = obj
        .data
        .get("status")
        .and_then(|s| s.get("used"))
        .map(|u| serde_json::to_string(u).unwrap_or_default())
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
        Cell::new(hard, Tone::Secondary),
        Cell::new(used, Tone::Secondary),
        Cell::age(Some(age).filter(|s| !s.is_empty())),
    ];
    Row {
        uid: format!(
            "resourcequota:{}/{}",
            obj.namespace().unwrap_or_default(),
            obj.name_any()
        ),
        name: obj.name_any(),
        namespace: Some(obj.namespace().unwrap_or_default()),
        cells,
        ..Default::default()
    }
}

/// LimitRange: NAME, NAMESPACE, LIMITS, AGE.
pub fn map_limitrange(obj: &DynamicObject) -> Row {
    let limits = obj
        .data
        .get("spec")
        .and_then(|s| s.get("limits"))
        .map(|l| serde_json::to_string(l).unwrap_or_default())
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
        Cell::new(limits, Tone::Secondary),
        Cell::age(Some(age).filter(|s| !s.is_empty())),
    ];
    Row {
        uid: format!(
            "limitrange:{}/{}",
            obj.namespace().unwrap_or_default(),
            obj.name_any()
        ),
        name: obj.name_any(),
        namespace: Some(obj.namespace().unwrap_or_default()),
        cells,
        ..Default::default()
    }
}

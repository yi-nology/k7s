//! RBAC mapping: Role, ClusterRole, RoleBinding, ClusterRoleBinding (DynamicObject-based).

use super::*;
use kube::core::DynamicObject;
use kube::ResourceExt;

/// Role: NAME, NAMESPACE, AGE. Namespaced permission rule.
pub fn map_role(obj: &DynamicObject) -> Row {
    let age = obj
        .metadata
        .creation_timestamp
        .as_ref()
        .map(|t| t.0.to_rfc3339())
        .unwrap_or_default();
    let cells = vec![
        Cell::new(obj.name_any(), Tone::Primary),
        Cell::new(obj.namespace().unwrap_or_default(), Tone::Muted),
        Cell::age(Some(age).filter(|s| !s.is_empty())),
    ];
    Row {
        uid: format!(
            "role:{}/{}",
            obj.namespace().unwrap_or_default(),
            obj.name_any()
        ),
        name: obj.name_any(),
        namespace: Some(obj.namespace().unwrap_or_default()),
        cells,
        ..Default::default()
    }
}

/// ClusterRole: NAME, AGE. Cluster-scoped permission rule.
pub fn map_clusterrole(obj: &DynamicObject) -> Row {
    let age = obj
        .metadata
        .creation_timestamp
        .as_ref()
        .map(|t| t.0.to_rfc3339())
        .unwrap_or_default();
    let cells = vec![
        Cell::new(obj.name_any(), Tone::Primary),
        Cell::age(Some(age).filter(|s| !s.is_empty())),
    ];
    Row {
        uid: format!("clusterrole:{}", obj.name_any()),
        name: obj.name_any(),
        namespace: None,
        cells,
        ..Default::default()
    }
}

/// RoleBinding: NAME, NAMESPACE, ROLE, AGE. Namespaced; references a Role or ClusterRole.
pub fn map_rolebinding(obj: &DynamicObject) -> Row {
    let role_ref = obj
        .data
        .get("roleRef")
        .and_then(|r| r.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();
    let age = obj
        .metadata
        .creation_timestamp
        .as_ref()
        .map(|t| t.0.to_rfc3339())
        .unwrap_or_default();
    let cells = vec![
        Cell::new(obj.name_any(), Tone::Primary),
        Cell::new(obj.namespace().unwrap_or_default(), Tone::Muted),
        Cell::new(role_ref, Tone::Secondary),
        Cell::age(Some(age).filter(|s| !s.is_empty())),
    ];
    Row {
        uid: format!(
            "rolebinding:{}/{}",
            obj.namespace().unwrap_or_default(),
            obj.name_any()
        ),
        name: obj.name_any(),
        namespace: Some(obj.namespace().unwrap_or_default()),
        cells,
        ..Default::default()
    }
}

/// ClusterRoleBinding: NAME, ROLE, AGE. Cluster-scoped; references a ClusterRole.
pub fn map_clusterrolebinding(obj: &DynamicObject) -> Row {
    let role_ref = obj
        .data
        .get("roleRef")
        .and_then(|r| r.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();
    let age = obj
        .metadata
        .creation_timestamp
        .as_ref()
        .map(|t| t.0.to_rfc3339())
        .unwrap_or_default();
    let cells = vec![
        Cell::new(obj.name_any(), Tone::Primary),
        Cell::new(role_ref, Tone::Secondary),
        Cell::age(Some(age).filter(|s| !s.is_empty())),
    ];
    Row {
        uid: format!("clusterrolebinding:{}", obj.name_any()),
        name: obj.name_any(),
        namespace: None,
        cells,
        ..Default::default()
    }
}

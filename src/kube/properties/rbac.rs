//! RBAC properties: Roles, ClusterRoles, RoleBindings, ClusterRoleBindings.

use super::*;
use crate::error::AppResult;
use k7s_deps::k8s_openapi::api::rbac::v1::{ClusterRole, ClusterRoleBinding, Role, RoleBinding};
use k7s_deps::kube::api::Api;
use k7s_deps::kube::Client;

pub(super) async fn gather_role(
    client: Client,
    namespace: &str,
    name: &str,
) -> AppResult<Properties> {
    let api: Api<Role> = Api::namespaced(client, namespace);
    let role = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let mut props = Properties::default();

    props.fields(
        "Overview",
        vec![field(
            "name",
            role.metadata.name.clone().unwrap_or_else(|| DASH.into()),
        )],
    );

    let rule_rows: Vec<Vec<Cell>> = role
        .rules
        .iter()
        .flatten()
        .map(|r| {
            vec![
                c(r.verbs.join(", ")),
                c(r.api_groups
                    .iter()
                    .flatten()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")),
                c(r.resources
                    .iter()
                    .flatten()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")),
                c(r.resource_names
                    .iter()
                    .flatten()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")),
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

pub(super) async fn gather_clusterrole(client: Client, name: &str) -> AppResult<Properties> {
    let api: Api<ClusterRole> = Api::all(client);
    let role = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let mut props = Properties::default();

    props.fields(
        "Overview",
        vec![
            field(
                "name",
                role.metadata.name.clone().unwrap_or_else(|| DASH.into()),
            ),
            field(
                "aggregation",
                role.aggregation_rule
                    .as_ref()
                    .and_then(|ar| ar.cluster_role_selectors.as_ref())
                    .map(|sels| {
                        sels.iter()
                            .map(|s| selector_text(s.match_labels.as_ref()))
                            .collect::<Vec<_>>()
                            .join("; ")
                    })
                    .unwrap_or_else(|| DASH.into()),
            ),
        ],
    );

    let rule_rows: Vec<Vec<Cell>> = role
        .rules
        .iter()
        .flatten()
        .map(|r| {
            vec![
                c(r.verbs.join(", ")),
                c(r.api_groups
                    .iter()
                    .flatten()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")),
                c(r.resources
                    .iter()
                    .flatten()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")),
                c(r.resource_names
                    .iter()
                    .flatten()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")),
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

pub(super) async fn gather_rolebinding(
    client: Client,
    namespace: &str,
    name: &str,
) -> AppResult<Properties> {
    let api: Api<RoleBinding> = Api::namespaced(client.clone(), namespace);
    let rb = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let binding_ns = namespace;
    let mut props = Properties::default();

    let role_nav = match rb.role_ref.kind.as_str() {
        "Role" => Some(NavTarget::namespaced(
            "roles",
            binding_ns,
            rb.role_ref.name.clone(),
        )),
        "ClusterRole" => Some(NavTarget::cluster("clusterroles", rb.role_ref.name.clone())),
        _ => None,
    };

    props.fields(
        "Overview",
        vec![
            field(
                "name",
                rb.metadata.name.clone().unwrap_or_else(|| DASH.into()),
            ),
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

pub(super) async fn gather_clusterrolebinding(client: Client, name: &str) -> AppResult<Properties> {
    let api: Api<ClusterRoleBinding> = Api::all(client);
    let crb = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let mut props = Properties::default();

    let role_nav = match crb.role_ref.kind.as_str() {
        "ClusterRole" => Some(NavTarget::cluster(
            "clusterroles",
            crb.role_ref.name.clone(),
        )),
        // A ClusterRoleBinding can technically reference a Role, but that's unusual.
        _ => None,
    };

    props.fields(
        "Overview",
        vec![
            field(
                "name",
                crb.metadata.name.clone().unwrap_or_else(|| DASH.into()),
            ),
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
                // ClusterRoleBindings reference a ServiceAccount; the SA is
                // always in a namespace (ClusterRoleBindings don't set one).
                let sa_ns = if ns.is_empty() { "default" } else { &ns };
                Some(NavTarget::namespaced(
                    "serviceaccounts",
                    sa_ns,
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

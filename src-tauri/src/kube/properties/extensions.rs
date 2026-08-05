//! Extension properties: PDBs, Webhooks, APIServices, CRDs.

use super::*;
use crate::error::AppResult;
use k8s_openapi::apiextensions_apiserver::pkg::apis::apiextensions::v1::CustomResourceDefinition;
use kube::api::Api;
use kube::core::DynamicObject;
use kube::Client;

pub(super) async fn gather_pdb(
    client: Client,
    namespace: &str,
    name: &str,
) -> AppResult<Properties> {
    let api: Api<DynamicObject> = Api::namespaced_with(
        client.clone(),
        namespace,
        &ResourceKind::Poddisruptionbudgets.api_resource(),
    );
    let obj = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = obj.data.get("spec");
    let status = obj.data.get("status");

    let min_avail = spec
        .and_then(|s| s.get("minAvailable"))
        .map(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| v.as_i64().map(|n| n.to_string()))
                .unwrap_or_else(|| "\u{2014}".into())
        })
        .unwrap_or_else(|| "\u{2014}".into());
    let max_unavail = spec
        .and_then(|s| s.get("maxUnavailable"))
        .map(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| v.as_i64().map(|n| n.to_string()))
                .unwrap_or_else(|| "\u{2014}".into())
        })
        .unwrap_or_else(|| "\u{2014}".into());
    let selector = spec
        .and_then(|s| s.get("selector"))
        .and_then(|s| s.get("matchLabels"))
        .and_then(|m| m.as_object())
        .map(|m| {
            m.iter()
                .map(|(k, v)| format!("{k}={}", v.as_str().unwrap_or("?")))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_else(|| "\u{2014}".into());

    let mut props = Properties::default();
    props.fields(
        "Overview",
        vec![
            field("Min Available", min_avail),
            field("Max Unavailable", max_unavail),
            field("Selector", selector),
        ],
    );

    if let Some(st) = status {
        let current = st
            .get("currentHealthy")
            .and_then(|v| v.as_i64())
            .map(|n| n.to_string())
            .unwrap_or_else(|| "\u{2014}".into());
        let desired = st
            .get("desiredHealthy")
            .and_then(|v| v.as_i64())
            .map(|n| n.to_string())
            .unwrap_or_else(|| "\u{2014}".into());
        let allowed = st
            .get("disruptionsAllowed")
            .and_then(|v| v.as_i64())
            .map(|n| n.to_string())
            .unwrap_or_else(|| "\u{2014}".into());
        props.fields(
            "Status",
            vec![
                field("Current Healthy", current),
                field("Desired Healthy", desired),
                field("Disruptions Allowed", allowed),
            ],
        );
    }

    Ok(props)
}

pub(super) async fn gather_webhook(
    client: Client,
    name: &str,
    mutating: bool,
) -> AppResult<Properties> {
    let kind = if mutating {
        ResourceKind::Mutatingwebhookconfigurations
    } else {
        ResourceKind::Validatingwebhookconfigurations
    };
    let api: Api<DynamicObject> = Api::all_with(client.clone(), &kind.api_resource());
    let obj = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;

    let created = obj
        .metadata
        .creation_timestamp
        .as_ref()
        .map(|t| t.0.to_rfc3339())
        .unwrap_or_default();

    let mut props = Properties::default();
    props.fields(
        "Overview",
        vec![field("Name", obj.name_any()), field("Created", created)],
    );

    // Webhooks table
    if let Some(wh) = obj.data.get("webhooks").and_then(|w| w.as_array()) {
        let rows: Vec<Vec<Cell>> = wh
            .iter()
            .map(|w| {
                let name = w.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                let url = w
                    .get("clientConfig")
                    .and_then(|cc| cc.get("url"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let svc = w
                    .get("clientConfig")
                    .and_then(|cc| cc.get("service"))
                    .map(|s| {
                        let ns = s.get("namespace").and_then(|v| v.as_str()).unwrap_or("");
                        let svc_name = s.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                        format!("{ns}/{svc_name}")
                    })
                    .unwrap_or_default();
                let failure = w
                    .get("failurePolicy")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Fail");
                let side_effects = w
                    .get("sideEffects")
                    .and_then(|v| v.as_str())
                    .unwrap_or("None");
                vec![
                    c(name),
                    c(if !url.is_empty() { url } else { &svc }),
                    c(failure),
                    c(side_effects),
                ]
            })
            .collect();
        props.push_table(
            "Webhooks",
            Some("No webhooks defined"),
            &["Name", "Target", "Failure Policy", "Side Effects"],
            rows,
        );
    }

    Ok(props)
}

pub(super) async fn gather_api_service(client: Client, name: &str) -> AppResult<Properties> {
    let api: Api<DynamicObject> =
        Api::all_with(client.clone(), &ResourceKind::Apiservices.api_resource());
    let obj = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;

    let spec = obj.data.get("spec");
    let status = obj.data.get("status");

    let group_version = spec
        .map(|s| {
            let group = s.get("group").and_then(|v| v.as_str()).unwrap_or("");
            let version = s.get("version").and_then(|v| v.as_str()).unwrap_or("");
            if group.is_empty() {
                version.to_string()
            } else {
                format!("{group}/{version}")
            }
        })
        .unwrap_or_else(|| "\u{2014}".into());
    let svc = spec
        .and_then(|s| s.get("service"))
        .map(|svc| {
            let ns = svc.get("namespace").and_then(|v| v.as_str()).unwrap_or("");
            let svc_name = svc.get("name").and_then(|v| v.as_str()).unwrap_or("?");
            format!("{ns}/{svc_name}")
        })
        .unwrap_or_else(|| "\u{2014}".into());
    let group_priority = spec
        .and_then(|s| s.get("groupPriorityMinimum"))
        .and_then(|v| v.as_i64())
        .map(|n| n.to_string())
        .unwrap_or_else(|| "\u{2014}".into());
    let version_priority = spec
        .and_then(|s| s.get("versionPriority"))
        .and_then(|v| v.as_i64())
        .map(|n| n.to_string())
        .unwrap_or_else(|| "\u{2014}".into());
    let insecure = spec
        .and_then(|s| s.get("insecureSkipTLSVerify"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut props = Properties::default();
    props.fields(
        "Overview",
        vec![
            field("Group/Version", group_version),
            field("Service", svc),
            field("Group Priority", group_priority),
            field("Version Priority", version_priority),
            field("Insecure Skip TLS", if insecure { "Yes" } else { "No" }),
        ],
    );

    // Conditions
    if let Some(conds) = status
        .and_then(|s| s.get("conditions"))
        .and_then(|c| c.as_array())
    {
        let cond_rows: Vec<Vec<Cell>> = conds
            .iter()
            .map(|cond| {
                let type_ = cond.get("type").and_then(|v| v.as_str()).unwrap_or("?");
                let status = cond.get("status").and_then(|v| v.as_str()).unwrap_or("?");
                let reason = cond.get("reason").and_then(|v| v.as_str()).unwrap_or("");
                let msg = cond.get("message").and_then(|v| v.as_str()).unwrap_or("");
                vec![c(type_), c(status), c(reason), c(msg)]
            })
            .collect();
        props.push_table(
            "Conditions",
            Some("No conditions"),
            &["Type", "Status", "Reason", "Message"],
            cond_rows,
        );
    }

    Ok(props)
}

pub(super) async fn gather_crd_detail(client: Client, kind_id: &str) -> AppResult<Properties> {
    // Parse the "group/plural" id to find the CRD name.
    // CRD metadata.name is always "{plural}.{group}".
    let (group, plural) = kind_id
        .split_once('/')
        .ok_or_else(|| AppError::Other(format!("invalid custom kind id: {kind_id}")))?;
    let crd_name = format!("{plural}.{group}");

    let api: Api<CustomResourceDefinition> = Api::all(client.clone());
    let crd = api
        .get(&crd_name)
        .await
        .map_err(|e| AppError::Kube(format!("CRD {crd_name}: {e}")))?;

    let spec = &crd.spec;
    let status = crd.status.as_ref();
    let mut props = Properties::default();

    // --- Section 1: Overview ---
    let storage_ver = spec
        .versions
        .iter()
        .find(|v| v.storage)
        .or_else(|| spec.versions.first());
    let served_versions: Vec<String> = spec
        .versions
        .iter()
        .filter(|v| v.served)
        .map(|v| v.name.clone())
        .collect();

    let created = crd
        .metadata
        .creation_timestamp
        .as_ref()
        .map(|t| t.0.to_rfc3339())
        .unwrap_or_default();

    props.fields(
        "Overview",
        vec![
            field("Group", spec.group.clone()),
            field("Kind", spec.names.kind.clone()),
            field("Plural", spec.names.plural.clone()),
            field("Singular", spec.names.singular.clone().unwrap_or_default()),
            field("Scope", spec.scope.clone()),
            field(
                "Storage Version",
                storage_ver
                    .map(|v| v.name.clone())
                    .unwrap_or_else(|| "-".into()),
            ),
            field("Served Versions", served_versions.join(", ")),
            field("Created", created),
        ],
    );

    // --- Section 2: Additional Printer Columns ---
    if let Some(ver) = storage_ver {
        if let Some(cols) = &ver.additional_printer_columns {
            let col_rows: Vec<Vec<Cell>> = cols
                .iter()
                .map(|col| {
                    vec![
                        c(col.name.clone()),
                        c(col.json_path.clone()),
                        c(col.type_.clone()),
                        c(col.description.as_deref().unwrap_or("")),
                    ]
                })
                .collect();
            props.push_table(
                "Printer Columns",
                Some("No additional printer columns"),
                &["Name", "JSON Path", "Type", "Description"],
                col_rows,
            );
        }
    }

    // --- Section 3: Schema (top-level fields) ---
    if let Some(ver) = storage_ver {
        if let Some(schema) = &ver.schema {
            if let Some(openapi) = &schema.open_api_v3_schema {
                if let Some(props_map) = &openapi.properties {
                    let field_rows: Vec<Vec<Cell>> = props_map
                        .iter()
                        .map(|(name, prop)| {
                            let type_str = prop.type_.as_deref().unwrap_or("object");
                            let desc = prop.description.as_deref().unwrap_or("");
                            let required = openapi
                                .required
                                .as_ref()
                                .map(|r| r.contains(name))
                                .unwrap_or(false);
                            vec![
                                c(name),
                                c(type_str),
                                c(if required { "Yes" } else { "No" }),
                                c(desc),
                            ]
                        })
                        .collect();
                    props.push_table(
                        "Schema Fields",
                        Some("No schema defined"),
                        &["Field", "Type", "Required", "Description"],
                        field_rows,
                    );
                }
            }
        }
    }

    // --- Section 4: Conditions ---
    if let Some(st) = status {
        if let Some(conditions) = &st.conditions {
            let cond_rows: Vec<Vec<Cell>> = conditions
                .iter()
                .map(|cond| {
                    vec![
                        c(cond.type_.clone()),
                        c(cond.status.clone()),
                        c(cond.reason.as_deref().unwrap_or("")),
                        c(cond.message.as_deref().unwrap_or("")),
                    ]
                })
                .collect();
            props.push_table(
                "Conditions",
                Some("No conditions"),
                &["Type", "Status", "Reason", "Message"],
                cond_rows,
            );
        }
    }

    Ok(props)
}

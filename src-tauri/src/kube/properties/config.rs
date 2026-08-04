//! Config properties: ConfigMaps, Secrets, Namespaces, ResourceQuotas.

use super::*;
use crate::error::AppResult;
use k8s_openapi::api::core::v1::{ConfigMap, Namespace, ResourceQuota, Secret};
use kube::api::Api;
use kube::Client;

pub(super) async fn gather_configmap(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<ConfigMap> = Api::namespaced(client, namespace);
    let cm = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let data = cm.data.as_ref();
    let binary = cm.binary_data.as_ref();
    let mut props = Properties::default();

    let data_count = data.map(|m| m.len()).unwrap_or(0);
    let binary_count = binary.map(|m| m.len()).unwrap_or(0);
    let immutable = cm.immutable.unwrap_or(false);
    props.fields(
        "Overview",
        vec![
            field("data keys", data_count.to_string()),
            field("binary keys", binary_count.to_string()),
            field_toned(
                "immutable",
                if immutable { "yes" } else { "no" },
                if immutable {
                    Tone::Good
                } else {
                    Tone::Secondary
                },
            ),
        ],
    );

    // ---- data ----
    // The two maps are mutually exclusive at the key level (the apiserver
    // rejects overlap), but a single ConfigMap can have keys in both, so we
    // show them as two tables rather than collapsing.
    props.push_table(
        "Data",
        Some("no data keys"),
        &["KEY", "VALUE"],
        data.iter()
            .flat_map(|m| m.iter())
            .map(|(k, v)| vec![name_cell(k.clone()), c(v.clone())])
            .collect(),
    );
    props.push_table(
        "Binary data",
        Some("no binary keys"),
        &["KEY", "BYTES"],
        binary
            .iter()
            .flat_map(|m| m.iter())
            .map(|(k, v)| {
                // ByteString derefs to &[u8] for length; printing a count is
                // far more useful than dumping base64 of a TLS cert.
                vec![name_cell(k.clone()), c(format!("{} bytes", v.0.len()))]
            })
            .collect(),
    );

    meta_sections(&mut props, &cm);
    Ok(props)
}

pub(super) async fn gather_secret(client: Client, namespace: &str, name: &str) -> AppResult<Properties> {
    let api: Api<Secret> = Api::namespaced(client, namespace);
    let sec = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let data = sec.data.as_ref();
    let string_data = sec.string_data.as_ref();
    let mut props = Properties::default();

    let data_count = data.map(|m| m.len()).unwrap_or(0);
    let string_count = string_data.map(|m| m.len()).unwrap_or(0);
    let immutable = sec.immutable.unwrap_or(false);
    props.fields(
        "Overview",
        vec![
            field("type", or_dash(sec.type_.clone())),
            field("data keys", data_count.to_string()),
            field("stringData keys", string_count.to_string()),
            field_toned(
                "immutable",
                if immutable { "yes" } else { "no" },
                if immutable {
                    Tone::Good
                } else {
                    Tone::Secondary
                },
            ),
        ],
    );

    // ---- data ----
    // Redact values: only key + byte count, never the contents. Length is
    // useful (a 4096-byte tls.crt is the same shape as 32-byte one, and
    // the user can tell which keys are unexpectedly large).
    props.push_table(
        "Data",
        Some("no data keys"),
        &["KEY", "BYTES"],
        data.iter()
            .flat_map(|m| m.iter())
            .map(|(k, v)| vec![name_cell(k.clone()), c(format!("{} bytes", v.0.len()))])
            .collect(),
    );
    // stringData is write-only on the apiserver (it's never echoed back on
    // GET), so this table is almost always empty — but if it does come
    // through (some custom resources or shims), we'd still want to redact.
    props.push_table(
        "stringData",
        Some("no stringData keys"),
        &["KEY", "BYTES"],
        string_data
            .iter()
            .flat_map(|m| m.iter())
            .map(|(k, v)| vec![name_cell(k.clone()), c(format!("{} bytes", v.len()))])
            .collect(),
    );

    meta_sections(&mut props, &sec);
    Ok(props)
}

pub(super) async fn gather_namespace(client: Client, name: &str) -> AppResult<Properties> {
    let api: Api<Namespace> = Api::all(client);
    let ns = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let status = ns.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    // Phase is the headline: Active is the only "normal" state, anything
    // else is a reason to look closer. Terminating in particular is the
    // common one — a stuck finalizer, etc.
    let phase = status.phase.clone().unwrap_or_else(|| DASH.into());
    let phase_tone = match phase.as_str() {
        "Active" => Tone::Good,
        "Terminating" => Tone::Warn,
        _ => Tone::Secondary,
    };
    let label_count = ns.metadata.labels.as_ref().map(|m| m.len()).unwrap_or(0);
    props.fields(
        "Overview",
        vec![
            field_toned("phase", phase, phase_tone),
            field("labels", label_count.to_string()),
        ],
    );

    meta_sections(&mut props, &ns);
    Ok(props)
}

pub(super) async fn gather_resourcequota(
    client: Client,
    namespace: &str,
    name: &str,
) -> AppResult<Properties> {
    let api: Api<ResourceQuota> = Api::namespaced(client, namespace);
    let rq = api
        .get(name)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;
    let spec = rq.spec.clone().unwrap_or_default();
    let status = rq.status.clone().unwrap_or_default();
    let mut props = Properties::default();

    let scopes = spec
        .scopes
        .iter()
        .flatten()
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    let scope_selector = spec
        .scope_selector
        .as_ref()
        .and_then(|sel| {
            let exprs: Vec<String> = sel
                .match_expressions
                .iter()
                .flatten()
                .map(|e| {
                    format!(
                        "{} {} {}",
                        e.scope_name,
                        e.operator,
                        e.values
                            .iter()
                            .flatten()
                            .cloned()
                            .collect::<Vec<_>>()
                            .join(",")
                    )
                })
                .collect();
            if exprs.is_empty() {
                None
            } else {
                Some(exprs.join("; "))
            }
        })
        .unwrap_or_else(|| DASH.into());

    props.fields(
        "Overview",
        vec![
            field(
                "scopes",
                if scopes.is_empty() {
                    DASH.into()
                } else {
                    scopes
                },
            ),
            field("scope selector", scope_selector),
        ],
    );

    // ---- hard vs used ----
    let hard = spec.hard.as_ref();
    let used = status.used.as_ref();
    // Union of both maps.
    let mut resource_names: Vec<&String> = hard
        .map(|m| m.keys().collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .chain(
            used.map(|m| m.keys().collect::<Vec<_>>())
                .unwrap_or_default(),
        )
        .collect();
    resource_names.sort();
    resource_names.dedup();

    let quota_rows: Vec<Vec<Cell>> = resource_names
        .iter()
        .map(|r| {
            let hard_val = hard
                .and_then(|m| m.get(*r))
                .map(|q| q.0.clone())
                .unwrap_or_else(|| DASH.into());
            let used_val = used
                .and_then(|m| m.get(*r))
                .map(|q| q.0.clone())
                .unwrap_or_else(|| DASH.into());
            // Tone: warn when usage is >= 80% of hard limit (if parseable).
            let tone = match (used_val.parse::<f64>(), hard_val.parse::<f64>()) {
                (Ok(u), Ok(h)) if h > 0.0 && u / h >= 0.8 => Tone::Warn,
                _ => Tone::Secondary,
            };
            vec![
                name_cell((*r).clone()),
                c(hard_val),
                Cell::new(used_val, tone),
            ]
        })
        .collect();
    props.push_table(
        "Quotas",
        Some("no quota resources"),
        &["RESOURCE", "HARD", "USED"],
        quota_rows,
    );

    meta_sections(&mut props, &rq);
    Ok(props)
}

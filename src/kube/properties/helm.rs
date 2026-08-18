//! Helm release properties (B35): overview, history, and values.

use super::*;
use crate::error::AppResult;
use k7s_deps::k8s_openapi::api::core::v1::Secret;
use k7s_deps::kube::api::{Api, ListParams};
use k7s_deps::kube::Client;

pub(super) async fn gather_helm(
    client: Client,
    namespace: &str,
    name: &str,
) -> AppResult<Properties> {
    let api: Api<Secret> = Api::namespaced(client, namespace);
    // Helm labels every release Secret with owner + release name; filtering here
    // avoids decoding every Secret in the namespace.
    let lp = ListParams::default().labels(&format!("owner=helm,name={name}"));
    let secrets = api
        .list(&lp)
        .await
        .map_err(|e| AppError::Kube(e.to_string()))?;

    let releases: Vec<helm_mod::Release> = secrets
        .items
        .iter()
        .filter_map(helm_mod::decode_release)
        .collect();
    if releases.is_empty() {
        return Err(AppError::NotFound(format!(
            "no Helm release {name} in {namespace}"
        )));
    }
    Ok(build_helm_properties(releases))
}

/// Build the release document from its decoded revisions (pure, so the ordering
/// and toning are testable without a cluster). Newest revision leads the Overview
/// and the History.
pub(super) fn build_helm_properties(mut releases: Vec<helm_mod::Release>) -> Properties {
    // Newest revision first — the current release leads, history follows.
    releases.sort_by_key(|r| std::cmp::Reverse(r.revision));
    let current = &releases[0];

    let mut props = Properties::default();

    // ---- overview (from the current revision) ----
    props.fields(
        "Overview",
        vec![
            field("chart", current.chart.clone()),
            field("app version", current.app_version.clone()),
            field_toned(
                "status",
                current.status.clone(),
                helm_mod::status_tone(&current.status),
            ),
            field("revision", current.revision.to_string()),
            Field {
                label: "first deployed".into(),
                value: Cell::age(Some(current.first_deployed.clone()).filter(|s| !s.is_empty())),
                nav: None,
            },
            Field {
                label: "last deployed".into(),
                value: Cell::age(Some(current.updated.clone()).filter(|s| !s.is_empty())),
                nav: None,
            },
            field("description", current.description.clone()),
        ],
    );

    // ---- history (every revision, newest first) ----
    let rows: Vec<Vec<Cell>> = releases
        .iter()
        .map(|r| {
            vec![
                name_cell(r.revision.to_string()),
                Cell::status(r.status.clone(), helm_mod::status_tone(&r.status)),
                c(r.chart.clone()),
                c(r.description.clone()),
                Cell::age(Some(r.updated.clone()).filter(|s| !s.is_empty())),
            ]
        })
        .collect();
    props.push_table(
        "History",
        Some("no revisions"),
        &["REVISION", "STATUS", "CHART", "DESCRIPTION", "UPDATED"],
        rows,
    );

    // ---- values (user overrides, redacted, flattened) ----
    let value_rows: Vec<Vec<Cell>> = helm_mod::flatten_values(&current.config)
        .into_iter()
        .map(|(k, v)| vec![name_cell(k), c(v)])
        .collect();
    props.push_table(
        "Values",
        // An empty config isn't missing data — the release runs on the chart's
        // own defaults, which is worth saying rather than showing a blank table.
        Some("chart defaults (no overrides)"),
        &["KEY", "VALUE"],
        value_rows,
    );

    props
}

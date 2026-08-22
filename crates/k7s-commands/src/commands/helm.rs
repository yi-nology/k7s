//! Helm marketplace and release operations: repo CRUD, chart search, install/
//! upgrade/uninstall/rollback, and release history.

use k7s_core::core::CoreState;
use k7s_core::error::AppResult;
use k7s_core::kube::{helm::market, helm::ops};
use std::sync::Arc;
use tauri::State;

// ---------------------------------------------------------------------------
// Helm marketplace (Phase 1 of KubePi parity) — repo CRUD + chart search.
// ---------------------------------------------------------------------------

/// Seed the default chart repos on first launch. Called from `setup`.
#[tauri::command]
pub fn helm_seed_repos() -> AppResult<()> {
    market::seed_default_repos()
}

/// List the user's helm chart repositories (sorted most-recently-touched first).
#[tauri::command]
pub fn helm_list_repos() -> AppResult<Vec<market::HelmRepo>> {
    market::list_repos()
}

/// Add a new chart repo. Returns the freshly-created entry.
#[tauri::command]
pub fn helm_add_repo(
    name: String,
    url: String,
    description: String,
) -> AppResult<market::HelmRepo> {
    market::add_repo(&name, &url, &description)
}

/// Remove a chart repo and its cached index.
#[tauri::command]
pub fn helm_remove_repo(name: String) -> AppResult<()> {
    market::remove_repo(&name)
}

/// Re-fetch one repo's index from its URL. On failure the repo's
/// `last_error` is set and the error is returned to the caller so the UI
/// can surface a red dot.
/// Wire arguments for [`helm_update_repo`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelmUpdateRepoArgs {
    pub name: String,
}

pub async fn helm_update_repo_impl(name: String) -> AppResult<market::HelmRepo> {
    market::update_repo_index(&name).await
}

#[tauri::command]
pub async fn helm_update_repo(name: String) -> AppResult<market::HelmRepo> {
    helm_update_repo_impl(name).await
}

/// Re-fetch every repo's index, in parallel. Per-repo failures are logged
/// but do not short-circuit the rest.
pub async fn helm_update_all_repos_impl() -> AppResult<Vec<market::HelmRepo>> {
    market::update_all_indexes().await
}

#[tauri::command]
pub async fn helm_update_all_repos() -> AppResult<Vec<market::HelmRepo>> {
    helm_update_all_repos_impl().await
}

/// Search across every cached index. Empty query returns everything
/// (the "browse" view). Results are sorted by version desc, name asc.
#[tauri::command]
pub fn helm_search_charts(query: String) -> AppResult<Vec<market::ChartSummary>> {
    market::search_charts(&query)
}

/// All known versions of one (repo, chart) pair, newest first.
#[tauri::command]
pub fn helm_chart_versions(
    repo: String,
    chart: String,
) -> AppResult<Vec<market::ChartVersionEntry>> {
    market::chart_versions(&repo, &chart)
}

/// Export a chart .tgz to a local directory (air-gap / offline).
/// Wire arguments for [`helm_export_chart`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelmExportChartArgs {
    pub repo: String,
    pub chart: String,
    pub version: String,
    pub output_dir: String,
}

pub async fn helm_export_chart_impl(
    repo: String,
    chart: String,
    version: String,
    output_dir: String,
) -> AppResult<String> {
    let path = market::export_chart(&repo, &chart, &version, &output_dir).await?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn helm_export_chart(
    repo: String,
    chart: String,
    version: String,
    output_dir: String,
) -> AppResult<String> {
    helm_export_chart_impl(repo, chart, version, output_dir).await
}

/// Import a local chart .tgz into the chart cache.
#[tauri::command]
pub fn helm_import_chart(file_path: String, repo_name: String) -> AppResult<String> {
    let path = market::import_chart(&file_path, &repo_name)?;
    Ok(path.to_string_lossy().to_string())
}

/// List locally imported chart archives for a repo.
#[tauri::command]
pub fn helm_local_charts(repo_name: String) -> AppResult<Vec<String>> {
    market::list_local_charts(&repo_name)
}

/// Default values.yaml for a chart at a given version. Delegates to
/// `helm show values` so we don't re-implement chart parsing in Rust.
/// Wire arguments for [`helm_render_default_values`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelmRenderDefaultValuesArgs {
    pub chart: String,
    pub version: String,
    pub kubeconfig: Option<String>,
}

pub async fn helm_render_default_values_impl(
    chart: String,
    version: String,
    kubeconfig: Option<String>,
) -> AppResult<String> {
    ops::render_default_values(&chart, &version, kubeconfig.as_deref()).await
}

#[tauri::command]
pub async fn helm_render_default_values(
    chart: String,
    version: String,
    kubeconfig: Option<String>,
) -> AppResult<String> {
    helm_render_default_values_impl(chart, version, kubeconfig).await
}

// ---------------------------------------------------------------------------
// Helm release ops (install/upgrade/uninstall/rollback + history).
// ---------------------------------------------------------------------------

/// Run a helm operation (install/upgrade/uninstall/rollback) to completion.
/// Streams `helm-op-log` and `helm-op-done` events for the UI to render live.
/// Wire arguments for [`helm_run_op`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelmRunOpArgs {
    pub op: ops::HelmOp,
}

pub async fn helm_run_op_impl(
    mgr: std::sync::Arc<CoreState>,
    op: ops::HelmOp,
) -> AppResult<ops::HelmOpResult> {
    // The frontend doesn't track a per-connection EventSink directly; pull it
    // off the manager. The Tauri sink in `core::events` is what the manager
    // already uses, so re-using it here means helm log lines reach the same
    // webview that called us.
    let sink = mgr.manager.sink().clone();
    ops::run_op(op, sink).await
}

#[tauri::command]
pub async fn helm_run_op(
    op: ops::HelmOp,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<ops::HelmOpResult> {
    helm_run_op_impl(mgr.inner().clone(), op).await
}

/// Fetch the revision history for a release.
/// Wire arguments for [`helm_release_history`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelmReleaseHistoryArgs {
    pub release: String,
    pub namespace: String,
    pub kubeconfig: Option<String>,
}

pub async fn helm_release_history_impl(
    release: String,
    namespace: String,
    kubeconfig: Option<String>,
) -> AppResult<Vec<ops::RevisionEntry>> {
    ops::release_history(&release, &namespace, kubeconfig.as_deref()).await
}

#[tauri::command]
pub async fn helm_release_history(
    release: String,
    namespace: String,
    kubeconfig: Option<String>,
) -> AppResult<Vec<ops::RevisionEntry>> {
    helm_release_history_impl(release, namespace, kubeconfig).await
}

/// Fetch the rendered manifest for a specific revision of a Helm release.
/// Wire arguments for [`helm_manifest_revision`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelmManifestRevisionArgs {
    pub namespace: String,
    pub name: String,
    pub revision: i64,
}

pub async fn helm_manifest_revision_impl(
    mgr: std::sync::Arc<CoreState>,
    namespace: String,
    name: String,
    revision: i64,
) -> AppResult<String> {
    let client = crate::commands::core::require_client(&mgr.manager).await?;
    k7s_core::kube::helm::helm_manifest_revision(client, &namespace, &name, revision).await
}

#[tauri::command]
pub async fn helm_manifest_revision(
    mgr: State<'_, Arc<CoreState>>,
    namespace: String,
    name: String,
    revision: i64,
) -> AppResult<String> {
    helm_manifest_revision_impl(mgr.inner().clone(), namespace, name, revision).await
}

/// Fetch the user-supplied values for a specific revision of a Helm release.
/// Wire arguments for [`helm_values_revision`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelmValuesRevisionArgs {
    pub namespace: String,
    pub name: String,
    pub revision: i64,
}

pub async fn helm_values_revision_impl(
    mgr: std::sync::Arc<CoreState>,
    namespace: String,
    name: String,
    revision: i64,
) -> AppResult<k7s_deps::serde_json::Value> {
    let client = crate::commands::core::require_client(&mgr.manager).await?;
    k7s_core::kube::helm::helm_values_revision(client, &namespace, &name, revision).await
}

#[tauri::command]
pub async fn helm_values_revision(
    mgr: State<'_, Arc<CoreState>>,
    namespace: String,
    name: String,
    revision: i64,
) -> AppResult<k7s_deps::serde_json::Value> {
    helm_values_revision_impl(mgr.inner().clone(), namespace, name, revision).await
}

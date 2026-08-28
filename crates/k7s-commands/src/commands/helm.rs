//! Helm marketplace and release operations: repo CRUD, chart search, install/
//! upgrade/uninstall/rollback, and release history.

use k7s_core::core::CoreState;
use k7s_core::error::{AppError, AppResult};
use k7s_core::kube::{helm::local, helm::market, helm::ops};
#[cfg(feature = "ipc")]
use std::sync::Arc;
#[cfg(feature = "ipc")]
use tauri::State;

// ---------------------------------------------------------------------------
// Helm marketplace (Phase 1 of KubePi parity) — repo CRUD + chart search.
// ---------------------------------------------------------------------------

/// Seed the default chart repos on first launch. Called from `setup`.
#[cfg_attr(feature = "ipc", tauri::command)]
pub fn helm_seed_repos() -> AppResult<()> {
    market::seed_default_repos()
}

/// List the user's helm chart repositories (sorted most-recently-touched first).
#[cfg_attr(feature = "ipc", tauri::command)]
pub fn helm_list_repos() -> AppResult<Vec<market::HelmRepo>> {
    market::list_repos()
}

/// Add a new chart repo. Returns the freshly-created entry.
#[cfg_attr(feature = "ipc", tauri::command)]
pub fn helm_add_repo(
    name: String,
    url: String,
    description: String,
) -> AppResult<market::HelmRepo> {
    market::add_repo(&name, &url, &description)
}

/// Remove a chart repo and its cached index.
#[cfg_attr(feature = "ipc", tauri::command)]
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

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn helm_update_repo(name: String) -> AppResult<market::HelmRepo> {
    helm_update_repo_impl(name).await
}

/// Re-fetch every repo's index, in parallel. Per-repo failures are logged
/// but do not short-circuit the rest.
pub async fn helm_update_all_repos_impl() -> AppResult<Vec<market::HelmRepo>> {
    market::update_all_indexes().await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn helm_update_all_repos() -> AppResult<Vec<market::HelmRepo>> {
    helm_update_all_repos_impl().await
}

/// Search across every cached index. Empty query returns everything
/// (the "browse" view). Results are sorted by version desc, name asc.
#[cfg_attr(feature = "ipc", tauri::command)]
pub fn helm_search_charts(query: String) -> AppResult<Vec<market::ChartSummary>> {
    market::search_charts(&query)
}

/// All known versions of one (repo, chart) pair, newest first.
#[cfg_attr(feature = "ipc", tauri::command)]
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

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn helm_export_chart(
    repo: String,
    chart: String,
    version: String,
    output_dir: String,
) -> AppResult<String> {
    helm_export_chart_impl(repo, chart, version, output_dir).await
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

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn helm_render_default_values(
    chart: String,
    version: String,
    kubeconfig: Option<String>,
) -> AppResult<String> {
    helm_render_default_values_impl(chart, version, kubeconfig).await
}

/// Render a chart's templates offline (`helm template`, nothing applied, no
/// cluster contact) and return the manifest. `chart` may be `repo/name`, an
/// OCI URL, or a local absolute path; `version` empty = latest; `values`
/// empty = chart defaults. Used by the ChartOps preview/diff flow.
/// Wire arguments for [`helm_render_preview`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelmRenderPreviewArgs {
    pub chart: String,
    pub version: String,
    pub values: String,
    pub kubeconfig: Option<String>,
}

pub async fn helm_render_preview_impl(
    chart: String,
    version: String,
    values: String,
    kubeconfig: Option<String>,
) -> AppResult<String> {
    ops::render_chart_templates(&chart, &version, &values, kubeconfig.as_deref()).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn helm_render_preview(
    chart: String,
    version: String,
    values: String,
    kubeconfig: Option<String>,
) -> AppResult<String> {
    helm_render_preview_impl(chart, version, values, kubeconfig).await
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

#[cfg(feature = "ipc")]
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

#[cfg(feature = "ipc")]
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

#[cfg(feature = "ipc")]
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

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn helm_values_revision(
    mgr: State<'_, Arc<CoreState>>,
    namespace: String,
    name: String,
    revision: i64,
) -> AppResult<k7s_deps::serde_json::Value> {
    helm_values_revision_impl(mgr.inner().clone(), namespace, name, revision).await
}

/// Wire arguments for [`helm_add_repo`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelmAddRepoArgs {
    pub name: String,
    pub url: String,
    pub description: String,
}

/// Wire arguments for [`helm_chart_versions`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelmChartVersionsArgs {
    pub repo: String,
    pub chart: String,
}

/// Wire arguments for [`helm_remove_repo`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelmRemoveRepoArgs {
    pub name: String,
}

/// Wire arguments for [`helm_search_charts`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelmSearchChartsArgs {
    pub query: String,
}

// ---------------------------------------------------------------------------
// Local chart library (ChartOps parity) — desktop/web only, same gate as
// the rest of this module (see commands/mod.rs). Thin wrappers over the
// pure-filesystem functions in `k7s_core::kube::helm::local`; the library
// root is always `<data_dir>/charts`.
// ---------------------------------------------------------------------------

/// The on-disk root of the local chart library for this CoreState.
fn local_chart_root(mgr: &CoreState) -> std::path::PathBuf {
    mgr.data_dir.join("charts")
}

/// Wire arguments for [`local_chart_detail`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalChartDetailArgs {
    pub id: String,
}

/// Wire arguments for [`local_chart_file`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalChartFileArgs {
    pub id: String,
    pub path: String,
}

/// Wire arguments for [`local_chart_import_content`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalChartImportContentArgs {
    pub filename: String,
    pub content_base64: String,
}

/// Wire arguments for [`local_chart_remove`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalChartRemoveArgs {
    pub id: String,
}

/// Wire arguments for [`local_chart_lint`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalChartLintArgs {
    pub id: String,
}

/// Wire arguments for [`local_chart_verify`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalChartVerifyArgs {
    pub id: String,
}

/// Wire arguments for [`local_chart_package`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalChartPackageArgs {
    pub id: String,
}

/// Wire arguments for [`local_chart_deps`] (camelCase on the wire). `action`
/// is the lowercase wire verb (`"list" | "build" | "update"`) deserialized
/// by `local::DepsAction`'s serde; an unknown verb is a wire error.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalChartDepsArgs {
    pub id: String,
    pub action: local::DepsAction,
}

/// Scan the local chart library. Pure delegation — `local.rs` does the
/// sorting (newest first) and metadata parsing.
pub fn local_charts_list_impl(
    mgr: std::sync::Arc<CoreState>,
) -> AppResult<Vec<local::LocalChartEntry>> {
    local::scan_local_charts(&local_chart_root(&mgr))
}

/// One chart's detail view: entry + file tree + rendered README/values.
pub fn local_chart_detail_impl(
    mgr: std::sync::Arc<CoreState>,
    id: String,
) -> AppResult<local::LocalChartDetail> {
    local::local_chart_detail(&local_chart_root(&mgr), &id)
}

/// Read one file out of a chart (tgz member or dir-chart file) as UTF-8.
pub fn local_chart_file_impl(
    mgr: std::sync::Arc<CoreState>,
    id: String,
    path: String,
) -> AppResult<String> {
    local::local_chart_file(&local_chart_root(&mgr), &id, &path)
}

/// Import a chart package from base64 content. Audited: chart imports add
/// bytes to the user's disk, so they land in the audit trail like every
/// other mutating helm operation.
pub fn local_chart_import_content_impl(
    mgr: std::sync::Arc<CoreState>,
    filename: String,
    content_base64: String,
) -> AppResult<local::LocalChartEntry> {
    use k7s_deps::base64::Engine;
    let bytes = k7s_deps::base64::engine::general_purpose::STANDARD
        .decode(&content_base64)
        .map_err(|e| AppError::Other(format!("bad base64: {e}")))?;
    let entry = local::import_chart_bytes(&local_chart_root(&mgr), &filename, &bytes)?;
    k7s_core::core::audit::record(
        "local_chart_import",
        k7s_deps::serde_json::json!({
            "name": entry.name,
            "version": entry.version,
            "bytes": bytes.len(),
        }),
    );
    Ok(entry)
}

/// Delete a chart from the library. Audited — same reason as import.
pub fn local_chart_remove_impl(mgr: std::sync::Arc<CoreState>, id: String) -> AppResult<()> {
    local::remove_chart(&local_chart_root(&mgr), &id)?;
    k7s_core::core::audit::record(
        "local_chart_remove",
        k7s_deps::serde_json::json!({ "id": id }),
    );
    Ok(())
}

/// `helm lint` a chart from the local library, returning the report.
/// Read-only (nothing on disk or in a cluster changes) — no audit.
pub async fn local_chart_lint_impl(
    mgr: std::sync::Arc<CoreState>,
    id: String,
) -> AppResult<String> {
    local::lint_chart(&local_chart_root(&mgr), &id).await
}

/// `helm verify` a chart from the local library, returning the report.
/// Read-only — no audit, same reason as lint.
pub async fn local_chart_verify_impl(
    mgr: std::sync::Arc<CoreState>,
    id: String,
) -> AppResult<String> {
    local::verify_chart(&local_chart_root(&mgr), &id).await
}

/// `helm package` an unpacked dir chart from the library, returning the
/// fresh archive's entry. Audited: packaging writes a new `.tgz` to the
/// library root, like import/remove.
pub async fn local_chart_package_impl(
    mgr: std::sync::Arc<CoreState>,
    id: String,
) -> AppResult<local::LocalChartEntry> {
    let entry = local::package_chart(&local_chart_root(&mgr), &id).await?;
    k7s_core::core::audit::record(
        "local_chart_package",
        k7s_deps::serde_json::json!({
            "id": id,
            "name": entry.name,
            "version": entry.version,
        }),
    );
    Ok(entry)
}

/// `helm dependency list|build|update` on a chart from the library.
/// `List` is read-only — no audit; `Build`/`Update` write Chart.lock and
/// the charts/ cache inside the chart dir, so they land in the audit trail
/// with the serialized lowercase action.
pub async fn local_chart_deps_impl(
    mgr: std::sync::Arc<CoreState>,
    id: String,
    action: local::DepsAction,
) -> AppResult<String> {
    let out = local::chart_deps(&local_chart_root(&mgr), &id, action).await?;
    if !matches!(action, local::DepsAction::List) {
        k7s_core::core::audit::record(
            "local_chart_deps",
            k7s_deps::serde_json::json!({ "id": id, "action": action }),
        );
    }
    Ok(out)
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub fn local_charts_list(mgr: State<'_, Arc<CoreState>>) -> AppResult<Vec<local::LocalChartEntry>> {
    local_charts_list_impl(mgr.inner().clone())
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub fn local_chart_detail(
    id: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<local::LocalChartDetail> {
    local_chart_detail_impl(mgr.inner().clone(), id)
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub fn local_chart_file(
    id: String,
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<String> {
    local_chart_file_impl(mgr.inner().clone(), id, path)
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub fn local_chart_import_content(
    filename: String,
    content_base64: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<local::LocalChartEntry> {
    local_chart_import_content_impl(mgr.inner().clone(), filename, content_base64)
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub fn local_chart_remove(id: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<()> {
    local_chart_remove_impl(mgr.inner().clone(), id)
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn local_chart_lint(id: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<String> {
    local_chart_lint_impl(mgr.inner().clone(), id).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn local_chart_verify(id: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<String> {
    local_chart_verify_impl(mgr.inner().clone(), id).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn local_chart_package(
    id: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<local::LocalChartEntry> {
    local_chart_package_impl(mgr.inner().clone(), id).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn local_chart_deps(
    id: String,
    action: local::DepsAction,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<String> {
    local_chart_deps_impl(mgr.inner().clone(), id, action).await
}

// ---------------------------------------------------------------------------
// Deployment profiles (ChartOps parity) — saved helm install/upgrade
// parameter sets. Thin wrappers over `k7s_core::kube::helm::profiles`; the
// file lives directly in the data dir (`<data_dir>/helm-profiles.json`).
// ---------------------------------------------------------------------------

/// Wire arguments for [`helm_profile_save`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelmProfileSaveArgs {
    pub profile: k7s_core::kube::helm::profiles::HelmProfile,
}

/// Wire arguments for [`helm_profile_delete`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelmProfileDeleteArgs {
    pub name: String,
}

/// List every saved profile, sorted by name.
pub fn helm_profile_list_impl(
    mgr: std::sync::Arc<CoreState>,
) -> AppResult<Vec<k7s_core::kube::helm::profiles::HelmProfile>> {
    Ok(k7s_core::kube::helm::profiles::load_profiles(&mgr.data_dir))
}

/// Save (upsert by name) a profile and return the full sorted list.
/// `created_at` is stamped here for new profiles; the storage layer
/// keeps the original on overwrite. Audited: profiles drive deploys.
pub fn helm_profile_save_impl(
    mgr: std::sync::Arc<CoreState>,
    profile: k7s_core::kube::helm::profiles::HelmProfile,
) -> AppResult<Vec<k7s_core::kube::helm::profiles::HelmProfile>> {
    use k7s_core::kube::helm::profiles;
    let mut p = profile;
    if p.created_at.is_empty() {
        p.created_at = k7s_deps::chrono::Utc::now().to_rfc3339();
    }
    let out = profiles::save_profile(&mgr.data_dir, p.clone())?;
    k7s_core::core::audit::record(
        "helm_profile_save",
        k7s_deps::serde_json::json!({
            "name": p.name,
            "chartRef": p.chart_ref,
        }),
    );
    Ok(out)
}

/// Delete a profile by name and return the remaining sorted list.
/// Audited, same reason as save.
pub fn helm_profile_delete_impl(
    mgr: std::sync::Arc<CoreState>,
    name: String,
) -> AppResult<Vec<k7s_core::kube::helm::profiles::HelmProfile>> {
    use k7s_core::kube::helm::profiles;
    let out = profiles::delete_profile(&mgr.data_dir, &name)?;
    k7s_core::core::audit::record(
        "helm_profile_delete",
        k7s_deps::serde_json::json!({ "name": name }),
    );
    Ok(out)
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub fn helm_profile_list(
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<k7s_core::kube::helm::profiles::HelmProfile>> {
    helm_profile_list_impl(mgr.inner().clone())
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub fn helm_profile_save(
    profile: k7s_core::kube::helm::profiles::HelmProfile,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<k7s_core::kube::helm::profiles::HelmProfile>> {
    helm_profile_save_impl(mgr.inner().clone(), profile)
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub fn helm_profile_delete(
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<k7s_core::kube::helm::profiles::HelmProfile>> {
    helm_profile_delete_impl(mgr.inner().clone(), name)
}

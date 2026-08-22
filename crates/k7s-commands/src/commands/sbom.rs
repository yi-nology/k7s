// SBOM commands: generation, history, and export.

use crate::commands::core::require_client;
use k7s_core::core::prefs::read_prefs;
use k7s_core::core::CoreState;
use k7s_core::error::AppResult;
use k7s_core::kube::security::sbom::{SbomEngine, SbomFormat, SbomResult, SbomSummary};
use k7s_core::kube::security::sbom_storage::{validate_export_path, SbomStorage};
use std::sync::Arc;
use tauri::State;

fn get_storage(data_dir: &std::path::Path) -> SbomStorage {
    SbomStorage::new(data_dir)
}

/// Build an SbomEngine from user prefs (custom paths + timeout).
/// Uses spawn_blocking to avoid blocking the async runtime on disk I/O.
async fn engine_from_prefs(mgr: &CoreState) -> AppResult<SbomEngine> {
    let dir = mgr.data_dir.clone();
    let prefs = k7s_deps::tokio::task::spawn_blocking(move || read_prefs(&dir))
        .await
        .map_err(|e| k7s_core::error::AppError::Other(e.to_string()))?;
    Ok(SbomEngine::with_prefs(
        prefs.scanner_trivy_path.as_deref(),
        prefs.scanner_grype_path.as_deref(),
        prefs.scanner_timeout.as_deref(),
    ))
}

/// Generate SBOM for a single container image.
/// Wire arguments for [`sbom_generate_image`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SbomGenerateImageArgs {
    pub image_ref: String,
    pub format: String,
}

pub async fn sbom_generate_image_impl(
    mgr: std::sync::Arc<CoreState>,
    image_ref: String,
    format: String,
) -> AppResult<SbomResult> {
    let fmt = SbomFormat::parse(&format)
        .ok_or_else(|| k7s_core::error::AppError::Other(format!("Unknown format: {format}")))?;

    let engine = engine_from_prefs(&mgr).await?;
    let sbom = engine.generate_with_vulns(&image_ref, &fmt).await?;

    let storage = get_storage(&mgr.data_dir);
    storage.save(&sbom)?;

    Ok(sbom)
}

#[tauri::command]
pub async fn sbom_generate_image(
    image_ref: String,
    format: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<SbomResult> {
    sbom_generate_image_impl(mgr.inner().clone(), image_ref, format).await
}

/// Generate SBOM for all images in the cluster.
/// Wire arguments for [`sbom_generate_cluster`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SbomGenerateClusterArgs {
    pub format: String,
}

pub async fn sbom_generate_cluster_impl(
    mgr: std::sync::Arc<CoreState>,
    format: String,
) -> AppResult<SbomResult> {
    let _fmt = SbomFormat::parse(&format)
        .ok_or_else(|| k7s_core::error::AppError::Other(format!("Unknown format: {format}")))?;

    let _client = require_client(&mgr.manager).await?;

    // For now, just scan the first image found. Full cluster scan TBD.
    Err(k7s_core::error::AppError::Other(
        "Cluster-wide SBOM scan not yet implemented. Use image scan instead.".to_string(),
    ))
}

#[tauri::command]
pub async fn sbom_generate_cluster(
    format: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<SbomResult> {
    sbom_generate_cluster_impl(mgr.inner().clone(), format).await
}

/// List SBOM scan history.
pub async fn sbom_list_history_impl(mgr: std::sync::Arc<CoreState>) -> AppResult<Vec<SbomSummary>> {
    let storage = get_storage(&mgr.data_dir);
    storage.list()
}

#[tauri::command]
pub async fn sbom_list_history(mgr: State<'_, Arc<CoreState>>) -> AppResult<Vec<SbomSummary>> {
    sbom_list_history_impl(mgr.inner().clone()).await
}

/// Get a specific SBOM by ID.
/// Wire arguments for [`sbom_get`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SbomGetArgs {
    pub id: String,
}

pub async fn sbom_get_impl(mgr: std::sync::Arc<CoreState>, id: String) -> AppResult<SbomResult> {
    let storage = get_storage(&mgr.data_dir);
    storage.load(&id)
}

#[tauri::command]
pub async fn sbom_get(id: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<SbomResult> {
    sbom_get_impl(mgr.inner().clone(), id).await
}

/// Export an SBOM to a file.
/// Validates that the output path is within allowed directories to prevent path traversal.
/// If the path is relative (just a filename), it will be saved to the platform's temp directory.
/// Wire arguments for [`sbom_export`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SbomExportArgs {
    pub id: String,
    pub output_path: String,
}

pub async fn sbom_export_impl(
    mgr: std::sync::Arc<CoreState>,
    id: String,
    output_path: String,
) -> AppResult<String> {
    let canonical_path = validate_export_path(&output_path, &mgr.data_dir)?;

    let storage = get_storage(&mgr.data_dir);
    let sbom = storage.load(&id)?;
    let content = k7s_deps::serde_json::to_string_pretty(&sbom)
        .map_err(|e| k7s_core::error::AppError::Other(format!("serialize sbom: {e}")))?;
    std::fs::write(&canonical_path, content)
        .map_err(|e| k7s_core::error::AppError::Other(format!("write file: {e}")))?;
    Ok(canonical_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn sbom_export(
    id: String,
    output_path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<String> {
    sbom_export_impl(mgr.inner().clone(), id, output_path).await
}

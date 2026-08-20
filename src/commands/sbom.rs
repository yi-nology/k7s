//! SBOM commands: generation, history, and export.
//!
//! Desktop-only: depends on `trivy`/`grype` CLI binaries via k7s-core::sbom.

#![cfg(not(target_os = "android"))]

use crate::commands::core::require_client;
use crate::core::prefs::read_prefs;
use crate::core::CoreState;
use crate::error::AppResult;
use crate::kube::sbom::{SbomEngine, SbomFormat, SbomResult, SbomSummary};
use crate::kube::sbom_storage::{validate_export_path, SbomStorage};
use std::sync::Arc;
use tauri::State;

fn get_storage(data_dir: &std::path::Path) -> SbomStorage {
    SbomStorage::new(data_dir)
}

/// Build an SbomEngine from user prefs (custom paths + timeout).
fn engine_from_prefs(mgr: &CoreState) -> SbomEngine {
    let prefs = read_prefs(&mgr.data_dir);
    SbomEngine::with_prefs(
        prefs.scanner_trivy_path.as_deref(),
        prefs.scanner_grype_path.as_deref(),
        prefs.scanner_timeout.as_deref(),
    )
}

/// Generate SBOM for a single container image.
#[tauri::command]
pub async fn sbom_generate_image(
    image_ref: String,
    format: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<SbomResult> {
    let fmt = SbomFormat::parse(&format)
        .ok_or_else(|| crate::error::AppError::Other(format!("Unknown format: {format}")))?;

    let engine = engine_from_prefs(&mgr);
    let sbom = engine.generate_with_vulns(&image_ref, &fmt).await?;

    let storage = get_storage(&mgr.data_dir);
    storage.save(&sbom)?;

    Ok(sbom)
}

/// Generate SBOM for all images in the cluster.
#[tauri::command]
pub async fn sbom_generate_cluster(
    _format: String,
    _mgr: State<'_, Arc<CoreState>>,
) -> AppResult<SbomResult> {
    Err(crate::error::AppError::Other(
        "Cluster-wide SBOM scan not yet implemented. Use image scan instead.".to_string(),
    ))
}

/// List SBOM scan history.
#[tauri::command]
pub async fn sbom_list_history(mgr: State<'_, Arc<CoreState>>) -> AppResult<Vec<SbomSummary>> {
    let storage = get_storage(&mgr.data_dir);
    storage.list()
}

/// Get a specific SBOM by ID.
#[tauri::command]
pub async fn sbom_get(id: String, mgr: State<'_, Arc<CoreState>>) -> AppResult<SbomResult> {
    let storage = get_storage(&mgr.data_dir);
    storage.load(&id)
}

/// Export an SBOM to a file.
/// Validates that the output path is within allowed directories to prevent path traversal.
/// If the path is relative (just a filename), it will be saved to the platform's temp directory.
#[tauri::command]
pub async fn sbom_export(
    id: String,
    output_path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<String> {
    let canonical_path = validate_export_path(&output_path, &mgr.data_dir)?;

    let storage = get_storage(&mgr.data_dir);
    let sbom = storage.load(&id)?;
    let content = k7s_deps::serde_json::to_string_pretty(&sbom)
        .map_err(|e| crate::error::AppError::Other(format!("serialize sbom: {e}")))?;
    std::fs::write(&canonical_path, content)
        .map_err(|e| crate::error::AppError::Other(format!("write file: {e}")))?;
    Ok(canonical_path.to_string_lossy().to_string())
}

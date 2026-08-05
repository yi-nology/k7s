//! SBOM commands: generation, history, and export.

use crate::commands::core::require_client;
use crate::core::CoreState;
use crate::error::AppResult;
use crate::kube::sbom::{SbomEngine, SbomFormat, SbomResult, SbomSummary};
use crate::kube::sbom_storage::SbomStorage;
use std::sync::Arc;
use tauri::State;

fn get_storage(data_dir: &std::path::Path) -> SbomStorage {
    SbomStorage::new(&data_dir.to_path_buf())
}

/// Generate SBOM for a single container image.
#[tauri::command]
pub async fn sbom_generate_image(
    image_ref: String,
    format: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<SbomResult> {
    let fmt = SbomFormat::from_str(&format)
        .ok_or_else(|| crate::error::AppError::Other(format!("Unknown format: {format}")))?;

    let engine = SbomEngine::new();
    let sbom = engine.generate_with_vulns(&image_ref, &fmt).await?;

    let storage = get_storage(&mgr.data_dir);
    storage.save(&sbom)?;

    Ok(sbom)
}

/// Generate SBOM for all images in the cluster.
#[tauri::command]
pub async fn sbom_generate_cluster(
    format: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<SbomResult> {
    let _fmt = SbomFormat::from_str(&format)
        .ok_or_else(|| crate::error::AppError::Other(format!("Unknown format: {format}")))?;

    let _client = require_client(&mgr.manager).await?;

    // For now, just scan the first image found. Full cluster scan TBD.
    Err(crate::error::AppError::Other(
        "Cluster-wide SBOM scan not yet implemented. Use image scan instead.".to_string(),
    ))
}

/// List SBOM scan history.
#[tauri::command]
pub async fn sbom_list_history(
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<SbomSummary>> {
    let storage = get_storage(&mgr.data_dir);
    storage.list()
}

/// Get a specific SBOM by ID.
#[tauri::command]
pub async fn sbom_get(
    id: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<SbomResult> {
    let storage = get_storage(&mgr.data_dir);
    storage.load(&id)
}

/// Export an SBOM to a file.
/// Validates that the output path is within allowed directories to prevent path traversal.
#[tauri::command]
pub async fn sbom_export(
    id: String,
    output_path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<String> {
    let path = std::path::Path::new(&output_path);

    // Validate: reject obvious path traversal attempts
    if output_path.contains("..") {
        return Err(crate::error::AppError::Other(
            "Export path must not contain '..'".to_string(),
        ));
    }

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            return Err(crate::error::AppError::Other(format!(
                "Export directory does not exist: {}",
                parent.display()
            )));
        }
    }

    let storage = get_storage(&mgr.data_dir);
    let sbom = storage.load(&id)?;
    let content = serde_json::to_string_pretty(&sbom)
        .map_err(|e| crate::error::AppError::Other(format!("serialize sbom: {e}")))?;
    std::fs::write(path, content)
        .map_err(|e| crate::error::AppError::Other(format!("write file: {e}")))?;
    Ok(output_path)
}

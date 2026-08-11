//! SBOM commands: generation, history, and export.

use crate::commands::core::require_client;
use crate::core::prefs::read_prefs;
use crate::core::CoreState;
use crate::error::AppResult;
use crate::kube::sbom::{SbomEngine, SbomFormat, SbomResult, SbomSummary};
use crate::kube::sbom_storage::SbomStorage;
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
    format: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<SbomResult> {
    let _fmt = SbomFormat::parse(&format)
        .ok_or_else(|| crate::error::AppError::Other(format!("Unknown format: {format}")))?;

    let _client = require_client(&mgr.manager).await?;

    // For now, just scan the first image found. Full cluster scan TBD.
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
    let path = std::path::Path::new(&output_path);

    // If the path is just a filename (no directory component), use the temp directory
    let resolved_path =
        if path.parent().is_none() || path.parent() == Some(std::path::Path::new("")) {
            // Just a filename - use temp directory
            std::env::temp_dir().join(path)
        } else {
            path.to_path_buf()
        };

    // Canonicalize the path to resolve symlinks, URL-encoded sequences, and other tricks.
    // This prevents path traversal attacks using ../, symlinks, or encoded characters.
    let canonical_path = dunce::canonicalize(&resolved_path).or_else(|_| {
        // If the file doesn't exist yet, canonicalize the parent directory
        if let Some(parent) = resolved_path.parent() {
            let canonical_parent = dunce::canonicalize(parent).map_err(|e| {
                crate::error::AppError::Other(format!(
                    "Cannot resolve export directory '{}': {e}",
                    parent.display()
                ))
            })?;
            Ok::<std::path::PathBuf, crate::error::AppError>(
                canonical_parent.join(resolved_path.file_name().unwrap_or_default()),
            )
        } else {
            Err(crate::error::AppError::Other(
                "Invalid export path: no parent directory".to_string(),
            ))
        }
    })?;

    // Define allowed export directories: user's home, data_dir, or temp
    let allowed_dirs: Vec<std::path::PathBuf> = {
        let mut dirs = vec![mgr.data_dir.clone()];
        if let Some(home) = dirs::home_dir() {
            dirs.push(home);
        }
        dirs.push(std::env::temp_dir());
        dirs
    };

    // Verify the canonical path is within an allowed directory
    let is_allowed = allowed_dirs
        .iter()
        .any(|allowed| canonical_path.starts_with(allowed));

    if !is_allowed {
        return Err(crate::error::AppError::Other(format!(
            "Export path '{}' is not within allowed directories. Allowed: home, data dir, or temp.",
            output_path
        )));
    }

    // Ensure parent directory exists
    if let Some(parent) = canonical_path.parent() {
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
    std::fs::write(&canonical_path, content)
        .map_err(|e| crate::error::AppError::Other(format!("write file: {e}")))?;
    Ok(canonical_path.to_string_lossy().to_string())
}

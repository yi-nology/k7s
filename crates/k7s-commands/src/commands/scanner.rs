// Scanner status command: exposes which scanning engines (trivy/grype/native)
// are available and which one is active, so the frontend can display the
// fallback chain and let users configure custom binary paths.

use k7s_core::core::prefs::read_prefs;
use k7s_core::core::CoreState;
use k7s_core::error::AppResult;
use k7s_core::kube::image_scan;
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

/// Information about a single scanning engine.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerEngineInfo {
    /// Engine name: "trivy", "grype", or "native".
    pub name: String,
    /// Whether this engine is currently available (binary found or built-in).
    pub available: bool,
    /// Resolved binary path, or None for native (built-in).
    pub path: Option<String>,
    /// Whether the user can configure a custom path for this engine.
    pub configurable: bool,
    /// Source of the path: "configured" (user-set) or "auto-detected".
    pub path_source: String,
}

/// Overall scanner status returned to the frontend.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerStatus {
    /// All known engines, in fallback priority order.
    pub engines: Vec<ScannerEngineInfo>,
    /// The engine that would be used for the next scan: "trivy", "grype", or "native".
    pub active_engine: String,
    /// Configured timeout (e.g. "5m"), or the default.
    pub timeout: String,
}

/// Resolve the trivy path: user-configured > auto-detected.
pub fn resolve_trivy(prefs_trivy_path: Option<&str>) -> (Option<String>, String) {
    // User-configured path takes priority.
    if let Some(custom) = prefs_trivy_path {
        let trimmed = custom.trim();
        if !trimmed.is_empty() && std::path::Path::new(trimmed).is_file() {
            return (Some(trimmed.to_string()), "configured".to_string());
        }
    }
    // Fall back to auto-detection.
    (image_scan::which_trivy(), "auto-detected".to_string())
}

/// Resolve the grype path: user-configured > auto-detected.
pub fn resolve_grype(prefs_grype_path: Option<&str>) -> (Option<String>, String) {
    if let Some(custom) = prefs_grype_path {
        let trimmed = custom.trim();
        if !trimmed.is_empty() && std::path::Path::new(trimmed).is_file() {
            return (Some(trimmed.to_string()), "configured".to_string());
        }
    }
    (image_scan::which_grype(), "auto-detected".to_string())
}

/// `scanner_status` — Return the availability and configuration of all scanning
/// engines. The frontend calls this to render the scanner status panel and to
/// determine which engine will be used for the next SBOM or vulnerability scan.
#[tauri::command]
pub async fn scanner_status(mgr: State<'_, Arc<CoreState>>) -> AppResult<ScannerStatus> {
    let dir = mgr.data_dir.clone();
    let prefs = k7s_deps::tokio::task::spawn_blocking(move || read_prefs(&dir))
        .await
        .map_err(|e| k7s_core::error::AppError::Other(e.to_string()))?;

    let (trivy_path, trivy_source) = resolve_trivy(prefs.scanner_trivy_path.as_deref());
    let (grype_path, grype_source) = resolve_grype(prefs.scanner_grype_path.as_deref());

    let active_engine = if trivy_path.is_some() {
        "trivy"
    } else if grype_path.is_some() {
        "grype"
    } else {
        "native"
    }
    .to_string();

    let timeout = prefs
        .scanner_timeout
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "5m".to_string());

    Ok(ScannerStatus {
        engines: vec![
            ScannerEngineInfo {
                name: "trivy".to_string(),
                available: trivy_path.is_some(),
                path: trivy_path,
                configurable: true,
                path_source: trivy_source,
            },
            ScannerEngineInfo {
                name: "grype".to_string(),
                available: grype_path.is_some(),
                path: grype_path,
                configurable: true,
                path_source: grype_source,
            },
            ScannerEngineInfo {
                name: "native".to_string(),
                available: true, // always available (docker inspect fallback)
                path: None,
                configurable: false,
                path_source: "built-in".to_string(),
            },
        ],
        active_engine,
        timeout,
    })
}

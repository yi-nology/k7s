//! SBOM (Software Bill of Materials) generation and parsing.
//!
//! Provides adapters for external SBOM tools (trivy, grype) that produce
//! CycloneDX or SPDX JSON output.  The types here are tool-agnostic so the
//! frontend can render a unified view regardless of which generator was used.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// Supported SBOM output formats.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SbomFormat {
    CycloneDx,
    Spdx,
}

/// Which tool / source produced the SBOM.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SbomSource {
    Image {
        image_ref: String,
        namespace: String,
        pod: Option<String>,
    },
}

/// A single component (package) listed in the SBOM.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SbomComponent {
    pub name: String,
    pub version: String,
    pub purl: Option<String>,
    pub licenses: Vec<String>,
}

/// Metadata about the SBOM generation run.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SbomMetadata {
    pub tool: String,
    pub tool_version: String,
    pub scan_duration_ms: u64,
}

/// A vulnerability entry carried inside the SBOM.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SbomVulnerability {
    pub id: String,
    pub severity: String,
    pub affected_components: Vec<String>,
    pub description: Option<String>,
    pub fixed_version: Option<String>,
}

/// The full SBOM result returned to the frontend.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SbomResult {
    pub id: String,
    pub source: SbomSource,
    pub format: SbomFormat,
    pub spec_version: String,
    pub metadata: SbomMetadata,
    pub components: Vec<SbomComponent>,
    pub dependencies: Vec<String>,
    pub vulnerabilities: Vec<SbomVulnerability>,
    pub raw_output: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

// ---------------------------------------------------------------------------
// Generate SBOM via grype
// ---------------------------------------------------------------------------

/// Generate SBOM via grype.
pub async fn generate_via_grype(
    grype_path: &str,
    image_ref: &str,
    format: &SbomFormat,
) -> AppResult<SbomResult> {
    let start = std::time::Instant::now();
    let format_flag = match format {
        SbomFormat::CycloneDx => "cyclonedx",
        SbomFormat::Spdx => "spdx-json",
    };

    let output = Command::new(grype_path)
        .args([image_ref, "-o", format_flag])
        .output()
        .await
        .map_err(|e| AppError::Other(format!("Failed to run grype: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Other(format!("grype failed: {stderr}")));
    }

    let raw = String::from_utf8(output.stdout)
        .map_err(|e| AppError::Other(format!("Invalid UTF-8 from grype: {e}")))?;
    let elapsed = start.elapsed().as_millis() as u64;

    parse_grype_sbom(&raw, image_ref, format, elapsed)
}

/// Parse grype JSON output into SbomResult.
fn parse_grype_sbom(
    raw: &str,
    image_ref: &str,
    format: &SbomFormat,
    elapsed_ms: u64,
) -> AppResult<SbomResult> {
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| AppError::Other(format!("Failed to parse grype output: {e}")))?;

    let spec_version = match format {
        SbomFormat::CycloneDx => {
            value["specVersion"].as_str().unwrap_or("1.5").to_string()
        }
        SbomFormat::Spdx => {
            value["spdxVersion"].as_str().unwrap_or("SPDX-2.3").to_string()
        }
    };

    // Reuse the same component parsing logic as trivy (same JSON structure)
    let components = parse_trivy_components(&value, format);

    // grype SBOM output includes vulnerabilities in a separate array
    let vulnerabilities = value["vulnerabilities"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|v| SbomVulnerability {
                    id: v["id"].as_str().unwrap_or("").to_string(),
                    severity: v["severity"].as_str().unwrap_or("unknown").to_string(),
                    affected_components: v["artifacts"]
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(|art| art["name"].as_str())
                                .map(String::from)
                                .collect()
                        })
                        .unwrap_or_default(),
                    description: v["description"].as_str().map(String::from),
                    fixed_version: v["fix"]["versions"]
                        .as_array()
                        .and_then(|v| v.first())
                        .and_then(|v| v.as_str())
                        .map(String::from),
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(SbomResult {
        id: generate_id(),
        source: SbomSource::Image {
            image_ref: image_ref.to_string(),
            namespace: String::new(),
            pod: None,
        },
        format: format.clone(),
        spec_version,
        metadata: SbomMetadata {
            tool: "grype".to_string(),
            tool_version: "unknown".to_string(),
            scan_duration_ms: elapsed_ms,
        },
        components,
        dependencies: vec![],
        vulnerabilities,
        raw_output: Some(raw.to_string()),
        created_at: chrono::Utc::now(),
    })
}

/// Parse components from a CycloneDX or SPDX JSON value.
///
/// CycloneDX uses `components[]` with `name`, `version`, `purl`, `licenses[]`.
/// SPDX uses `packages[]` with `name`, `versionInfo`, `licenseDeclared`.
fn parse_trivy_components(value: &serde_json::Value, format: &SbomFormat) -> Vec<SbomComponent> {
    match format {
        SbomFormat::CycloneDx => value["components"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .map(|c| SbomComponent {
                        name: c["name"].as_str().unwrap_or("").to_string(),
                        version: c["version"].as_str().unwrap_or("").to_string(),
                        purl: c["purl"].as_str().map(String::from),
                        licenses: c["licenses"]
                            .as_array()
                            .map(|l| {
                                l.iter()
                                    .filter_map(|lic| {
                                        lic["id"]
                                            .as_str()
                                            .or_else(|| lic["name"].as_str())
                                            .map(String::from)
                                    })
                                    .collect()
                            })
                            .unwrap_or_default(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        SbomFormat::Spdx => value["packages"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .map(|p| SbomComponent {
                        name: p["name"].as_str().unwrap_or("").to_string(),
                        version: p["versionInfo"].as_str().unwrap_or("").to_string(),
                        purl: None,
                        licenses: p["licenseDeclared"]
                            .as_str()
                            .map(|s| vec![s.to_string()])
                            .unwrap_or_default(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
    }
}

/// Generate a simple unique identifier (timestamp-based).
fn generate_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", nanos)
}

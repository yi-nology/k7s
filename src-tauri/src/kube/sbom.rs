//! SBOM (Software Bill of Materials) generation and management.
//!
//! Supports three-tier fallback: trivy -> grype -> native parser.
//! Outputs CycloneDX and SPDX formats.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use tokio::process::Command;

/// SBOM generation source
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SbomSource {
    Image {
        image_ref: String,
        namespace: String,
        pod: Option<String>,
    },
    Cluster {
        context: String,
    },
}

/// SBOM output format
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SbomFormat {
    CycloneDx,
    Spdx,
}

impl SbomFormat {
    pub fn as_str(&self) -> &str {
        match self {
            Self::CycloneDx => "cyclonedx",
            Self::Spdx => "spdx",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "cyclonedx" | "cyclone-dx" => Some(Self::CycloneDx),
            "spdx" => Some(Self::Spdx),
            _ => None,
        }
    }
}

/// A component in the SBOM
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SbomComponent {
    pub name: String,
    pub version: String,
    pub purl: Option<String>,
    pub cpe: Option<String>,
    pub component_type: String,
    pub licenses: Vec<String>,
    pub supplier: Option<String>,
    pub hashes: Vec<String>,
}

/// Dependency relationship
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SbomDependency {
    pub ref_id: String,
    pub depends_on: Vec<String>,
}

/// Vulnerability associated with SBOM components
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SbomVulnerability {
    pub id: String,
    pub severity: String,
    pub affected_components: Vec<String>,
    pub description: Option<String>,
    pub fixed_version: Option<String>,
}

/// Metadata about the SBOM generation
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SbomMetadata {
    pub tool: String,
    pub tool_version: String,
    pub scan_duration_ms: u64,
}

/// Complete SBOM result
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SbomResult {
    pub id: String,
    pub source: SbomSource,
    pub format: SbomFormat,
    pub spec_version: String,
    pub metadata: SbomMetadata,
    pub components: Vec<SbomComponent>,
    pub dependencies: Vec<SbomDependency>,
    pub vulnerabilities: Vec<SbomVulnerability>,
    pub raw_output: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Summary for history listing
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SbomSummary {
    pub id: String,
    pub source: SbomSource,
    pub format: SbomFormat,
    pub component_count: usize,
    pub vulnerability_count: usize,
    pub tool: String,
    pub created_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Tool detection
// ---------------------------------------------------------------------------

/// Detect trivy binary path (same logic as image_scan.rs).
pub fn which_trivy() -> Option<String> {
    let candidates = [
        "/usr/local/bin/trivy",
        "/opt/homebrew/bin/trivy",
        "/usr/bin/trivy",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    if let Ok(output) = std::process::Command::new("which").arg("trivy").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    None
}

/// Detect grype binary path.
pub fn which_grype() -> Option<String> {
    let candidates = [
        "/usr/local/bin/grype",
        "/opt/homebrew/bin/grype",
        "/usr/bin/grype",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    if let Ok(output) = std::process::Command::new("which").arg("grype").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// SBOM generation
// ---------------------------------------------------------------------------

/// Generate SBOM via trivy.
pub async fn generate_via_trivy(
    trivy_path: &str,
    image_ref: &str,
    format: &SbomFormat,
) -> AppResult<SbomResult> {
    let start = std::time::Instant::now();
    let format_flag = match format {
        SbomFormat::CycloneDx => "cyclonedx",
        SbomFormat::Spdx => "spdx-json",
    };

    let output = Command::new(trivy_path)
        .args([
            "image",
            "--format",
            format_flag,
            "--output",
            "/dev/stdout",
            "--quiet",
            image_ref,
        ])
        .output()
        .await
        .map_err(|e| AppError::Other(format!("Failed to run trivy: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Other(format!("trivy failed: {stderr}")));
    }

    let raw = String::from_utf8(output.stdout)
        .map_err(|e| AppError::Other(format!("Invalid UTF-8 from trivy: {e}")))?;
    let elapsed = start.elapsed().as_millis() as u64;

    parse_trivy_sbom(&raw, image_ref, format, elapsed)
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/// Parse trivy JSON output into SbomResult.
fn parse_trivy_sbom(
    raw: &str,
    image_ref: &str,
    format: &SbomFormat,
    elapsed_ms: u64,
) -> AppResult<SbomResult> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| AppError::Other(format!("Failed to parse trivy output: {e}")))?;

    let spec_version = match format {
        SbomFormat::CycloneDx => value["specVersion"].as_str().unwrap_or("1.5").to_string(),
        SbomFormat::Spdx => value["spdxVersion"].as_str().unwrap_or("SPDX-2.3").to_string(),
    };

    let tool_version = value["metadata"]["tools"]["components"]
        .as_array()
        .and_then(|t| t.first())
        .and_then(|t| t["version"].as_str())
        .unwrap_or("unknown")
        .to_string();

    let components = parse_trivy_components(&value, format);

    Ok(SbomResult {
        id: Uuid::new_v4().to_string(),
        source: SbomSource::Image {
            image_ref: image_ref.to_string(),
            namespace: String::new(),
            pod: None,
        },
        format: format.clone(),
        spec_version,
        metadata: SbomMetadata {
            tool: "trivy".to_string(),
            tool_version,
            scan_duration_ms: elapsed_ms,
        },
        components,
        dependencies: vec![],
        vulnerabilities: vec![],
        raw_output: Some(raw.to_string()),
        created_at: chrono::Utc::now(),
    })
}

/// Extract components from trivy output.
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
                        cpe: c["cpe"].as_str().map(String::from),
                        component_type: c["type"].as_str().unwrap_or("library").to_string(),
                        licenses: c["licenses"]
                            .as_array()
                            .map(|l| {
                                l.iter()
                                    .filter_map(|v| v["id"].as_str().or(v["name"].as_str()))
                                    .map(String::from)
                                    .collect()
                            })
                            .unwrap_or_default(),
                        supplier: c["supplier"]["name"].as_str().map(String::from),
                        hashes: c["hashes"]
                            .as_array()
                            .map(|h| {
                                h.iter()
                                    .filter_map(|v| v["content"].as_str())
                                    .map(String::from)
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
                        purl: p["externalRefs"]
                            .as_array()
                            .and_then(|refs| {
                                refs.iter()
                                    .find(|r| r["referenceType"].as_str() == Some("purl"))
                                    .and_then(|r| r["referenceLocator"].as_str())
                            })
                            .map(String::from),
                        cpe: None,
                        component_type: "library".to_string(),
                        licenses: p["licenseDeclared"]
                            .as_str()
                            .map(|l| vec![l.to_string()])
                            .unwrap_or_default(),
                        supplier: p["supplier"].as_str().map(String::from),
                        hashes: vec![],
                    })
                    .collect()
            })
            .unwrap_or_default(),
    }
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
        id: Uuid::new_v4().to_string(),
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

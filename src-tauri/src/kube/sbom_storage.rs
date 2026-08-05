//! SBOM persistence: stores scan results to disk with an index file.

use super::sbom::{SbomResult, SbomSource, SbomSummary};
use crate::error::{AppError, AppResult};
use std::path::PathBuf;

const SBOM_DIR: &str = "sbom";
const INDEX_FILE: &str = "sbom_index.json";

pub struct SbomStorage {
    base_dir: PathBuf,
}

impl SbomStorage {
    pub fn new(data_dir: &PathBuf) -> Self {
        let base_dir = data_dir.join(SBOM_DIR);
        Self { base_dir }
    }

    /// Save an SBOM result to disk and update the index.
    pub fn save(&self, sbom: &SbomResult) -> AppResult<()> {
        std::fs::create_dir_all(&self.base_dir)
            .map_err(|e| AppError::Other(format!("create sbom dir: {e}")))?;

        let source_dir = self.source_dir(&sbom.source);
        std::fs::create_dir_all(&source_dir)
            .map_err(|e| AppError::Other(format!("create source dir: {e}")))?;

        let filename = format!("{}_{}.json", sbom.format.as_str(), sbom.id);
        let path = source_dir.join(&filename);
        let json = serde_json::to_string_pretty(sbom)
            .map_err(|e| AppError::Other(format!("serialize sbom: {e}")))?;
        std::fs::write(&path, json)
            .map_err(|e| AppError::Other(format!("write sbom: {e}")))?;

        self.update_index(sbom)?;
        Ok(())
    }

    /// Load an SBOM by ID.
    pub fn load(&self, id: &str) -> AppResult<SbomResult> {
        let index = self.read_index()?;
        let entry = index
            .iter()
            .find(|e| e.id == id)
            .ok_or_else(|| AppError::Other(format!("SBOM not found: {id}")))?;

        let source_dir = self.source_dir(&entry.source);
        let filename = format!("{}_{}.json", entry.format.as_str(), id);
        let path = source_dir.join(&filename);
        let json = std::fs::read_to_string(&path)
            .map_err(|e| AppError::Other(format!("read sbom: {e}")))?;
        let sbom: SbomResult = serde_json::from_str(&json)
            .map_err(|e| AppError::Other(format!("parse sbom: {e}")))?;
        Ok(sbom)
    }

    /// List all SBOM summaries.
    pub fn list(&self) -> AppResult<Vec<SbomSummary>> {
        self.read_index()
    }

    /// Delete an SBOM by ID.
    pub fn delete(&self, id: &str) -> AppResult<()> {
        let index = self.read_index()?;
        let entry = index.iter().find(|e| e.id == id);

        if let Some(entry) = entry {
            let source_dir = self.source_dir(&entry.source);
            let filename = format!("{}_{}.json", entry.format.as_str(), id);
            let path = source_dir.join(&filename);
            if path.exists() {
                std::fs::remove_file(&path)
                    .map_err(|e| AppError::Other(format!("delete sbom: {e}")))?;
            }
        }

        let new_index: Vec<SbomSummary> =
            index.into_iter().filter(|e| e.id != id).collect();
        self.write_index(&new_index)?;
        Ok(())
    }

    fn source_dir(&self, source: &SbomSource) -> PathBuf {
        match source {
            SbomSource::Image { image_ref, .. } => {
                let safe_name = image_ref.replace([':', '/', '@'], "_");
                self.base_dir.join("images").join(safe_name)
            }
            SbomSource::Cluster { context } => {
                self.base_dir.join("clusters").join(context)
            }
        }
    }

    fn index_path(&self) -> PathBuf {
        self.base_dir.join(INDEX_FILE)
    }

    fn read_index(&self) -> AppResult<Vec<SbomSummary>> {
        let path = self.index_path();
        if !path.exists() {
            return Ok(vec![]);
        }
        let json = std::fs::read_to_string(&path)
            .map_err(|e| AppError::Other(format!("read sbom index: {e}")))?;
        let index: Vec<SbomSummary> = serde_json::from_str(&json)
            .map_err(|e| AppError::Other(format!("parse sbom index: {e}")))?;
        Ok(index)
    }

    fn write_index(&self, index: &[SbomSummary]) -> AppResult<()> {
        std::fs::create_dir_all(&self.base_dir)
            .map_err(|e| AppError::Other(format!("create sbom dir: {e}")))?;
        let json = serde_json::to_string_pretty(index)
            .map_err(|e| AppError::Other(format!("serialize sbom index: {e}")))?;
        std::fs::write(self.index_path(), json)
            .map_err(|e| AppError::Other(format!("write sbom index: {e}")))?;
        Ok(())
    }

    fn update_index(&self, sbom: &SbomResult) -> AppResult<()> {
        let mut index = self.read_index()?;
        let summary = SbomSummary {
            id: sbom.id.clone(),
            source: sbom.source.clone(),
            format: sbom.format.clone(),
            component_count: sbom.components.len(),
            vulnerability_count: sbom.vulnerabilities.len(),
            tool: sbom.metadata.tool.clone(),
            created_at: sbom.created_at,
        };
        index.push(summary);
        self.write_index(&index)
    }
}

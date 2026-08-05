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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kube::sbom::*;

    fn make_test_sbom(id: &str, image: &str) -> SbomResult {
        SbomResult {
            id: id.to_string(),
            source: SbomSource::Image {
                image_ref: image.to_string(),
                namespace: "default".to_string(),
                pod: None,
            },
            format: SbomFormat::CycloneDx,
            spec_version: "1.5".to_string(),
            metadata: SbomMetadata {
                tool: "test".to_string(),
                tool_version: "0.1.0".to_string(),
                scan_duration_ms: 100,
            },
            components: vec![SbomComponent {
                name: "openssl".to_string(),
                version: "3.1.4".to_string(),
                purl: None,
                cpe: None,
                component_type: "library".to_string(),
                licenses: vec![],
                supplier: None,
                hashes: vec![],
            }],
            dependencies: vec![],
            vulnerabilities: vec![],
            raw_output: None,
            created_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn save_and_load() {
        let dir = std::env::temp_dir().join("k7s_sbom_test_save_load");
        let _ = std::fs::remove_dir_all(&dir);

        let storage = SbomStorage::new(&dir);
        let sbom = make_test_sbom("test-001", "nginx:1.25");

        storage.save(&sbom).unwrap();
        let loaded = storage.load("test-001").unwrap();

        assert_eq!(loaded.id, "test-001");
        assert_eq!(loaded.metadata.tool, "test");
        assert_eq!(loaded.components.len(), 1);
        assert_eq!(loaded.components[0].name, "openssl");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_history() {
        let dir = std::env::temp_dir().join("k7s_sbom_test_list");
        let _ = std::fs::remove_dir_all(&dir);

        let storage = SbomStorage::new(&dir);
        assert!(storage.list().unwrap().is_empty());

        storage.save(&make_test_sbom("a", "nginx:1.25")).unwrap();
        storage.save(&make_test_sbom("b", "alpine:3.19")).unwrap();

        let list = storage.list().unwrap();
        assert_eq!(list.len(), 2);
        assert!(list.iter().any(|s| s.id == "a"));
        assert!(list.iter().any(|s| s.id == "b"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_sbom() {
        let dir = std::env::temp_dir().join("k7s_sbom_test_delete");
        let _ = std::fs::remove_dir_all(&dir);

        let storage = SbomStorage::new(&dir);
        storage.save(&make_test_sbom("del-001", "nginx:1.25")).unwrap();
        assert_eq!(storage.list().unwrap().len(), 1);

        storage.delete("del-001").unwrap();
        assert!(storage.list().unwrap().is_empty());
        assert!(storage.load("del-001").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_nonexistent() {
        let dir = std::env::temp_dir().join("k7s_sbom_test_notfound");
        let _ = std::fs::remove_dir_all(&dir);

        let storage = SbomStorage::new(&dir);
        assert!(storage.load("does-not-exist").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }
}

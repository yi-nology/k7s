//! Cluster memory — persistent knowledge base the AI draws on across sessions.
//!
//! Inspired by openocta's four-tier memory system, but simplified for k8s ops:
//!
//! - **Episodic memory**: past conversation summaries ("we debugged X, the root
//!   cause was Y, we fixed it with Z").
//! - **Cluster notes**: user-authored or AI-inferred facts about the cluster
//!   ("production frontend uses image tag v2.3.1", "the staging namespace has
//!   no PDBs").
//!
//! Both are stored as JSON files under `<data_dir>/ai-memory/`. The agent loop
//! injects relevant memories into the system prompt each run, so the AI can
//! say "last time this happened, the cause was…" without the user repeating
//! context.
//!
//! Memory is scoped to the **kubeconfig context name**, so switching clusters
//! switches memories automatically.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A single memory entry.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    /// Unique id (uuid).
    pub id: String,
    /// When this memory was created (ISO 8601).
    pub created_at: String,
    /// The summary text (1–3 sentences).
    pub content: String,
    /// Tags for filtering (e.g. ["crashloop", "production", "frontend"]).
    #[serde(default)]
    pub tags: Vec<String>,
    /// Source: "user" (explicitly added) or "ai" (auto-extracted from conversation).
    pub source: MemorySource,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MemorySource {
    User,
    Ai,
}

/// The in-memory store for one kubeconfig context.
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MemoryFile {
    context: String,
    entries: Vec<MemoryEntry>,
}

/// Public API: load/save/query memories for the current context.
pub struct MemoryStore {
    path: PathBuf,
    data: MemoryFile,
}

impl MemoryStore {
    /// Open (or create) the memory file for a given kubeconfig context.
    pub fn open(data_dir: &std::path::Path, context: &str) -> Self {
        let dir = data_dir.join("ai-memory");
        let _ = std::fs::create_dir_all(&dir);
        let safe_name = context.replace('/', "_").replace(':', "_");
        let path = dir.join(format!("{safe_name}.json"));
        let data = if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|t| serde_json::from_str(&t).ok())
                .unwrap_or_else(|| MemoryFile {
                    context: context.to_string(),
                    entries: Vec::new(),
                })
        } else {
            MemoryFile {
                context: context.to_string(),
                entries: Vec::new(),
            }
        };
        Self { path, data }
    }

    /// Add a new memory.
    pub fn add(&mut self, content: &str, tags: Vec<String>, source: MemorySource) {
        self.data.entries.push(MemoryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            content: content.to_string(),
            tags,
            source,
        });
        self.save();
    }

    /// List all memories, newest first.
    pub fn list(&self) -> Vec<&MemoryEntry> {
        self.data.entries.iter().rev().collect()
    }

    /// Search memories by keyword (case-insensitive substring match on content
    /// or tags). Returns newest first.
    pub fn search(&self, query: &str) -> Vec<&MemoryEntry> {
        let q = query.to_lowercase();
        self.data
            .entries
            .iter()
            .rev()
            .filter(|m| {
                m.content.to_lowercase().contains(&q)
                    || m.tags.iter().any(|t| t.to_lowercase().contains(&q))
            })
            .collect()
    }

    /// Delete a memory by id.
    pub fn delete(&mut self, id: &str) -> bool {
        let before = self.data.entries.len();
        self.data.entries.retain(|m| m.id != id);
        if self.data.entries.len() < before {
            self.save();
            true
        } else {
            false
        }
    }

    /// Clear all memories for this context.
    pub fn clear(&mut self) {
        self.data.entries.clear();
        self.save();
    }

    /// Build the memory context block to inject into the system prompt.
    /// Returns a string like:
    /// ```text
    /// [Cluster Memory]
    /// - 2026-08-09: Debugged CrashLoopBackOff in payment pod, root cause was OOM.
    /// - Note: production frontend uses image v2.3.1.
    /// ```
    /// Limited to the most recent `max_entries` entries to avoid wasting tokens.
    pub fn to_context_block(&self, max_entries: usize) -> String {
        if self.data.entries.is_empty() {
            return String::new();
        }
        let mut lines = vec!["[Cluster Memory — facts from past sessions]".to_string()];
        for entry in self.data.entries.iter().rev().take(max_entries) {
            let date = entry.created_at[..10].to_string();
            let prefix = if entry.source == MemorySource::User {
                "Note"
            } else {
                &date
            };
            lines.push(format!("- {prefix}: {}", entry.content));
        }
        lines.join("\n")
    }

    fn save(&self) {
        if let Ok(text) = serde_json::to_string_pretty(&self.data) {
            let tmp = self.path.with_extension("json.tmp");
            let _ = std::fs::write(&tmp, &text);
            let _ = std::fs::rename(&tmp, &self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_search() {
        let dir = std::env::temp_dir().join("k7s-ai-test-memory");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let mut store = MemoryStore::open(&dir, "test-context");
        store.add(
            "payment pod had OOM, fixed by increasing memory limit to 256Mi",
            vec!["oom".into(), "payment".into()],
            MemorySource::Ai,
        );
        store.add(
            "production frontend uses image tag v2.3.1",
            vec!["frontend".into(), "image".into()],
            MemorySource::User,
        );
        assert_eq!(store.list().len(), 2);

        // Search.
        let results = store.search("OOM");
        assert_eq!(results.len(), 1);
        assert!(results[0].content.contains("OOM"));

        // Context block.
        let block = store.to_context_block(10);
        assert!(block.contains("[Cluster Memory"));
        assert!(block.contains("payment"));

        // Delete.
        let id = store.list()[0].id.clone();
        assert!(store.delete(&id));
        assert_eq!(store.list().len(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }
}

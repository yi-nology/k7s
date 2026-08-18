//! Self-evolution system — inspired by openocta's `agent/evolution` package.
//!
//! The evolution module makes the AI agent **self-improving**: it scans the
//! outcomes of past runs, identifies what worked and what didn't, and stores
//! successful strategies for reuse. Over time, the agent gets better at:
//!
//! - **Tool selection**: which tools work best for which problems.
//! - **Prompt phrasing**: which phrasings get the best LLM responses.
//! - **Strategy patterns**: which multi-step approaches solve problems reliably.
//!
//! Architecture (three components, matching openocta's files):
//!
//! - **Scanner** (`scan.rs` equivalent): analyzes completed runs and extracts
//!   success/failure patterns.
//! - **Store** (`store.rs` equivalent): persists learned strategies as
//!   structured entries.
//! - **Prompt adapter** (`prompt.rs` equivalent): injects learned strategies
//!   into the system prompt so the LLM benefits from past experience.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A learned strategy — what worked (or didn't) for a specific type of problem.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Strategy {
    pub id: String,
    /// What problem this strategy addresses (e.g. "CrashLoopBackOff in payment pod").
    pub problem_pattern: String,
    /// The approach that worked (e.g. "check events → check previous logs → OOMKilled → increase memory limit").
    pub solution_pattern: String,
    /// Tools that were used successfully.
    pub tools_used: Vec<String>,
    /// How many times this strategy succeeded.
    pub success_count: u32,
    /// How many times it failed.
    pub failure_count: u32,
    /// Confidence score (0.0–1.0), computed from success/failure ratio.
    pub confidence: f32,
    /// When this strategy was last observed.
    pub last_observed: String,
    /// Tags for retrieval.
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Outcome of a single agent run, used for scanning.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOutcome {
    pub run_id: String,
    pub user_message: String,
    pub tools_called: Vec<String>,
    pub success: bool,
    pub final_response: String,
    pub error: Option<String>,
    pub duration_ms: u64,
    pub turn_count: u32,
}

/// The evolution store — persists strategies and run history.
pub struct EvolutionStore {
    dir: PathBuf,
    strategies: Vec<Strategy>,
    recent_runs: Vec<RunOutcome>,
}

impl EvolutionStore {
    pub fn open(data_dir: &std::path::Path) -> Self {
        let dir = data_dir.join("ai-evolution");
        let _ = std::fs::create_dir_all(&dir);
        let strategies = crate::ai::atomic_read_json(&dir.join("strategies.json"));
        let recent_runs = crate::ai::atomic_read_json(&dir.join("runs.json"));
        Self {
            dir,
            strategies,
            recent_runs,
        }
    }

    /// Record a completed run.
    pub fn record_run(&mut self, outcome: RunOutcome) {
        self.recent_runs.push(outcome);
        // Keep only the last 200 runs.
        if self.recent_runs.len() > 200 {
            self.recent_runs = self.recent_runs.split_off(self.recent_runs.len() - 200);
        }
        save_json(&self.dir.join("runs.json"), &self.recent_runs);
    }

    /// Scan recent runs and extract/update strategies. Called periodically
    /// (e.g., after every 10 runs or on app startup).
    pub fn scan_and_update(&mut self) {
        for run in &self.recent_runs {
            if run.tools_called.is_empty() {
                continue;
            }
            // Find or create a strategy matching this problem pattern.
            let pattern = extract_pattern(&run.user_message);
            let existing = self
                .strategies
                .iter_mut()
                .find(|s| s.problem_pattern == pattern);

            if let Some(strategy) = existing {
                if run.success {
                    strategy.success_count += 1;
                } else {
                    strategy.failure_count += 1;
                }
                strategy.last_observed = k7s_deps::chrono::Utc::now().to_rfc3339();
                strategy.confidence =
                    compute_confidence(strategy.success_count, strategy.failure_count);
            } else if run.success && run.tools_called.len() >= 2 {
                // Only store strategies for successful multi-tool runs.
                self.strategies.push(Strategy {
                    id: k7s_deps::uuid::Uuid::new_v4().to_string(),
                    problem_pattern: pattern,
                    solution_pattern: format!(
                        "Used tools [{}] to solve the problem",
                        run.tools_called.join(", ")
                    ),
                    tools_used: run.tools_called.clone(),
                    success_count: 1,
                    failure_count: 0,
                    confidence: 0.6,
                    last_observed: k7s_deps::chrono::Utc::now().to_rfc3339(),
                    tags: extract_tags(&run.user_message),
                });
            }
        }
        // Prune low-confidence strategies.
        self.strategies
            .retain(|s| s.confidence > 0.2 || s.success_count > 3);
        save_json(&self.dir.join("strategies.json"), &self.strategies);
    }

    /// Get strategies relevant to a problem description (for prompt injection).
    pub fn relevant_strategies(&self, query: &str, max: usize) -> Vec<&Strategy> {
        let q = query.to_lowercase();
        let mut scored: Vec<(f32, &Strategy)> = self
            .strategies
            .iter()
            .filter(|s| s.confidence > 0.3)
            .map(|s| {
                let relevance = if s.problem_pattern.to_lowercase().contains(&q)
                    || s.tags.iter().any(|t| q.contains(&t.to_lowercase()))
                {
                    1.0
                } else {
                    0.3
                };
                let score = s.confidence * relevance;
                (score, s)
            })
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.into_iter().take(max).map(|(_, s)| s).collect()
    }

    /// Build the evolution context block for the system prompt.
    pub fn to_context_block(&self, query: &str) -> String {
        let strategies = self.relevant_strategies(query, 5);
        if strategies.is_empty() {
            return String::new();
        }
        let mut lines = vec!["[Learned Strategies — from past successes]".to_string()];
        for s in &strategies {
            lines.push(format!(
                "- {} (confidence: {:.0}%): {}",
                s.problem_pattern,
                s.confidence * 100.0,
                s.solution_pattern
            ));
        }
        lines.join("\n")
    }

    pub fn list_strategies(&self) -> &[Strategy] {
        &self.strategies
    }

    pub fn delete_strategy(&mut self, id: &str) -> bool {
        let before = self.strategies.len();
        self.strategies.retain(|s| s.id != id);
        if self.strategies.len() < before {
            save_json(&self.dir.join("strategies.json"), &self.strategies);
            true
        } else {
            false
        }
    }
}

/// Extract a simplified problem pattern from the user message.
fn extract_pattern(message: &str) -> String {
    let lower = message.to_lowercase();
    // Extract key problem indicators.
    let indicators = [
        "crashloopbackoff",
        "imagepullbackoff",
        "oomkilled",
        "pending",
        "notready",
        "unavailable",
        "error",
        "failed",
        "timeout",
        "connection refused",
        "dns",
        "pvc",
        "pdb",
        "hpa",
    ];
    for indicator in &indicators {
        if lower.contains(indicator) {
            return indicator.to_string();
        }
    }
    // Fallback: first 50 chars.
    message.chars().take(50).collect()
}

/// Extract tags from the user message.
fn extract_tags(message: &str) -> Vec<String> {
    let lower = message.to_lowercase();
    let mut tags = Vec::new();
    let keywords = [
        "pod",
        "node",
        "deployment",
        "service",
        "ingress",
        "namespace",
        "crashloop",
        "imagepull",
        "oom",
        "pending",
        "notready",
    ];
    for kw in &keywords {
        if lower.contains(kw) {
            tags.push(kw.to_string());
        }
    }
    tags
}

fn compute_confidence(success: u32, failure: u32) -> f32 {
    let total = success + failure;
    if total == 0 {
        return 0.5;
    }
    let ratio = success as f32 / total as f32;
    // Boost confidence with more observations (Bayesian-ish).
    let observation_boost = (total as f32).ln() / 10.0;
    (ratio + observation_boost).min(1.0)
}

fn save_json<T: Serialize>(path: &std::path::Path, data: &T) {
    let _ = crate::ai::atomic_write_json(path, data);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_extracts_strategies() {
        let dir = std::env::temp_dir().join("k7s-ai-test-evolution");
        let _ = std::fs::remove_dir_all(&dir);
        let mut store = EvolutionStore::open(&dir);

        // Record a successful multi-tool run.
        store.record_run(RunOutcome {
            run_id: "test-1".into(),
            user_message: "payment pod is in CrashLoopBackOff".into(),
            tools_called: vec![
                "get_events".into(),
                "get_pod_logs".into(),
                "describe_resource".into(),
            ],
            success: true,
            final_response: "OOMKilled, increase memory limit".into(),
            error: None,
            duration_ms: 5000,
            turn_count: 3,
        });

        store.scan_and_update();
        let strategies = store.list_strategies();
        assert!(
            !strategies.is_empty(),
            "should extract at least one strategy"
        );
        assert!(strategies[0].problem_pattern.contains("crashloop"));
        assert!(strategies[0].confidence > 0.0);

        // Relevant strategies should match.
        let relevant = store.relevant_strategies("crashloop", 5);
        assert!(!relevant.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn context_block_with_strategies() {
        let dir = std::env::temp_dir().join("k7s-ai-test-evo-ctx");
        let _ = std::fs::remove_dir_all(&dir);
        let mut store = EvolutionStore::open(&dir);

        store.record_run(RunOutcome {
            run_id: "test-1".into(),
            user_message: "ImagePullBackOff on nginx".into(),
            tools_called: vec!["get_events".into(), "describe_resource".into()],
            success: true,
            final_response: "wrong image tag".into(),
            error: None,
            duration_ms: 3000,
            turn_count: 2,
        });
        store.scan_and_update();

        let block = store.to_context_block("imagepull");
        assert!(block.contains("[Learned Strategies"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}

//! Multi-agent swarm — inspired by openocta's `swarm` package.
//!
//! Enables the main agent to spawn sub-agents for parallel or specialized work:
//!
//! - **Sub-agent spawning**: the main agent can delegate a sub-task to a
//!   specialized agent (e.g., "analyze all CrashLoopBackOff pods in parallel").
//! - **Result aggregation**: sub-agent results are collected and merged back
//!   into the main agent's context.
//! - **A2A protocol**: agents can communicate with each other via a simple
//!   message-passing protocol.
//!
//! The swarm is lightweight — sub-agents share the same `ToolRegistry` and
//! `LlmClient` factory, but each has its own conversation history and can
//! run concurrently via tokio tasks.

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

/// A message sent between agents (A2A protocol).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub from_agent: String,
    pub to_agent: String,
    pub content: String,
    pub message_type: AgentMessageType,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentMessageType {
    Task,
    Result,
    Query,
    Response,
    Error,
}

/// A sub-agent task to be executed.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentTask {
    pub id: String,
    pub agent_name: String,
    pub task: String,
    pub skill_id: Option<String>,
    pub max_turns: u32,
}

/// The result of a sub-agent execution.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentResult {
    pub task_id: String,
    pub agent_name: String,
    pub success: bool,
    pub response: String,
    pub tool_calls_made: u32,
    pub duration_ms: u64,
}

/// Orchestrator for multi-agent tasks. Manages sub-agent lifecycle and
/// result collection.
pub struct SwarmOrchestrator {
    /// Channel for receiving sub-agent results.
    result_tx: mpsc::Sender<SubAgentResult>,
    result_rx: mpsc::Receiver<SubAgentResult>,
    /// Active sub-agents.
    active: Vec<String>,
}

impl Default for SwarmOrchestrator {
    fn default() -> Self {
        Self::new()
    }
}

impl SwarmOrchestrator {
    pub fn new() -> Self {
        let (result_tx, result_rx) = mpsc::channel(100);
        Self {
            result_tx,
            result_rx,
            active: Vec::new(),
        }
    }

    /// Spawn a sub-agent task. Returns immediately; the result will arrive
    /// on the result channel.
    pub fn spawn(&mut self, task: SubAgentTask) {
        self.active.push(task.agent_name.clone());
        let tx = self.result_tx.clone();
        tokio::spawn(async move {
            let start = std::time::Instant::now();
            // In a real implementation, this would create a new AgentLoop
            // with the task's prompt and run it. For now, we simulate.
            let result = SubAgentResult {
                task_id: task.id,
                agent_name: task.agent_name,
                success: true,
                response: format!("Sub-agent completed: {}", task.task),
                tool_calls_made: 0,
                duration_ms: start.elapsed().as_millis() as u64,
            };
            let _ = tx.send(result).await;
        });
    }

    /// Collect all pending results (non-blocking).
    pub async fn collect_results(&mut self) -> Vec<SubAgentResult> {
        let mut results = Vec::new();
        while let Ok(result) = self.result_rx.try_recv() {
            self.active.retain(|a| a != &result.agent_name);
            results.push(result);
        }
        results
    }

    /// Wait for all sub-agents to complete.
    pub async fn wait_all(&mut self) -> Vec<SubAgentResult> {
        let mut results = Vec::new();
        while !self.active.is_empty() {
            if let Some(result) = self.result_rx.recv().await {
                self.active.retain(|a| a != &result.agent_name);
                results.push(result);
            }
        }
        results
    }

    pub fn active_count(&self) -> usize {
        self.active.len()
    }
}

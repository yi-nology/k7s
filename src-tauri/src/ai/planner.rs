//! Task planner — decomposes complex requests into executable sub-steps.
//!
//! Inspired by openocta's ability to handle tasks like "整理本周邮件要点并生成周报"
//! by breaking them into a sequence of tool calls. The planner:
//!
//! 1. Receives a complex user request.
//! 2. Asks the LLM to produce a structured plan (JSON list of steps).
//! 3. Executes each step via the agent loop, tracking dependencies.
//! 4. Reports progress to the frontend as [`PlanEvent`]s.
//!
//! The planner is activated when the user's message contains complex intent
//! (multiple actions, "and then", "first … then …", etc.) or when the user
//! explicitly asks to "plan" or "break down" a task.

use serde::{Deserialize, Serialize};

/// A single step in an execution plan.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    /// 0-based index.
    pub index: usize,
    /// Human-readable description of what this step does.
    pub description: String,
    /// The user message to send to the agent for this step.
    pub message: String,
    /// Indices of steps that must complete before this one can run.
    /// Empty = can run immediately.
    #[serde(default)]
    pub depends_on: Vec<usize>,
    /// Status of this step.
    #[serde(default)]
    pub status: StepStatus,
    /// The agent's final response for this step (filled after execution).
    #[serde(default)]
    pub result: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StepStatus {
    #[default]
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}


/// The full execution plan.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPlan {
    /// The original user request.
    pub request: String,
    /// The planned steps.
    pub steps: Vec<PlanStep>,
    /// Overall plan status.
    pub status: PlanStatus,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlanStatus {
    #[default]
    Planning,
    Executing,
    Completed,
    Failed,
}


/// Events emitted during plan execution (streamed to the frontend).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PlanEvent {
    /// The plan has been created.
    PlanCreated { plan: ExecutionPlan },
    /// A step started executing.
    StepStarted { index: usize },
    /// A step completed.
    StepCompleted { index: usize, result: String },
    /// A step failed.
    StepFailed { index: usize, error: String },
    /// The entire plan completed.
    PlanCompleted { plan: ExecutionPlan },
    /// The plan failed terminally.
    PlanFailed { error: String },
}

/// The system prompt that teaches the LLM to produce structured plans.
pub fn plan_system_prompt() -> &'static str {
    r#"You are a task planner for Kubernetes operations. Given a complex user request, decompose it into a structured plan of executable steps.

Output ONLY valid JSON — no markdown, no explanation. The JSON must be an array of step objects:

```json
[
  {
    "index": 0,
    "description": "Short description of what this step does",
    "message": "The exact message to send to the AI assistant for this step",
    "dependsOn": []
  },
  {
    "index": 1,
    "description": "Next step description",
    "message": "Next step message",
    "dependsOn": [0]
  }
]
```

Rules:
- Each step should be a single, focused action (one tool call or one question).
- Use `dependsOn` to express ordering constraints (e.g. step 1 needs step 0's output).
- Steps with empty `dependsOn` can run in parallel.
- Keep the plan small: 2–8 steps. If the task is simple (one tool call), return a single step.
- The `message` should be self-contained — the executing agent has NO memory of previous steps' conversations, so include all necessary context in each message.
- For "check and fix" patterns: first step diagnoses, second step proposes fix, third step executes fix.
- Always include a final "summarize" step that synthesizes the results."#
}

/// Check if a user message likely needs planning (contains multi-step intent).
pub fn needs_planning(message: &str) -> bool {
    let indicators = [
        " and then ",
        " and also ",
        " first ",
        " then ",
        " finally ",
        " after that ",
        " plan ",
        " break down ",
        " step by step ",
        " 依次 ",
        " 然后 ",
        " 首先 ",
        " 接着 ",
        " 最后 ",
        " 之后 ",
        " 排查并修复",
        " 检查并",
    ];
    let lower = message.to_lowercase();
    indicators.iter().any(|i| lower.contains(i))
        || (message.chars().count() > 100 && lower.contains(" and "))
}

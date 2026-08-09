//! Webhook endpoints — inspired by openocta's `/hooks/wake` and `/hooks/agent`.
//!
//! These HTTP endpoints allow external systems (monitoring, CI/CD, alerting)
//! to trigger AI agent actions:
//!
//! - **`/hooks/wake`**: wake the agent with a message (fire-and-forget).
//! - **`/hooks/agent`**: send a message and get the response back (sync).
//! - **`/hooks/event`**: push a cluster event for the agent to analyze.
//!
//! Hooks are authenticated via a shared secret token (configured in AiConfig).
//! They're mounted on the existing web server (`k7s-web`) when the AI module
//! is enabled.

use serde::{Deserialize, Serialize};

/// A webhook request payload.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookRequest {
    /// The message/prompt for the agent.
    pub message: String,
    /// Optional: trigger a specific skill.
    #[serde(default)]
    pub skill_id: Option<String>,
    /// Optional: kubeconfig context to use.
    #[serde(default)]
    pub context: Option<String>,
    /// Optional: priority level ("low", "normal", "high").
    #[serde(default = "default_priority")]
    pub priority: String,
    /// Optional: source system identifier.
    #[serde(default)]
    pub source: Option<String>,
}

fn default_priority() -> String {
    "normal".to_string()
}

/// A webhook response.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookResponse {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

/// An event pushed by external monitoring systems.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterEvent {
    /// Event type: "alert", "deployment", "scaling", "error", etc.
    pub event_type: String,
    /// Human-readable description.
    pub description: String,
    /// Affected resource (e.g. "deployment/payment in namespace prod").
    #[serde(default)]
    pub resource: Option<String>,
    /// Severity: "info", "warning", "critical".
    #[serde(default = "default_severity")]
    pub severity: String,
    /// Raw event data (JSON).
    #[serde(default)]
    pub data: Option<serde_json::Value>,
    /// Timestamp (ISO 8601).
    #[serde(default)]
    pub timestamp: Option<String>,
}

fn default_severity() -> String {
    "warning".to_string()
}

/// Hook authentication configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookConfig {
    /// Whether hooks are enabled.
    #[serde(default)]
    pub enabled: bool,
    /// Shared secret token for authentication.
    #[serde(default)]
    pub token: String,
    /// Allowed source IPs (empty = allow all).
    #[serde(default)]
    pub allowed_ips: Vec<String>,
}

impl Default for HookConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            token: String::new(),
            allowed_ips: Vec::new(),
        }
    }
}

/// Verify a hook request's authentication.
pub fn verify_hook(config: &HookConfig, auth_header: Option<&str>) -> bool {
    if !config.enabled {
        return false;
    }
    if config.token.is_empty() {
        return true; // no token configured = open access (dev mode)
    }
    match auth_header {
        Some(header) => {
            // Expect "Bearer <token>" or just the raw token.
            let token = header.strip_prefix("Bearer ").unwrap_or(header);
            token == config.token
        }
        None => false,
    }
}

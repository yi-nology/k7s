//! Sandbox security — inspired by openocta's SecurityConfig + CommandPolicy.
//!
//! Provides fine-grained security controls beyond the simple permission gate:
//!
//! - **Command policy**: deny/ask/allow rules for specific tool names and
//!   argument patterns (e.g., "deny delete_resource on namespace=kube-system",
//!   "ask before any write to production").
//! - **Path restrictions**: limit which namespaces/resources the agent can touch.
//! - **Resource limits**: cap CPU/memory the agent's operations can consume.
//! - **Secret detection**: block tool calls that would expose secrets.
//! - **Approval queue**: persistent queue with timeout for pending approvals.
//!
//! The sandbox sits between the permission gate and tool execution — it's a
//! more granular layer that evaluates specific tool+args combinations.

use serde::{Deserialize, Serialize};

/// Sandbox security configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxConfig {
    /// Master switch.
    #[serde(default)]
    pub enabled: bool,
    /// Security preset: "off", "loose", "standard", "strict".
    #[serde(default = "default_preset")]
    pub preset: String,
    /// Allowed namespaces (empty = all). The agent can only operate in these.
    #[serde(default)]
    pub allowed_namespaces: Vec<String>,
    /// Denied namespaces. The agent cannot touch these under any circumstances.
    #[serde(default)]
    pub denied_namespaces: Vec<String>,
    /// Command policy rules.
    #[serde(default)]
    pub rules: Vec<CommandRule>,
    /// Secret patterns to detect and block (regex).
    #[serde(default)]
    pub secret_patterns: Vec<String>,
    /// Max tool calls per minute.
    #[serde(default = "default_max_calls_per_minute")]
    pub max_calls_per_minute: u32,
    /// Max turns per run.
    #[serde(default = "default_max_turns")]
    pub max_turns: u32,
}

fn default_preset() -> String {
    "standard".to_string()
}
fn default_max_calls_per_minute() -> u32 {
    30
}
fn default_max_turns() -> u32 {
    10
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            preset: "standard".to_string(),
            allowed_namespaces: Vec::new(),
            denied_namespaces: vec!["kube-system".to_string(), "kube-public".to_string()],
            rules: Vec::new(),
            secret_patterns: vec![
                r"(?i)(password|secret|token|api[_-]?key)\s*[:=]\s*\S+".to_string()
            ],
            max_calls_per_minute: 30,
            max_turns: 10,
        }
    }
}

/// A single command policy rule.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRule {
    /// "deny", "ask", "allow".
    pub action: String,
    /// Tool name pattern (e.g., "delete_*", "scale_*", "*").
    pub tool_pattern: String,
    /// Argument pattern (e.g., "namespace=kube-system", "kind=secrets").
    /// Empty = matches all arguments.
    #[serde(default)]
    pub arg_pattern: Option<String>,
    /// Human-readable reason (shown to user when blocking).
    #[serde(default)]
    pub reason: String,
}

/// The result of sandbox evaluation.
#[derive(Clone, Debug)]
pub enum SandboxDecision {
    /// Allow the tool call.
    Allow,
    /// Ask the user for approval (with a reason).
    Ask { reason: String },
    /// Deny the tool call entirely.
    Deny { reason: String },
}

/// Evaluate a tool call against the sandbox rules.
pub fn evaluate(
    config: &SandboxConfig,
    tool_name: &str,
    args: &serde_json::Value,
) -> SandboxDecision {
    if !config.enabled {
        return SandboxDecision::Allow;
    }

    // Check denied namespaces.
    if let Some(ns) = args.get("namespace").and_then(|v| v.as_str()) {
        if config.denied_namespaces.iter().any(|d| d == ns) {
            return SandboxDecision::Deny {
                reason: format!("namespace '{ns}' is in the denied list"),
            };
        }
        // If allowed_namespaces is non-empty, the namespace must be in it.
        if !config.allowed_namespaces.is_empty()
            && !config.allowed_namespaces.iter().any(|a| a == ns)
        {
            return SandboxDecision::Deny {
                reason: format!("namespace '{ns}' is not in the allowed list"),
            };
        }
    }

    // Check command policy rules (first match wins).
    for rule in &config.rules {
        if matches_pattern(tool_name, &rule.tool_pattern) {
            // Check arg pattern if specified.
            if let Some(ref arg_pat) = rule.arg_pattern {
                let args_str = serde_json::to_string(args).unwrap_or_default();
                if !args_str.contains(arg_pat) {
                    continue; // arg pattern doesn't match, skip this rule
                }
            }
            return match rule.action.as_str() {
                "deny" => SandboxDecision::Deny {
                    reason: rule.reason.clone(),
                },
                "ask" => SandboxDecision::Ask {
                    reason: rule.reason.clone(),
                },
                _ => SandboxDecision::Allow,
            };
        }
    }

    // Check for secret exposure in arguments.
    let args_str = serde_json::to_string(args).unwrap_or_default();
    for pattern in &config.secret_patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            if re.is_match(&args_str) {
                return SandboxDecision::Deny {
                    reason:
                        "arguments may contain secrets (password/token/api_key pattern detected)"
                            .into(),
                };
            }
        }
    }

    SandboxDecision::Allow
}

fn matches_pattern(name: &str, pattern: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if let Some(suffix) = pattern.strip_suffix('*') {
        return name.starts_with(suffix);
    }
    if let Some(prefix) = pattern.strip_prefix('*') {
        return name.ends_with(prefix);
    }
    name == pattern
}

/// Preset sandbox configurations.
pub fn presets() -> Vec<(&'static str, SandboxConfig)> {
    vec![
        (
            "off",
            SandboxConfig {
                enabled: false,
                preset: "off".into(),
                ..Default::default()
            },
        ),
        (
            "loose",
            SandboxConfig {
                enabled: true,
                preset: "loose".into(),
                denied_namespaces: vec!["kube-system".into()],
                max_calls_per_minute: 60,
                max_turns: 15,
                ..Default::default()
            },
        ),
        ("standard", SandboxConfig::default()),
        (
            "strict",
            SandboxConfig {
                enabled: true,
                preset: "strict".into(),
                denied_namespaces: vec![
                    "kube-system".into(),
                    "kube-public".into(),
                    "kube-node-lease".into(),
                ],
                rules: vec![
                    CommandRule {
                        action: "ask".into(),
                        tool_pattern: "delete_*".into(),
                        arg_pattern: None,
                        reason: "delete operations require approval in strict mode".into(),
                    },
                    CommandRule {
                        action: "ask".into(),
                        tool_pattern: "apply_manifest".into(),
                        arg_pattern: None,
                        reason: "apply operations require approval in strict mode".into(),
                    },
                ],
                max_calls_per_minute: 15,
                max_turns: 8,
                ..Default::default()
            },
        ),
    ]
}

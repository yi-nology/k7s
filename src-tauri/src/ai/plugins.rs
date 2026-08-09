//! Plugin SDK with lifecycle hooks — inspired by openocta's `plugin-sdk` and
//! `hooks` packages.
//!
//! A "plugin" is a Rust trait object that receives lifecycle events from the
//! agent loop. Plugins can:
//!
//! - **Pre-process** messages before they reach the LLM (e.g., add context,
//!   filter sensitive data, inject system prompts).
//! - **Post-process** responses after the LLM returns (e.g., format output,
//!   log to audit trail, send notifications).
//! - **Intercept tool calls** before/after execution (e.g., add rate limiting,
//!   enforce policies, log tool usage).
//! - **Receive events** about agent lifecycle (start, end, error, cancel).
//!
//! Plugins are registered at startup and called in order. Each plugin can
//! pass, modify, or block the message/call.

use serde::{Deserialize, Serialize};

/// The lifecycle events a plugin can receive.
#[derive(Clone, Debug)]
pub enum PluginEvent<'a> {
    /// A new agent run is starting.
    RunStart {
        run_id: &'a str,
        user_message: &'a str,
    },
    /// A user message is about to be sent to the LLM.
    BeforeLlm {
        run_id: &'a str,
        messages: &'a [crate::ai::llm::Message],
    },
    /// The LLM returned a response.
    AfterLlm { run_id: &'a str, response: &'a str },
    /// A tool call is about to be dispatched.
    BeforeTool {
        run_id: &'a str,
        tool_name: &'a str,
        args: &'a serde_json::Value,
    },
    /// A tool call completed.
    AfterTool {
        run_id: &'a str,
        tool_name: &'a str,
        result: &'a Result<serde_json::Value, String>,
    },
    /// The agent run completed.
    RunEnd {
        run_id: &'a str,
        final_message: Option<&'a str>,
    },
    /// The agent run failed.
    RunError { run_id: &'a str, error: &'a str },
}

/// Plugin decision after processing an event.
#[derive(Clone, Debug)]
pub enum PluginDecision {
    /// Continue processing (pass-through).
    Continue,
    /// Modify the value and continue.
    Modify(serde_json::Value),
    /// Block further processing (the message/tool call is rejected).
    Block { reason: String },
}

/// The plugin trait — implement this to add custom behavior to the agent.
pub trait AgentPlugin: Send + Sync {
    /// Plugin name (for logging and identification).
    fn name(&self) -> &str;

    /// Plugin priority (lower = called first). Default: 100.
    fn priority(&self) -> u32 {
        100
    }

    /// Handle a lifecycle event. Return `Continue` to pass through,
    /// `Modify` to transform the value, or `Block` to reject.
    fn on_event(&self, event: &PluginEvent) -> PluginDecision {
        // Default: pass through.
        let _ = event;
        PluginDecision::Continue
    }
}

/// Registry of active plugins.
pub struct PluginRegistry {
    plugins: Vec<Box<dyn AgentPlugin>>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self {
            plugins: Vec::new(),
        }
    }

    /// Register a plugin. Plugins are sorted by priority after each add.
    pub fn register(&mut self, plugin: Box<dyn AgentPlugin>) {
        self.plugins.push(plugin);
        self.plugins.sort_by_key(|p| p.priority());
    }

    /// Fire an event through all plugins. Returns `Block` if any plugin blocks.
    pub fn fire(&self, event: &PluginEvent) -> PluginDecision {
        for plugin in &self.plugins {
            match plugin.on_event(event) {
                PluginDecision::Continue => continue,
                PluginDecision::Modify(v) => return PluginDecision::Modify(v),
                PluginDecision::Block { reason } => {
                    tracing::info!("plugin '{}' blocked event: {reason}", plugin.name());
                    return PluginDecision::Block { reason };
                }
            }
        }
        PluginDecision::Continue
    }

    pub fn list(&self) -> Vec<&str> {
        self.plugins.iter().map(|p| p.name()).collect()
    }
}

impl Default for PluginRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Built-in plugin: audit logger. Logs every tool call to the tracing output.
pub struct AuditLogger;

impl AgentPlugin for AuditLogger {
    fn name(&self) -> &str {
        "audit-logger"
    }

    fn priority(&self) -> u32 {
        200 // low priority — runs last
    }

    fn on_event(&self, event: &PluginEvent) -> PluginDecision {
        match event {
            PluginEvent::BeforeTool {
                tool_name, args, ..
            } => {
                tracing::info!(tool = tool_name, "AI tool call");
                let _ = args;
            }
            PluginEvent::AfterTool {
                tool_name, result, ..
            } => match result {
                Ok(_) => tracing::info!(tool = tool_name, "AI tool succeeded"),
                Err(e) => tracing::warn!(tool = tool_name, error = %e, "AI tool failed"),
            },
            PluginEvent::RunError { error, .. } => {
                tracing::error!(error = %error, "AI run failed");
            }
            _ => {}
        }
        PluginDecision::Continue
    }
}

/// Built-in plugin: rate limiter. Blocks tool calls if too many are made
/// within a short time window.
pub struct RateLimiter {
    max_per_minute: u32,
    calls: std::sync::Mutex<Vec<std::time::Instant>>,
}

impl RateLimiter {
    pub fn new(max_per_minute: u32) -> Self {
        Self {
            max_per_minute,
            calls: std::sync::Mutex::new(Vec::new()),
        }
    }
}

impl AgentPlugin for RateLimiter {
    fn name(&self) -> &str {
        "rate-limiter"
    }

    fn priority(&self) -> u32 {
        10 // high priority — runs first
    }

    fn on_event(&self, event: &PluginEvent) -> PluginDecision {
        if let PluginEvent::BeforeTool { tool_name, .. } = event {
            let mut calls = self.calls.lock().unwrap();
            let now = std::time::Instant::now();
            // Remove calls older than 1 minute.
            calls.retain(|t| now.duration_since(*t) < std::time::Duration::from_secs(60));
            if calls.len() >= self.max_per_minute as usize {
                return PluginDecision::Block {
                    reason: format!(
                        "rate limit exceeded: {} calls in the last minute (max {})",
                        calls.len(),
                        self.max_per_minute
                    ),
                };
            }
            calls.push(now);
        }
        PluginDecision::Continue
    }
}

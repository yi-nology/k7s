//! AI assistant module — a built-in, runtime-toggleable Kubernetes AI agent.
//!
//! Inspired by openocta's "natural language → automatic execution" experience,
//! specialized for k8s ops. Unlike k7s's existing MCP server (which exposes
//! tools for *external* AI clients to drive), this module embeds the LLM
//! *inside* k7s itself, so the user gets a chat panel right in the app.
//!
//! # Architecture (one-paragraph tour)
//!
//! [`config`] loads the user's `AiConfig` (provider/permission/toggle) from
//! `ai-config.json`; the `api_key` is stored separately, obfuscated, in
//! [`secret`]. [`llm::OpenAiClient`] is the OpenAI-compatible streaming client
//! (covers DeepSeek/Kimi/Zhipu/OpenAI/Ollama). [`tools`] is an *independent*
//! tool set — a `Tool` trait + `ToolRegistry`, ~12 tools in read/write/diag
//! groups — designed for LLM function-calling (Plan C). Under the hood every
//! tool reuses [`crate::mcp::kube_api`]'s free functions, so there's no second
//! cluster-access layer (Plan A reuse). [`permission`] is the hard gate write
//! tools pass through. [`agent::AgentLoop`] is the ReAct cycle: LLM → tool
//! calls → permission gate → execute → loop, streaming events to the caller
//! via the transport-agnostic [`agent::EventSink`] trait.
//!
//! # Runtime toggle
//!
//! The whole module is compiled into every build (no Cargo feature gate), but
//! [`AiConfig::enabled`] defaults to `false`. When disabled, the Tauri
//! `ai_chat` command refuses and the UI hides the panel. Flipping the toggle in
//! settings is enough — no recompile, no separate binary.

pub mod agent;
pub mod config;
pub mod context;
pub mod error;
pub mod im;
pub mod llm;
pub mod memory;
pub mod permission;
pub mod secret;
pub mod skills;
pub mod tools;

pub use agent::{AgentEvent, AgentLoop, ChatRequest, EventSink};
pub use config::{AiConfig, AiConfigView, LlmProviderConfig, PermissionMode};
pub use error::{AiError, AiResult};
pub use im::{ImGatewayConfig, ImMessage, ImReply};
pub use llm::{FunctionDef, LlmClient, Message, OpenAiClient};
pub use memory::{MemoryEntry, MemorySource, MemoryStore};
pub use skills::{Skill, SkillExample, SkillRegistry};
pub use tools::{ToolContext, ToolRegistry};

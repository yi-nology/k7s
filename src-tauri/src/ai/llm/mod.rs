//! LLM client abstraction.
//!
//! The agent loop talks to a [`LlmClient`] and doesn't know which provider is
//! behind it. Today the only implementation is [`openai::OpenAiClient`], which
//! covers DeepSeek, Kimi, Zhipu, OpenAI itself, and local Ollama (all of which
//! expose an OpenAI-compatible `/chat/completions` surface with
//! `tools`/`tool_calls` function-calling).
//!
//! The streaming model: [`LlmClient::chat_stream`] returns an async iterator of
//! [`StreamEvent`]s — incremental assistant text deltas plus, at the end of the
//! turn, the full resolved `tool_calls` array (OpenAI streams tool calls as
//! fragmentary deltas across many SSE chunks; we assemble them so the agent
//! loop never has to deal with partial JSON).

pub mod openai;

use crate::ai::error::AiResult;
use futures::Stream;
use serde::{Deserialize, Serialize};
use std::pin::Pin;

pub use openai::OpenAiClient;

/// A single message in the chat history sent to the LLM.
///
/// This is the canonical representation the agent loop works with; the
/// OpenAI-specific wire JSON is assembled inside `openai.rs`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "lowercase")]
pub enum Message {
    System {
        content: String,
    },
    User {
        content: String,
    },
    Assistant {
        content: Option<String>,
        /// tool calls the assistant made this turn (None when it just replied
        /// with text). Ids + function name + raw-JSON args.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_calls: Option<Vec<OutgoingToolCall>>,
    },
    /// The result of a tool call, fed back to the model. OpenAI pins this to a
    /// tool_call_id; we carry that through here.
    Tool {
        tool_call_id: String,
        content: String,
    },
}

/// A tool call the assistant wants us to execute.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OutgoingToolCall {
    pub id: String,
    pub name: String,
    /// Raw JSON string of arguments (as OpenAI returns it).
    pub arguments: String,
}

/// The function-call definition handed to the LLM (one per AI tool).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FunctionDef {
    pub name: String,
    pub description: String,
    /// JSON Schema for the parameters object.
    pub parameters: serde_json::Value,
}

/// What the agent loop receives as the stream progresses.
#[derive(Clone, Debug)]
pub enum StreamEvent {
    /// A chunk of assistant text (streamed token-by-token to the UI).
    TextDelta(String),
    /// A chunk of reasoning text from reasoning models (MiMo, DeepSeek R1).
    /// Displayed separately as a collapsible thinking block.
    ReasoningDelta(String),
    /// The turn finished; if tool_calls is non-empty, the agent should dispatch
    /// them and loop, otherwise this is the final answer.
    Done {
        tool_calls: Vec<OutgoingToolCall>,
        finish_reason: String,
    },
}

/// A boxed async stream of [`StreamEvent`]s. Boxed so the trait can stay
/// object-safe-ish without naming the concrete stream type.
pub type StreamItem = AiResult<StreamEvent>;
pub type ChatStream = Pin<Box<dyn Stream<Item = StreamItem> + Send>>;

/// The one method the agent loop needs from a provider.
pub trait LlmClient: Send + Sync {
    /// Start a streaming chat completion.
    ///
    /// `messages` is the full conversation so far; `tools` is the function defs
    /// on offer this turn (the agent loop may filter write tools out when the
    /// permission mode is read-only).
    fn chat_stream(&self, messages: &[Message], tools: &[FunctionDef]) -> ChatStream;
}

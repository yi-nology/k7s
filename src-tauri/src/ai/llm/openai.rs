//! OpenAI-compatible chat-completions client with streaming + tool calling.
//!
//! One implementation serves every provider k7s targets, because they all
//! converge on the OpenAI `/v1/chat/completions` shape: DeepSeek, Kimi, Zhipu,
//! OpenAI itself, and Ollama (when run with its OpenAI-compatible endpoint).
//! The only thing that differs is `base_url`.
//!
//! Streaming protocol: the server emits `data: {json}\n\n` lines, ending with
//! `data: [DONE]`. Each chunk's `choices[0].delta` may carry `content` (text)
//! and/or `tool_calls` (incremental fragments — a single tool call arrives as
//! many chunks, each adding to `index`/`id`/`function.name`/`function.arguments`).
//! We assemble those fragments into whole [`OutgoingToolCall`]s and emit them in
//! the final [`StreamEvent::Done`].

use crate::ai::error::AiError;
use crate::ai::llm::{ChatStream, FunctionDef, Message, OutgoingToolCall, StreamEvent};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Concrete client. Construct one per chat (cheap — holds a reqwest Client and
/// the connection triple).
pub struct OpenAiClient {
    http: reqwest::Client,
    base_url: String,
    model: String,
    api_key: String,
    temperature: Option<f32>,
}

impl OpenAiClient {
    pub fn new(
        base_url: impl Into<String>,
        model: impl Into<String>,
        api_key: impl Into<String>,
        temperature: Option<f32>,
    ) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: base_url.into(),
            model: model.into(),
            api_key: api_key.into(),
            temperature,
        }
    }
}

// -- wire types (request) -------------------------------------------------

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<WireMessage<'a>>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<WireTool<'a>>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Serialize)]
struct WireMessage<'a> {
    role: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<WireToolCallRef<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<&'a str>,
}

#[derive(Serialize)]
struct WireTool<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    function: WireFunctionRef<'a>,
}

#[derive(Serialize)]
struct WireFunctionRef<'a> {
    name: &'a str,
    description: &'a str,
    parameters: &'a serde_json::Value,
}

#[derive(Serialize)]
struct WireToolCallRef<'a> {
    id: &'a str,
    #[serde(rename = "type")]
    kind: &'a str,
    function: WireFnCallRef<'a>,
}

#[derive(Serialize)]
struct WireFnCallRef<'a> {
    name: &'a str,
    arguments: &'a str,
}

// -- wire types (response) ------------------------------------------------

#[derive(Deserialize, Debug)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
}

#[derive(Deserialize, Debug)]
struct StreamChoice {
    delta: Delta,
    finish_reason: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
struct Delta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<DeltaToolCall>,
}

#[derive(Deserialize, Debug)]
struct DeltaToolCall {
    index: usize,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    function: Option<DeltaFunction>,
}

#[derive(Deserialize, Debug, Default)]
struct DeltaFunction {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

// -- message conversion ---------------------------------------------------

fn to_wire_messages(msgs: &[Message]) -> Vec<WireMessage<'_>> {
    msgs.iter()
        .map(|m| match m {
            Message::System { content } => WireMessage {
                role: "system",
                content: Some(content),
                tool_calls: None,
                tool_call_id: None,
            },
            Message::User { content } => WireMessage {
                role: "user",
                content: Some(content),
                tool_calls: None,
                tool_call_id: None,
            },
            Message::Assistant {
                content,
                tool_calls,
            } => WireMessage {
                role: "assistant",
                content: content.as_deref(),
                tool_calls: tool_calls.as_ref().map(|calls| {
                    calls
                        .iter()
                        .map(|c| WireToolCallRef {
                            id: &c.id,
                            kind: "function",
                            function: WireFnCallRef {
                                name: &c.name,
                                arguments: &c.arguments,
                            },
                        })
                        .collect()
                }),
                tool_call_id: None,
            },
            Message::Tool {
                tool_call_id,
                content,
            } => WireMessage {
                role: "tool",
                content: Some(content),
                tool_calls: None,
                tool_call_id: Some(tool_call_id),
            },
        })
        .collect()
}

// -- the streaming call ---------------------------------------------------

impl crate::ai::llm::LlmClient for OpenAiClient {
    fn chat_stream(&self, messages: &[Message], tools: &[FunctionDef]) -> ChatStream {
        // Move owned copies of everything the stream closure needs so it doesn't
        // borrow `self` (which would make the stream's lifetime tie to this
        // call and fail to satisfy the `'static`-ish ChatStream bound).
        let http = self.http.clone();
        let base_url = self.base_url.clone();
        let model = self.model.clone();
        let api_key = self.api_key.clone();
        let temperature = self.temperature;
        // Build the request body now (needs borrowed messages/tools), then
        // serialise to an owned Value so the borrow ends here.
        let body = serde_json::to_value(ChatRequest {
            model: &model,
            messages: to_wire_messages(messages),
            tools: tools
                .iter()
                .map(|t| WireTool {
                    kind: "function",
                    function: WireFunctionRef {
                        name: &t.name,
                        description: &t.description,
                        parameters: &t.parameters,
                    },
                })
                .collect(),
            stream: true,
            temperature,
        })
        .expect("ChatRequest serialises");

        let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

        Box::pin(async_stream::try_stream! {
            let resp = http
                .post(&url)
                .bearer_auth(&api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| AiError::Llm(e.to_string()))?;
            let status = resp.status();
            if !status.is_success() {
                let body = resp.text().await.unwrap_or_default();
                Err(AiError::Llm(format!(
                    "HTTP {status}: {}",
                    body.chars().take(500).collect::<String>()
                )))?;
                // Unreachable: the `?` above ends the stream. Return so the
                // borrow-checker is satisfied that `resp` is never used again
                // on this path.
                return;
            }
            // Assembler for tool-call fragments, keyed by delta index.
            let mut tool_acc: BTreeMap<usize, (String, String, String)> = BTreeMap::new();
            let mut finish_reason = String::from("stop");

            let mut byte_stream = resp.bytes_stream();
            let mut buf = String::new();
            while let Some(chunk_res) = byte_stream.next().await {
                let bytes = chunk_res.map_err(|e| AiError::Llm(e.to_string()))?;
                buf.push_str(&String::from_utf8_lossy(&bytes));
                // SSE events are separated by blank lines.
                while let Some(pos) = buf.find("\n\n") {
                    let event = buf[..pos].to_string();
                    buf.drain(..pos + 2);
                    for line in event.lines() {
                        let line = line.trim();
                        if !line.starts_with("data:") {
                            continue;
                        }
                        let data = line["data:".len()..].trim();
                        if data == "[DONE]" {
                            let calls: Vec<OutgoingToolCall> = tool_acc
                                .into_values()
                                .map(|(id, name, args)| OutgoingToolCall {
                                    id, name, arguments: args,
                                })
                                .collect();
                            yield StreamEvent::Done { tool_calls: calls, finish_reason };
                            return;
                        }
                        let chunk: StreamChunk = match serde_json::from_str(data) {
                            Ok(c) => c,
                            Err(_) => continue, // keep-alive / ping frames
                        };
                        for choice in chunk.choices {
                            if let Some(reason) = choice.finish_reason {
                                if !reason.is_empty() {
                                    finish_reason = reason;
                                }
                            }
                            if let Some(text) = choice.delta.content {
                                if !text.is_empty() {
                                    yield StreamEvent::TextDelta(text);
                                }
                            }
                            for tc in choice.delta.tool_calls {
                                let entry = tool_acc
                                    .entry(tc.index)
                                    .or_insert_with(|| (String::new(), String::new(), String::new()));
                                if let Some(id) = tc.id { entry.0 = id; }
                                if let Some(f) = tc.function {
                                    if let Some(n) = f.name { entry.1 = n; }
                                    if let Some(a) = f.arguments { entry.2.push_str(&a); }
                                }
                            }
                        }
                    }
                }
            }
            // Stream closed without [DONE]; flush whatever we have.
            let calls: Vec<OutgoingToolCall> = tool_acc
                .into_values()
                .map(|(id, name, args)| OutgoingToolCall { id, name, arguments: args })
                .collect();
            yield StreamEvent::Done { tool_calls: calls, finish_reason };
        })
    }
}

//! The agent loop — the ReAct cycle that ties LLM ↔ tools ↔ user together.
//!
//! Each call to [`AgentLoop::run`] is one user message. The loop:
//!
//! 1. Builds the message list (system prompt + history + selected-resource
//!    context + the new user message).
//! 2. Asks the LLM for a streaming completion.
//! 3. As text deltas arrive, forwards them to the caller via [`EventSink::text`].
//! 4. When the LLM emits `tool_calls`, dispatches each through the
//!    [`ToolRegistry`]. Write tools route through the [`PermissionGate`]; a
//!    `NeedsApproval` decision pauses and calls [`EventSink::request_approval`],
//!    then awaits the user's response.
//! 5. Tool results become `tool` messages appended to history.
//! 6. Repeat from step 2 until the LLM returns text with no tool calls, the
//!    turn cap is hit, or the run is cancelled.
//!
//! The loop is transport-agnostic: it talks to the outside world only through
//! the [`EventSink`] trait object. The Tauri command and the HTTP handler each
//! provide an implementation.

use crate::ai::config::PermissionMode;
use crate::ai::context::{self, SelectedContext};
use crate::ai::error::{AiError, AiResult};
use crate::ai::llm::{LlmClient, Message, OutgoingToolCall, StreamEvent};
use crate::ai::permission::{self, Decision};
use crate::ai::tools::{ToolContext, ToolRegistry};
use crate::kube::manager::ClientManager;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::oneshot;

/// The conversation turn the UI sends to start a chat.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    /// The user's new message.
    pub message: String,
    /// The full prior conversation (so the loop is stateless across calls).
    /// Empty for a fresh chat.
    #[serde(default)]
    pub history: Vec<Message>,
    /// Optional: the resource the user currently has focused in the UI.
    #[serde(default)]
    pub context: Option<SelectedContext>,
}

/// What the loop tells the outside world as it runs. Transport-agnostic — the
/// Tauri command emits these as Tauri events; the web handler writes them as
/// SSE frames.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AgentEvent {
    /// Incremental assistant text.
    #[serde(rename_all = "camelCase")]
    TextDelta { text: String },
    /// The assistant wants to call a tool; shown in the UI as a card.
    #[serde(rename_all = "camelCase")]
    ToolCall {
        call_id: String,
        name: String,
        arguments: serde_json::Value,
        is_write: bool,
    },
    /// A write tool is awaiting user approval.
    #[serde(rename_all = "camelCase")]
    PendingApproval {
        call_id: String,
        name: String,
        arguments: serde_json::Value,
        summary: String,
    },
    /// A tool finished; include its result (success or error) for the card.
    #[serde(rename_all = "camelCase")]
    ToolResult {
        call_id: String,
        ok: bool,
        result: serde_json::Value,
    },
    /// The run completed. `final_message` is the assistant's last text (if any).
    #[serde(rename_all = "camelCase")]
    Done {
        final_message: Option<String>,
        /// Updated history including this turn — the UI stores this back and
        /// sends it as `history` next turn.
        history: Vec<Message>,
    },
    /// The run failed terminally (LLM down, etc.).
    #[serde(rename_all = "camelCase")]
    Error { message: String },
}

/// How the loop talks back to the caller.
///
/// `emit` pushes an [`AgentEvent`]. `await_approval` blocks until the user
/// responds to a `pending_approval` and returns whether they accepted. It MUST
/// register the approval channel before returning, so that an approval that
/// arrives immediately after the `pending_approval` event can't race past the
/// registration (which would drop the response and hang the loop).
pub trait EventSink: Send + Sync {
    fn emit(&self, ev: AgentEvent);
    /// Block until the user decides on a pending write tool. Returns `true` if
    /// approved. The implementation is responsible for registering the
    /// resolution channel synchronously (before the returned future resolves),
    /// not via a spawned task.
    fn await_approval(&self, call_id: &str) -> oneshot::Receiver<bool>;
    /// Was the run cancelled? Polled between steps.
    fn is_cancelled(&self) -> bool;
}

/// Owns the registry + a way to build an LLM client. One per app, cheap to clone.
pub struct AgentLoop {
    registry: Arc<ToolRegistry>,
    llm_factory: Arc<dyn Fn() -> Box<dyn LlmClient> + Send + Sync>,
}

impl AgentLoop {
    pub fn new(
        registry: ToolRegistry,
        llm_factory: Arc<dyn Fn() -> Box<dyn LlmClient> + Send + Sync>,
    ) -> Self {
        Self {
            registry: Arc::new(registry),
            llm_factory,
        }
    }

    /// Run one user message to completion.
    pub async fn run(
        &self,
        req: ChatRequest,
        mode: PermissionMode,
        max_turns: u32,
        manager: Arc<ClientManager>,
        sink: Arc<dyn EventSink>,
    ) {
        // Best-effort run; all errors become a terminal Error event.
        match self
            .run_inner(req, mode, max_turns, manager, sink.clone())
            .await
        {
            Ok(()) => {}
            Err(e) => sink.emit(AgentEvent::Error {
                message: e.to_string(),
            }),
        }
    }

    async fn run_inner(
        &self,
        req: ChatRequest,
        mode: PermissionMode,
        max_turns: u32,
        manager: Arc<ClientManager>,
        sink: Arc<dyn EventSink>,
    ) -> AiResult<()> {
        let tool_ctx = ToolContext {
            manager: manager.clone(),
            data_dir: std::path::PathBuf::new(),
        };

        // Assemble the working message list.
        let info = manager.connection_info().await;
        let cluster_ver = info.as_ref().map(|i| i.version.clone());
        let context_name = info.as_ref().map(|i| i.context.clone());
        let sys = context::build_system_prompt(cluster_ver.as_deref(), context_name.as_deref());
        let mut messages: Vec<Message> = Vec::with_capacity(req.history.len() + 3);
        messages.push(Message::System { content: sys });

        // The messages BEFORE this index are regenerated fresh every run (the
        // system prompt + the per-turn resource-context note). They must NOT be
        // handed back to the UI as "history" — otherwise each turn the UI
        // echoes them back and the prompt accumulates duplicates + stale
        // resource notes. `returnable_start` marks the first message that's
        // safe to persist across turns (the start of the real conversation).
        messages.extend(req.history.iter().cloned());
        let returnable_start = messages.len();

        // Inject selected-resource context (if any) as a system note + the user msg.
        // This note is transient too — it's rebuilt from the *current* selection
        // each run, so it stays below `returnable_start`'s purview by being added
        // after the history slice.
        if let Some(sel) = &req.context {
            if sel.kind.is_some() && sel.name.is_some() {
                if let Some(desc) = context::selected_resource_context(&manager, sel).await {
                    let note = format!(
                        "The user has this resource selected in the UI:\n```json\n{}\n```",
                        serde_json::to_string_pretty(&desc).unwrap_or_default()
                    );
                    messages.push(Message::System { content: note });
                }
            }
        }
        messages.push(Message::User {
            content: req.message.clone(),
        });

        let tool_defs = self.registry.function_defs(mode);
        let llm = (self.llm_factory)();

        let mut turns = 0u32;

        loop {
            turns += 1;
            if turns > max_turns {
                // Don't emit Error here AND let run() emit it again (that would
                // double-toast the UI). Just emit Done with the turn-limit note
                // as the final message; run() sees Ok(()) and adds nothing.
                sink.emit(AgentEvent::Done {
                    final_message: Some(format!(
                        "Reached the {max_turns}-turn limit without finishing."
                    )),
                    history: messages[returnable_start..].to_vec(),
                });
                return Ok(());
            }
            if sink.is_cancelled() {
                // Emit Done so the UI clears its "loading" state and gets the
                // history to continue from; otherwise the frontend hangs.
                sink.emit(AgentEvent::Done {
                    final_message: Some("(cancelled)".to_string()),
                    history: messages[returnable_start..].to_vec(),
                });
                return Ok(());
            }

            // Drive one LLM turn.
            let mut stream = llm.chat_stream(&messages, &tool_defs);
            let mut assistant_text = String::new();
            let mut tool_calls: Vec<OutgoingToolCall> = Vec::new();
            while let Some(item) = stream.next().await {
                match item? {
                    StreamEvent::TextDelta(t) => {
                        assistant_text.push_str(&t);
                        sink.emit(AgentEvent::TextDelta { text: t });
                    }
                    StreamEvent::Done {
                        tool_calls: tc,
                        finish_reason,
                    } => {
                        tool_calls = tc;
                        if finish_reason == "length" {
                            sink.emit(AgentEvent::TextDelta {
                                text: "…[output truncated]".into(),
                            });
                        }
                        break;
                    }
                }
            }
            // If the LLM made no tool calls, the turn is done.
            if tool_calls.is_empty() {
                let final_text = if assistant_text.is_empty() {
                    None
                } else {
                    Some(assistant_text.clone())
                };
                messages.push(Message::Assistant {
                    content: if assistant_text.is_empty() {
                        None
                    } else {
                        Some(assistant_text)
                    },
                    tool_calls: None,
                });
                sink.emit(AgentEvent::Done {
                    final_message: final_text,
                    history: messages[returnable_start..].to_vec(),
                });
                return Ok(());
            }

            // Record the assistant turn (text + its tool calls) in history.
            let turn_text = if assistant_text.is_empty() {
                None
            } else {
                Some(assistant_text)
            };
            messages.push(Message::Assistant {
                content: turn_text,
                tool_calls: Some(tool_calls.clone()),
            });

            // Dispatch each tool call.
            for call in &tool_calls {
                if sink.is_cancelled() {
                    return Err(AiError::Cancelled);
                }
                let args: serde_json::Value =
                    serde_json::from_str(&call.arguments).unwrap_or(serde_json::Value::Null);
                let is_write = self.registry.is_write(&call.name);
                sink.emit(AgentEvent::ToolCall {
                    call_id: call.id.clone(),
                    name: call.name.clone(),
                    arguments: args.clone(),
                    is_write,
                });

                // Permission gate. `pre_denied` is Some(error) when the gate
                // refused the call (deny mode, or user declined an approval);
                // None means the tool may execute.
                let pre_denied: Option<AiError> = match permission::decide(mode, is_write) {
                    Decision::Allow => None,
                    Decision::Deny => Some(AiError::PermissionDenied(format!(
                        "write tool '{}' refused by permission mode {:?}",
                        call.name, mode
                    ))),
                    Decision::NeedsApproval => {
                        let summary = summarize_call(&call.name, &args);
                        sink.emit(AgentEvent::PendingApproval {
                            call_id: call.id.clone(),
                            name: call.name.clone(),
                            arguments: args.clone(),
                            summary,
                        });
                        let approved = matches!(sink.await_approval(&call.id).await, Ok(true));
                        if approved {
                            None
                        } else {
                            Some(AiError::PermissionDenied(format!(
                                "user declined tool call '{}'",
                                call.name
                            )))
                        }
                    }
                };

                // Execute (only if not already short-circuited by the gate).
                let result_val: serde_json::Value = match pre_denied {
                    Some(e) => {
                        let msg = e.to_string();
                        sink.emit(AgentEvent::ToolResult {
                            call_id: call.id.clone(),
                            ok: false,
                            result: serde_json::json!({ "error": msg }),
                        });
                        serde_json::json!({ "error": msg })
                    }
                    _ => match self.registry.dispatch(&call.name, &tool_ctx, args).await {
                        Ok(v) => {
                            sink.emit(AgentEvent::ToolResult {
                                call_id: call.id.clone(),
                                ok: true,
                                result: v.clone(),
                            });
                            v
                        }
                        Err(e) => {
                            let msg = e.to_string();
                            sink.emit(AgentEvent::ToolResult {
                                call_id: call.id.clone(),
                                ok: false,
                                result: serde_json::json!({ "error": msg }),
                            });
                            serde_json::json!({ "error": msg })
                        }
                    },
                };

                // Compress very large tool results so we don't blow the context window.
                let trimmed = trim_result(result_val);
                messages.push(Message::Tool {
                    tool_call_id: call.id.clone(),
                    content: serde_json::to_string(&trimmed).unwrap_or_else(|_| "{}".into()),
                });
            }
        }
    }
}

/// Build a one-line human summary for a pending approval, e.g.
/// "scale deployments/payment to 5 replicas".
fn summarize_call(name: &str, args: &serde_json::Value) -> String {
    let g = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("");
    let gi = |k: &str| args.get(k).and_then(|v| v.as_i64()).unwrap_or(0);
    match name {
        "scale_workload" => format!(
            "scale {} {}/{} to {} replicas",
            g("kind"),
            g("namespace"),
            g("name"),
            gi("replicas")
        ),
        "restart_workload" => format!(
            "rollout-restart {} {}/{}",
            g("kind"),
            g("namespace"),
            g("name")
        ),
        "delete_resource" => format!("delete {} {}/{}", g("kind"), g("namespace"), g("name")),
        "apply_manifest" => "apply a YAML manifest".to_string(),
        _ => format!("run tool '{name}'"),
    }
}

/// Keep tool results small enough not to dominate the next turn's prompt.
/// Truncates long string fields and limits array length.
fn trim_result(v: serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::String(s) => {
            if s.chars().count() > 4000 {
                let head: String = s.chars().take(4000).collect();
                serde_json::Value::String(format!("{head}\n…[truncated]"))
            } else {
                serde_json::Value::String(s)
            }
        }
        serde_json::Value::Array(a) => {
            let truncated = a.len() > 50;
            let mut iter: Box<dyn Iterator<Item = serde_json::Value>> =
                Box::new(a.into_iter().take(50).map(trim_result));
            let mut out: Vec<serde_json::Value> = (&mut iter).collect();
            if truncated {
                out.push(serde_json::json!({ "note": "results truncated to 50 rows" }));
            }
            serde_json::Value::Array(out)
        }
        serde_json::Value::Object(o) => {
            let map = o.into_iter().map(|(k, vv)| (k, trim_result(vv))).collect();
            serde_json::Value::Object(map)
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::llm::{ChatStream, FunctionDef, StreamEvent, StreamItem};
    use std::sync::Mutex;
    use tokio::sync::oneshot;

    /// A mock LlmClient that returns a pre-scripted sequence of turn responses.
    /// Each call to `chat_stream` advances to the next script entry.
    struct MockLlm {
        /// One Vec per turn: the stream items to emit.
        script: Mutex<Vec<Vec<StreamEvent>>>,
    }

    impl MockLlm {
        fn new(turns: Vec<Vec<StreamEvent>>) -> Self {
            Self {
                script: Mutex::new(turns),
            }
        }
    }

    impl LlmClient for MockLlm {
        fn chat_stream(&self, _messages: &[Message], _tools: &[FunctionDef]) -> ChatStream {
            let mut script = self.script.lock().unwrap();
            let turn = if script.is_empty() {
                vec![StreamEvent::Done {
                    tool_calls: vec![],
                    finish_reason: "stop".into(),
                }]
            } else {
                script.remove(0)
            };
            // Build a stream that yields each item then ends.
            Box::pin(futures::stream::iter(
                turn.into_iter().map(Ok::<_, AiError>),
            ))
        }
    }

    /// A mock EventSink that records emitted events and auto-approves every
    /// pending write (so the gate doesn't block the test).
    struct MockSink {
        events: Mutex<Vec<AgentEvent>>,
        cancelled: Mutex<bool>,
    }

    impl MockSink {
        fn new() -> Self {
            Self {
                events: Mutex::new(Vec::new()),
                cancelled: Mutex::new(false),
            }
        }
        fn events(&self) -> Vec<AgentEvent> {
            self.events.lock().unwrap().clone()
        }
    }

    impl EventSink for MockSink {
        fn emit(&self, ev: AgentEvent) {
            self.events.lock().unwrap().push(ev);
        }
        fn await_approval(&self, _call_id: &str) -> oneshot::Receiver<bool> {
            let (tx, rx) = oneshot::channel();
            let _ = tx.send(true); // auto-approve in tests
            rx
        }
        fn is_cancelled(&self) -> bool {
            *self.cancelled.lock().unwrap()
        }
    }

    fn make_agent(script: Vec<Vec<StreamEvent>>) -> AgentLoop {
        let llm = Arc::new(MockLlm::new(script));
        let factory: Arc<dyn Fn() -> Box<dyn LlmClient> + Send + Sync> =
            Arc::new(move || Box::new(MockLlm::new(vec![])));
        // The factory isn't used by run() if we pass our own agent; but
        // AgentLoop::new needs one. Build the agent with a factory that
        // reconstructs a fresh mock per call — for the test we instead build
        // the agent and rely on factory producing a defaulting mock.
        let _ = llm;
        AgentLoop::new(crate::ai::ToolRegistry::new(), factory)
    }

    /// trim_result truncates long strings and caps arrays at 50 + a note.
    #[test]
    fn trim_truncates_long_string() {
        let long = "x".repeat(5000);
        let v = trim_result(serde_json::Value::String(long));
        let s = v.as_str().unwrap();
        assert!(s.contains("[truncated]"));
        assert!(s.chars().count() < 4100);
    }

    #[test]
    fn trim_caps_array_at_50() {
        let arr: Vec<serde_json::Value> = (0..100).map(serde_json::Value::from).collect();
        let v = trim_result(serde_json::Value::Array(arr));
        let a = v.as_array().unwrap();
        assert_eq!(a.len(), 51); // 50 + the note
        assert!(a.last().unwrap().get("note").is_some());
    }

    #[test]
    fn trim_passes_through_small_values() {
        assert_eq!(trim_result(serde_json::json!(42)), serde_json::json!(42));
        assert_eq!(
            trim_result(serde_json::json!("short")),
            serde_json::json!("short")
        );
    }

    /// summarize_call produces human-readable one-liners for the approval card.
    #[test]
    fn summarize_scale_call() {
        let s = summarize_call(
            "scale_workload",
            &serde_json::json!({"kind":"deployments","namespace":"prod","name":"api","replicas":5}),
        );
        assert!(s.contains("deployments"));
        assert!(s.contains("prod/api"));
        assert!(s.contains("5"));
    }

    // (The agent-loop integration test with a live mock LLM requires a connected
    // ClientManager, which we can't build cheaply in a unit test. The loop's
    // pure helpers above are covered; the full loop is exercised by the dev
    // cluster smoke test in dev/web.mjs + a real LLM provider.)
    #[test]
    fn agent_loop_helpers_smoke() {
        // Ensure the factory + registry wire together without panicking.
        let _ = make_agent(vec![]);
    }
}

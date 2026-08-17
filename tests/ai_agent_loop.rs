//! Integration test: drive the FULL agent loop against a real cluster with a
//! mock LLM. This tests the complete path that a real user interaction would
//! take — system prompt → LLM → tool call → tool execution → result → LLM →
//! final answer — without needing a real API key.
//!
//! Run:
//!   KUBECONFIG=~/.kube/k7s-dev.kubeconfig \
//!     cargo test --test ai_agent_loop -- --nocapture --ignored

use k7s_ios_lib::ai::agent::{AgentEvent, AgentLoop, ChatRequest, EventSink};
use k7s_ios_lib::ai::config::PermissionMode;
use k7s_ios_lib::ai::llm::{
    ChatStream, FunctionDef, LlmClient, Message, OutgoingToolCall, StreamEvent,
};
use k7s_ios_lib::ai::tools::ToolRegistry;
use k7s_ios_lib::core::events::mcp_sink;
use k7s_ios_lib::kube::manager::ClientManager;
use std::sync::{Arc, Mutex, Once};
use k7s_deps::tokio::sync::oneshot;

static CRYPTO_INIT: Once = Once::new();
fn ensure_crypto() {
    CRYPTO_INIT.call_once(|| {
        let _ = k7s_deps::rustls::crypto::aws_lc_rs::default_provider().install_default();
    });
}

// ---------------------------------------------------------------------------
// Mock LLM — returns pre-scripted tool calls then a final answer
// ---------------------------------------------------------------------------

/// A mock LLM that simulates a multi-turn conversation:
/// Turn 1: asks to call `list_resources` for pods
/// Turn 2: sees the result and gives a final answer
struct MockLlm {
    turn: Mutex<u32>,
}

impl MockLlm {
    fn new() -> Self {
        Self {
            turn: Mutex::new(0),
        }
    }
}

impl LlmClient for MockLlm {
    fn chat_stream(&self, _messages: &[Message], _tools: &[FunctionDef]) -> ChatStream {
        let mut turn = self.turn.lock().unwrap();
        *turn += 1;
        let current = *turn;

        let events: Vec<StreamItem> = match current {
            1 => {
                // First turn: emit text + a tool call to list pods.
                vec![
                    Ok(StreamEvent::TextDelta(
                        "Let me check the pods for you.".into(),
                    )),
                    Ok(StreamEvent::Done {
                        tool_calls: vec![OutgoingToolCall {
                            id: "call_001".into(),
                            name: "list_resources".into(),
                            arguments: r#"{"kind":"pods","namespace":"default"}"#.into(),
                        }],
                        finish_reason: "tool_calls".into(),
                    }),
                ]
            }
            2 => {
                // Second turn: the tool result is in the message history.
                // Give a final answer based on what we "saw".
                vec![
                    Ok(StreamEvent::TextDelta(
                        "I found the pods in the default namespace. Here's a summary of what's running.".into(),
                    )),
                    Ok(StreamEvent::Done {
                        tool_calls: vec![],
                        finish_reason: "stop".into(),
                    }),
                ]
            }
            _ => {
                vec![Ok(StreamEvent::Done {
                    tool_calls: vec![],
                    finish_reason: "stop".into(),
                })]
            }
        };

        Box::pin(k7s_deps::futures::stream::iter(events))
    }
}

type StreamItem = Result<StreamEvent, k7s_ios_lib::ai::AiError>;

// ---------------------------------------------------------------------------
// Mock EventSink — records all events for assertions
// ---------------------------------------------------------------------------

struct MockSink {
    events: Mutex<Vec<AgentEvent>>,
    auto_approve: bool,
}

impl MockSink {
    fn new() -> Self {
        Self {
            events: Mutex::new(Vec::new()),
            auto_approve: true,
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
        let _ = tx.send(self.auto_approve);
        rx
    }

    fn is_cancelled(&self) -> bool {
        false
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Full agent loop: user asks about pods → LLM calls list_resources →
/// tool executes against real cluster → LLM gives final answer.
/// Verifies: text deltas, tool calls, tool results, done event, history.
#[tokio::test]
#[ignore = "needs a reachable cluster; run with --ignored"]
async fn agent_loop_full_cycle() {
    ensure_crypto();
    let manager = std::sync::Arc::new(ClientManager::new(mcp_sink()));
    // Connect to the cluster.
    let (client, ctx_name) = k7s_ios_lib::kube::client::build_client("kind-k7s-dev")
        .await
        .expect("build client");
    let info = k7s_ios_lib::kube::manager::ConnectionInfo {
        context: ctx_name.clone(),
        server: String::new(),
        version: String::new(),
    };
    manager.set_connected(client, info, 0).await;

    let llm_factory: Arc<dyn Fn() -> Box<dyn LlmClient> + Send + Sync> =
        Arc::new(|| Box::new(MockLlm::new()));
    let agent = AgentLoop::new(ToolRegistry::new(), llm_factory);
    let sink = Arc::new(MockSink::new());

    let data_dir = std::env::temp_dir().join("k7s-ai-agent-test");
    let _ = std::fs::remove_dir_all(&data_dir);
    std::fs::create_dir_all(&data_dir).unwrap();

    let req = ChatRequest {
        message: "What pods are running in default namespace?".into(),
        history: vec![],
        context: None,
        skill_id: None,
        kube_context: Some(ctx_name),
    };

    agent
        .run(
            req,
            PermissionMode::ReadConfirmWrite,
            10,
            manager,
            sink.clone(),
            data_dir.clone(),
            None,
        )
        .await;

    let events = sink.events();
    eprintln!("=== Events ({} total) ===", events.len());
    for (i, ev) in events.iter().enumerate() {
        eprintln!(
            "  [{i}] {:?}",
            k7s_deps::serde_json::to_string(ev).unwrap_or_default()
        );
    }

    // Verify we got the expected event sequence.
    let has_text_delta = events
        .iter()
        .any(|e| matches!(e, AgentEvent::TextDelta { .. }));
    let has_tool_call = events
        .iter()
        .any(|e| matches!(e, AgentEvent::ToolCall { name, .. } if name == "list_resources"));
    let has_tool_result = events
        .iter()
        .any(|e| matches!(e, AgentEvent::ToolResult { ok: true, .. }));
    let has_done = events.iter().any(|e| matches!(e, AgentEvent::Done { .. }));

    assert!(has_text_delta, "should have text deltas from LLM");
    assert!(has_tool_call, "should have called list_resources tool");
    assert!(has_tool_result, "tool should have returned a result");
    assert!(has_done, "should end with Done event");

    // Verify the Done event includes history.
    if let Some(AgentEvent::Done {
        history,
        final_message,
    }) = events.iter().find(|e| matches!(e, AgentEvent::Done { .. }))
    {
        assert!(!history.is_empty(), "history should not be empty");
        assert!(final_message.is_some(), "should have a final message");
        eprintln!("=== Final message: {} ===", final_message.as_ref().unwrap());
        eprintln!("=== History length: {} ===", history.len());
    }

    // Cleanup.
    let _ = std::fs::remove_dir_all(&data_dir);
}

/// ReadConfirmWrite mode: write tools are held for approval, auto-approved
/// by the mock sink, then execute.
#[tokio::test]
#[ignore = "needs a reachable cluster; run with --ignored"]
async fn agent_loop_write_approval() {
    ensure_crypto();
    let manager = std::sync::Arc::new(ClientManager::new(mcp_sink()));
    let (client, ctx_name) = k7s_ios_lib::kube::client::build_client("kind-k7s-dev")
        .await
        .expect("build client");
    let info = k7s_ios_lib::kube::manager::ConnectionInfo {
        context: ctx_name.clone(),
        server: String::new(),
        version: String::new(),
    };
    manager.set_connected(client, info, 0).await;

    // Mock LLM that tries to scale a deployment.
    struct ScaleLlm;
    impl LlmClient for ScaleLlm {
        fn chat_stream(&self, _messages: &[Message], _tools: &[FunctionDef]) -> ChatStream {
            Box::pin(k7s_deps::futures::stream::iter(vec![
                Ok::<StreamEvent, k7s_ios_lib::ai::AiError>(StreamEvent::TextDelta(
                    "I'll scale the nginx deployment to 3 replicas.".into(),
                )),
                Ok(StreamEvent::Done {
                    tool_calls: vec![OutgoingToolCall {
                        id: "call_scale".into(),
                        name: "scale_workload".into(),
                        arguments: r#"{"kind":"deployments","namespace":"default","name":"nginx-test","replicas":3}"#.into(),
                    }],
                    finish_reason: "tool_calls".into(),
                }),
            ]))
        }
    }

    let llm_factory: Arc<dyn Fn() -> Box<dyn LlmClient> + Send + Sync> =
        Arc::new(|| Box::new(ScaleLlm));
    let agent = AgentLoop::new(ToolRegistry::new(), llm_factory);
    let sink = Arc::new(MockSink::new());

    let data_dir = std::env::temp_dir().join("k7s-ai-agent-write-test");
    let _ = std::fs::remove_dir_all(&data_dir);
    std::fs::create_dir_all(&data_dir).unwrap();

    let req = ChatRequest {
        message: "Scale nginx-test to 3 replicas".into(),
        history: vec![],
        context: None,
        skill_id: None,
        kube_context: Some(ctx_name),
    };

    agent
        .run(
            req,
            PermissionMode::ReadConfirmWrite,
            10,
            manager,
            sink.clone(),
            data_dir.clone(),
            None,
        )
        .await;

    let events = sink.events();
    eprintln!("=== Write events ({} total) ===", events.len());
    for (i, ev) in events.iter().enumerate() {
        eprintln!(
            "  [{i}] {:?}",
            k7s_deps::serde_json::to_string(ev).unwrap_or_default()
        );
    }

    // Should have a PendingApproval event (write tool requires approval).
    let has_approval = events
        .iter()
        .any(|e| matches!(e, AgentEvent::PendingApproval { .. }));
    // Should have executed after auto-approval.
    let has_result = events
        .iter()
        .any(|e| matches!(e, AgentEvent::ToolResult { ok: true, .. }));

    assert!(has_approval, "write tool should trigger PendingApproval");
    assert!(has_result, "tool should execute after approval");

    let _ = std::fs::remove_dir_all(&data_dir);
}

/// ReadOnly mode: write tools are denied without approval.
#[tokio::test]
#[ignore = "needs a reachable cluster; run with --ignored"]
async fn agent_loop_readonly_denies_writes() {
    ensure_crypto();
    let manager = std::sync::Arc::new(ClientManager::new(mcp_sink()));
    let (client, ctx_name) = k7s_ios_lib::kube::client::build_client("kind-k7s-dev")
        .await
        .expect("build client");
    let info = k7s_ios_lib::kube::manager::ConnectionInfo {
        context: ctx_name.clone(),
        server: String::new(),
        version: String::new(),
    };
    manager.set_connected(client, info, 0).await;

    struct WriteLlm;
    impl LlmClient for WriteLlm {
        fn chat_stream(&self, _messages: &[Message], tools: &[FunctionDef]) -> ChatStream {
            // Only try to scale if the tool is available (it won't be in ReadOnly).
            let has_scale = tools.iter().any(|t| t.name == "scale_workload");
            if has_scale {
                Box::pin(k7s_deps::futures::stream::iter(vec![
                    Ok::<StreamEvent, k7s_ios_lib::ai::AiError>(StreamEvent::Done {
                        tool_calls: vec![OutgoingToolCall {
                            id: "call1".into(),
                            name: "scale_workload".into(),
                            arguments: r#"{"kind":"deployments","namespace":"default","name":"nginx","replicas":5}"#.into(),
                        }],
                        finish_reason: "tool_calls".into(),
                    }),
                ]))
            } else {
                // In ReadOnly, scale isn't available, so we just answer.
                Box::pin(k7s_deps::futures::stream::iter(vec![
                    Ok::<StreamEvent, k7s_ios_lib::ai::AiError>(StreamEvent::TextDelta(
                        "I cannot scale because I'm in read-only mode.".into(),
                    )),
                    Ok(StreamEvent::Done {
                        tool_calls: vec![],
                        finish_reason: "stop".into(),
                    }),
                ]))
            }
        }
    }

    let llm_factory: Arc<dyn Fn() -> Box<dyn LlmClient> + Send + Sync> =
        Arc::new(|| Box::new(WriteLlm));
    let agent = AgentLoop::new(ToolRegistry::new(), llm_factory);
    let sink = Arc::new(MockSink::new());

    let data_dir = std::env::temp_dir().join("k7s-ai-agent-readonly-test");
    let _ = std::fs::remove_dir_all(&data_dir);
    std::fs::create_dir_all(&data_dir).unwrap();

    let req = ChatRequest {
        message: "Scale nginx to 5 replicas".into(),
        history: vec![],
        context: None,
        skill_id: None,
        kube_context: Some(ctx_name),
    };

    agent
        .run(
            req,
            PermissionMode::ReadOnly,
            10,
            manager,
            sink.clone(),
            data_dir.clone(),
            None,
        )
        .await;

    let events = sink.events();
    eprintln!("=== ReadOnly events ===");
    for (i, ev) in events.iter().enumerate() {
        eprintln!(
            "  [{i}] {:?}",
            k7s_deps::serde_json::to_string(ev).unwrap_or_default()
        );
    }

    // Should NOT have any tool calls (write tools filtered out in ReadOnly).
    let has_tool_call = events
        .iter()
        .any(|e| matches!(e, AgentEvent::ToolCall { .. }));
    assert!(
        !has_tool_call,
        "ReadOnly mode should not trigger any tool calls"
    );

    let _ = std::fs::remove_dir_all(&data_dir);
}

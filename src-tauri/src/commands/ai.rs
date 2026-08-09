//! Tauri commands for the AI assistant.
//!
//! Frontend entry points: `ai_get_config` / `ai_save_config` / `ai_save_api_key`,
//! `ai_test_connection`, `ai_chat` (streaming, returns a run id and pushes
//! `AgentEvent`s via the `ai_event` Tauri event), `ai_approve_tool_call`, and
//! `ai_cancel`.
//!
//! [`AiRuntime`] is the managed state. It holds the shared, stateless
//! [`ToolRegistry`] and a table of in-flight runs (approval channels +
//! cancellation flags) keyed by run id. The LLM client is built per-run from
//! freshly-loaded config, so settings changes take effect on the next chat.

use crate::ai::agent::{AgentEvent, EventSink};
use crate::ai::config::{self, AiConfig, AiConfigView};
use crate::ai::llm::{LlmClient, Message, OpenAiClient};
use crate::ai::{AgentLoop, ChatRequest, ToolRegistry};
use crate::core::CoreState;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{oneshot, Mutex};

/// The Tauri event name the frontend listens on for [`AgentEvent`]s.
pub const AI_EVENT: &str = "ai_event";

/// In-flight bookkeeping for one run.
struct RunState {
    /// Pending approvals by tool-call id. Each sender resolves the wait in
    /// [`TauriEventSink::await_approval`].
    approvals: HashMap<String, oneshot::Sender<bool>>,
    cancelled: bool,
}

/// Managed state. Clone is cheap (it's an Arc inside).
#[derive(Clone)]
pub struct AiRuntime {
    inner: Arc<Mutex<HashMap<String, RunState>>>,
}

impl AiRuntime {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn register(&self, run_id: &str) {
        self.inner.lock().await.insert(
            run_id.to_string(),
            RunState {
                approvals: HashMap::new(),
                cancelled: false,
            },
        );
    }

    async fn unregister(&self, run_id: &str) {
        self.inner.lock().await.remove(run_id);
    }
}

/// The per-run Tauri `EventSink`. Emits `AgentEvent`s as Tauri events and
/// resolves approvals through `AiRuntime`'s table.
pub struct TauriEventSink {
    app: AppHandle,
    runtime: AiRuntime,
    run_id: String,
}

impl EventSink for TauriEventSink {
    fn emit(&self, ev: AgentEvent) {
        let _ = self.app.emit(
            AI_EVENT,
            serde_json::json!({ "runId": self.run_id, "event": ev }),
        );
    }

    fn await_approval(&self, call_id: &str) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        let inner = self.runtime.inner.clone();
        let run_id = self.run_id.clone();
        let call_id = call_id.to_string();
        // Best-effort: try_lock first; if contended (rare), spawn an async wait.
        // We match on the result bound to its own binding so the temporary
        // lock-guard borrow doesn't keep `inner` borrowed across the move in
        // the contended branch.
        let lock_result = inner.try_lock();
        if let Ok(mut map) = lock_result {
            if let Some(run) = map.get_mut(&run_id) {
                run.approvals.insert(call_id, tx);
            }
            rx
        } else {
            // `inner` is no longer borrowed here (lock_result held a guard only
            // in the Ok arm, which returned), so we can move it into the task.
            drop(lock_result);
            tokio::spawn(async move {
                let mut map = inner.lock().await;
                if let Some(run) = map.get_mut(&run_id) {
                    run.approvals.insert(call_id, tx);
                }
            });
            rx
        }
    }

    fn is_cancelled(&self) -> bool {
        self.runtime
            .inner
            .try_lock()
            .map(|map| map.get(&self.run_id).map(|r| r.cancelled).unwrap_or(false))
            .unwrap_or(false)
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ai_get_config(state: State<'_, Arc<CoreState>>) -> Result<AiConfigView, String> {
    // config::load is synchronous (std::fs); wrap in spawn_blocking so the
    // Tauri command runtime doesn't block the async executor on disk I/O.
    let dir = state.data_dir.clone();
    tokio::task::spawn_blocking(move || config::load(Some(&dir)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_save_config(
    config_input: AiConfig,
    state: State<'_, Arc<CoreState>>,
) -> Result<(), String> {
    let dir = state.data_dir.clone();
    tokio::task::spawn_blocking(move || config::save(Some(&dir), &config_input))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_save_api_key(
    api_key: String,
    state: State<'_, Arc<CoreState>>,
) -> Result<(), String> {
    let dir = state.data_dir.clone();
    tokio::task::spawn_blocking(move || config::save_api_key(Some(&dir), &api_key))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Probe the configured provider with a minimal request. Returns Ok with a
/// short status string, or Err with the failure message.
#[tauri::command]
pub async fn ai_test_connection(state: State<'_, Arc<CoreState>>) -> Result<String, String> {
    let dir = state.data_dir.clone();
    let view = tokio::task::spawn_blocking(move || config::load(Some(&dir)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let cfg = view.config;
    let (base, model, key) =
        config::resolve(&cfg, Some(&state.data_dir)).map_err(|e| e.to_string())?;
    let client = OpenAiClient::new(base, model, key, cfg.provider.temperature);
    use futures::StreamExt;
    let mut stream = client.chat_stream(
        &[Message::System {
            content: "Reply with the single word: ok".into(),
        }],
        &[],
    );
    let mut got = String::new();
    while let Some(item) = stream.next().await {
        match item {
            Ok(crate::ai::llm::StreamEvent::TextDelta(t)) => got.push_str(&t),
            Ok(crate::ai::llm::StreamEvent::Done { .. }) => break,
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(format!("connected (model replied: {:?})", got.trim()))
}

/// Start a streaming chat. Returns the run id immediately; events arrive via
/// the `ai_event` Tauri event.
///
/// Integrates:
/// - **Embedded models fallback**: if no API key is configured, probes
///   localhost:11434 for Ollama and uses it automatically.
/// - **Sessions**: if `session_id` is provided, loads history from the
///   session and saves new messages after the run.
#[tauri::command]
pub async fn ai_chat(
    request: ChatRequest,
    session_id: Option<String>,
    state: State<'_, Arc<CoreState>>,
    app: AppHandle,
    runtime: State<'_, Arc<AiRuntime>>,
) -> Result<String, String> {
    let dir = state.data_dir.clone();
    let view = tokio::task::spawn_blocking(move || config::load(Some(&dir)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let cfg = view.config;

    // Resolve LLM provider. If config::resolve fails (no API key), try
    // embedded models (Ollama on localhost) as fallback.
    let (base, model, key) = match config::resolve(&cfg, Some(&state.data_dir)) {
        Ok(triple) => triple,
        Err(_) => {
            // Fallback: probe Ollama.
            match crate::ai::embedded_models::discover_ollama(None).await {
                Some(models) if !models.is_empty() => {
                    let m = &models[0];
                    tracing::info!(
                        "no API key configured, using local Ollama model: {}",
                        m.name
                    );
                    (
                        "http://localhost:11434/v1".to_string(),
                        m.name.clone(),
                        "ollama".to_string(), // Ollama doesn't need a real key
                    )
                }
                _ => {
                    return Err(
                        "No LLM configured. Set an API key in Settings → AI Assistant, \
                         or install Ollama (ollama.com) for local inference."
                            .to_string(),
                    );
                }
            }
        }
    };

    // Load session history if a session_id is provided.
    let mut request = request;
    if let Some(ref sid) = session_id {
        let mgr = crate::ai::session::SessionManager::new(state.data_dir.clone());
        if let Some(session) = mgr.get(sid).await {
            if request.history.is_empty() {
                // Convert session messages to the agent's Message format.
                request.history = session
                    .history
                    .iter()
                    .map(|m| match m.role.as_str() {
                        "user" => crate::ai::llm::Message::User {
                            content: m.content.clone(),
                        },
                        "assistant" => crate::ai::llm::Message::Assistant {
                            content: Some(m.content.clone()),
                            tool_calls: None,
                        },
                        _ => crate::ai::llm::Message::System {
                            content: m.content.clone(),
                        },
                    })
                    .collect();
            }
        }
    }

    let run_id = uuid::Uuid::new_v4().to_string();
    let run_id_for_task = run_id.clone();
    let temperature = cfg.provider.temperature;

    // Per-run LLM factory, built from freshly-loaded config.
    let llm_factory: Arc<dyn Fn() -> Box<dyn LlmClient> + Send + Sync> = Arc::new(move || {
        Box::new(OpenAiClient::new(
            base.clone(),
            model.clone(),
            key.clone(),
            temperature,
        ))
    });
    // Fresh stateless registry per run — cheap, avoids shared mutable state.
    let agent = AgentLoop::new(ToolRegistry::new(), llm_factory);

    runtime.register(&run_id).await;

    let sink: Arc<dyn EventSink> = Arc::new(TauriEventSink {
        app: app.clone(),
        runtime: (**runtime).clone(),
        run_id: run_id.clone(),
    });
    let manager = state.manager.clone();
    let mode = cfg.permission;
    let max_turns = cfg.max_turns;
    let runtime_for_cleanup = (**runtime).clone();
    let data_dir_for_session = state.data_dir.clone();
    let session_id_for_save = session_id.clone();
    let user_message_for_save = request.message.clone();

    tokio::spawn(async move {
        agent.run(request, mode, max_turns, manager, sink).await;
        runtime_for_cleanup.unregister(&run_id_for_task).await;

        // Save messages to session if session_id was provided.
        if let Some(sid) = session_id_for_save {
            let mgr = crate::ai::session::SessionManager::new(data_dir_for_session);
            mgr.add_message(&sid, "user", &user_message_for_save).await;
            // The assistant response is in the last Done event, which the
            // frontend already has. We save a placeholder here; the actual
            // response could be captured from the EventSink if needed.
        }
    });

    Ok(run_id)
}

/// Respond to a pending_approval event. `approved=true` lets the write proceed.
#[tauri::command]
pub async fn ai_approve_tool_call(
    run_id: String,
    call_id: String,
    approved: bool,
    runtime: State<'_, Arc<AiRuntime>>,
) -> Result<(), String> {
    let mut map = runtime.inner.lock().await;
    if let Some(run) = map.get_mut(&run_id) {
        if let Some(tx) = run.approvals.remove(&call_id) {
            let _ = tx.send(approved);
            return Ok(());
        }
    }
    Err("no pending approval for that call".into())
}

/// Cancel the active run.
#[tauri::command]
pub async fn ai_cancel(run_id: String, runtime: State<'_, Arc<AiRuntime>>) -> Result<(), String> {
    let mut map = runtime.inner.lock().await;
    if let Some(run) = map.get_mut(&run_id) {
        run.cancelled = true;
        // Decline any pending approvals so the run unblocks.
        for (_, tx) in run.approvals.drain() {
            let _ = tx.send(false);
        }
    }
    Ok(())
}

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

use k7s_core::ai::agent::{AgentEvent, EventSink};
use k7s_core::ai::config::{self, AiConfig, AiConfigView};
use k7s_core::ai::llm::{LlmClient, Message, OpenAiClient};
use k7s_core::ai::{AgentLoop, ChatRequest, ToolRegistry};
use k7s_core::core::CoreState;
use k7s_core::error::AppResult;
use k7s_deps::tokio::sync::{oneshot, Mutex};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

/// The Tauri event name the frontend listens on for [`AgentEvent`]s.
pub const AI_EVENT: &str = "ai_event";

/// In-flight bookkeeping for one run.
struct RunState {
    /// Pending approvals by tool-call id. Each sender resolves the wait in
    /// [`AiTauriSink::await_approval`].
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
///
/// Named `AiTauriSink` to avoid confusion with `core::events::TauriEventSink`
/// which pushes Kubernetes resource updates to the webview.
pub struct AiTauriSink {
    app: AppHandle,
    runtime: AiRuntime,
    run_id: String,
}

impl EventSink for AiTauriSink {
    fn emit(&self, ev: AgentEvent) {
        let _ = self.app.emit(
            AI_EVENT,
            k7s_deps::serde_json::json!({ "runId": self.run_id, "event": ev }),
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
            k7s_deps::tokio::spawn(async move {
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

/// Get the current kubeconfig context name (for memory/session scoping).
pub async fn ai_get_context_impl(state: std::sync::Arc<CoreState>) -> AppResult<String> {
    Ok(state
        .manager
        .connection_info()
        .await
        .map(|i| i.context)
        .unwrap_or_default())
}

#[tauri::command]
pub async fn ai_get_context(state: State<'_, Arc<CoreState>>) -> AppResult<String> {
    ai_get_context_impl(state.inner().clone()).await
}

pub async fn ai_get_config_impl(state: std::sync::Arc<CoreState>) -> AppResult<AiConfigView> {
    // config::load is synchronous (std::fs); wrap in spawn_blocking so the
    // Tauri command runtime doesn't block the async executor on disk I/O.
    let dir = state.data_dir.clone();
    Ok(k7s_deps::tokio::task::spawn_blocking(move || config::load(Some(&dir))).await??)
}

#[tauri::command]
pub async fn ai_get_config(state: State<'_, Arc<CoreState>>) -> AppResult<AiConfigView> {
    ai_get_config_impl(state.inner().clone()).await
}

/// Wire arguments for [`ai_save_config`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiSaveConfigArgs {
    pub config_input: AiConfig,
}

pub async fn ai_save_config_impl(
    state: std::sync::Arc<CoreState>,
    config_input: AiConfig,
) -> AppResult<()> {
    let dir = state.data_dir.clone();
    k7s_deps::tokio::task::spawn_blocking(move || config::save(Some(&dir), &config_input))
        .await??;
    Ok(())
}

#[tauri::command]
pub async fn ai_save_config(
    config_input: AiConfig,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    ai_save_config_impl(state.inner().clone(), config_input).await
}

/// Wire arguments for [`ai_save_api_key`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiSaveApiKeyArgs {
    pub api_key: String,
}

pub async fn ai_save_api_key_impl(
    state: std::sync::Arc<CoreState>,
    api_key: String,
) -> AppResult<()> {
    let dir = state.data_dir.clone();
    k7s_deps::tokio::task::spawn_blocking(move || config::save_api_key(Some(&dir), &api_key))
        .await??;
    Ok(())
}

#[tauri::command]
pub async fn ai_save_api_key(api_key: String, state: State<'_, Arc<CoreState>>) -> AppResult<()> {
    ai_save_api_key_impl(state.inner().clone(), api_key).await
}

/// Probe the configured provider with a minimal request. Returns Ok with a
/// short status string, or Err with the failure message.
pub async fn ai_test_connection_impl(state: std::sync::Arc<CoreState>) -> AppResult<String> {
    let dir = state.data_dir.clone();
    let view = k7s_deps::tokio::task::spawn_blocking(move || config::load(Some(&dir))).await??;
    let cfg = view.config;
    let (base, model, key) = config::resolve(&cfg, Some(&state.data_dir))?;
    let client = OpenAiClient::new(base, model, key, cfg.provider.temperature);
    use k7s_deps::futures::StreamExt;
    let mut stream = client.chat_stream(
        &[Message::System {
            content: "Reply with the single word: ok".into(),
        }],
        &[],
    );
    let mut got = String::new();
    while let Some(item) = stream.next().await {
        match item {
            Ok(k7s_core::ai::llm::StreamEvent::TextDelta(t))
            | Ok(k7s_core::ai::llm::StreamEvent::ReasoningDelta(t)) => got.push_str(&t),
            Ok(k7s_core::ai::llm::StreamEvent::Done { .. }) => break,
            Err(e) => return Err(k7s_core::ai::AiError::Llm(e.to_string()).into()),
        }
    }
    Ok(format!("connected (model replied: {:?})", got.trim()))
}

#[tauri::command]
pub async fn ai_test_connection(state: State<'_, Arc<CoreState>>) -> AppResult<String> {
    ai_test_connection_impl(state.inner().clone()).await
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
) -> AppResult<String> {
    let dir = state.data_dir.clone();
    let view = k7s_deps::tokio::task::spawn_blocking(move || config::load(Some(&dir))).await??;
    let cfg = view.config;

    // Resolve LLM provider. If config::resolve fails (no API key), try
    // embedded models (Ollama on localhost) as fallback.
    let (base, model, key) = match config::resolve(&cfg, Some(&state.data_dir)) {
        Ok(triple) => triple,
        Err(_) => {
            // Fallback: probe Ollama.
            match k7s_core::ai::embedded_models::discover_ollama(None).await {
                Some(models) if !models.is_empty() => {
                    let m = &models[0];
                    k7s_deps::tracing::info!(
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
                    return Err(k7s_core::error::AppError::Other(
                        "No LLM configured. Set an API key in Settings \u{2192} AI Assistant, \
                         or install Ollama (ollama.com) for local inference."
                            .to_string(),
                    ));
                }
            }
        }
    };

    // Load session history if a session_id is provided.
    let mut request = request;
    if let Some(ref sid) = session_id {
        let mgr = k7s_core::ai::session::SessionManager::new(state.data_dir.clone());
        if let Some(session) = mgr.get(sid).await {
            if request.history.is_empty() {
                // Convert session messages to the agent's Message format.
                request.history = session
                    .history
                    .iter()
                    .map(|m| match m.role.as_str() {
                        "user" => k7s_core::ai::llm::Message::User {
                            content: m.content.clone(),
                        },
                        "assistant" => k7s_core::ai::llm::Message::Assistant {
                            content: Some(m.content.clone()),
                            tool_calls: None,
                        },
                        _ => k7s_core::ai::llm::Message::System {
                            content: m.content.clone(),
                        },
                    })
                    .collect();
            }
        }
    }

    let run_id = k7s_deps::uuid::Uuid::new_v4().to_string();
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

    let sink: Arc<dyn EventSink> = Arc::new(AiTauriSink {
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

    let run_data_dir = state.data_dir.clone();
    let run_session_id = session_id.clone();

    k7s_deps::tokio::spawn(async move {
        agent
            .run(
                request,
                mode,
                max_turns,
                manager,
                sink,
                run_data_dir,
                run_session_id,
            )
            .await;
        runtime_for_cleanup.unregister(&run_id_for_task).await;

        // Save user message to session if session_id was provided.
        // The assistant response is saved by the agent loop itself
        // (in run_inner after the Done event).
        if let Some(sid) = session_id_for_save {
            let mgr = k7s_core::ai::session::SessionManager::new(data_dir_for_session);
            mgr.add_message(&sid, "user", &user_message_for_save).await;
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
) -> AppResult<()> {
    let mut map = runtime.inner.lock().await;
    if let Some(run) = map.get_mut(&run_id) {
        if let Some(tx) = run.approvals.remove(&call_id) {
            let _ = tx.send(approved);
            return Ok(());
        }
    }
    Err(k7s_core::error::AppError::Other(
        "no pending approval for that call".into(),
    ))
}

/// Cancel the active run.
#[tauri::command]
pub async fn ai_cancel(run_id: String, runtime: State<'_, Arc<AiRuntime>>) -> AppResult<()> {
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

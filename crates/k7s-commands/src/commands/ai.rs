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

#[cfg(feature = "ipc")]
use k7s_core::ai::agent::{AgentEvent, EventSink};
use k7s_core::ai::config::{self, AiConfig, AiConfigView};
use k7s_core::ai::llm::{LlmClient, Message, OpenAiClient};
#[cfg(feature = "ipc")]
use k7s_core::ai::{AgentLoop, ChatRequest, ToolRegistry};
use k7s_core::core::CoreState;
use k7s_core::error::AppResult;
#[cfg(feature = "ipc")]
use k7s_deps::tokio::sync::{oneshot, Mutex};
#[cfg(feature = "ipc")]
use std::collections::HashMap;
#[cfg(feature = "ipc")]
use std::sync::Arc;
#[cfg(feature = "ipc")]
use tauri::{AppHandle, Emitter, State};

/// The Tauri event name the frontend listens on for [`AgentEvent`]s.
pub const AI_EVENT: &str = "ai_event";

/// In-flight bookkeeping for one run.
#[cfg(feature = "ipc")]
struct RunState {
    cancelled: bool,
}

/// Pending approval senders, keyed by `(run id, tool-call id)`.
///
/// Behind a **std** mutex, not a tokio one: the `EventSink` contract requires
/// [`AiTauriSink::await_approval`] to register its resolution channel
/// synchronously (before the returned receiver is even polled), so the
/// critical section must be lockable from sync code — and it never awaits.
#[cfg(feature = "ipc")]
type ApprovalTable = HashMap<(String, String), oneshot::Sender<bool>>;

/// Managed state. Clone is cheap (it's an Arc inside).
#[derive(Clone)]
#[cfg(feature = "ipc")]
pub struct AiRuntime {
    /// Per-run cancellation flags (async lock; only touched from async
    /// commands and `is_cancelled`'s try_lock).
    runs: Arc<Mutex<HashMap<String, RunState>>>,
    /// Approval senders shared with [`AiTauriSink::await_approval`].
    approvals: Arc<std::sync::Mutex<ApprovalTable>>,
}

#[cfg(feature = "ipc")]
impl Default for AiRuntime {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(feature = "ipc")]
impl AiRuntime {
    pub fn new() -> Self {
        Self {
            runs: Arc::new(Mutex::new(HashMap::new())),
            approvals: Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }

    async fn register(&self, run_id: &str) {
        self.runs
            .lock()
            .await
            .insert(run_id.to_string(), RunState { cancelled: false });
    }

    async fn unregister(&self, run_id: &str) {
        self.runs.lock().await.remove(run_id);
        // Drop never-answered approval senders so their waiters observe a
        // closed channel instead of hanging on a leaked table entry. Lock
        // order is always `runs` -> `approvals`, and the std guard is never
        // held across an await, so this can't nest or deadlock.
        self.approvals
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|(rid, _), _| rid != run_id);
    }
}

/// The per-run Tauri `EventSink`. Emits `AgentEvent`s as Tauri events and
/// resolves approvals through `AiRuntime`'s table.
///
/// Named `AiTauriSink` to avoid confusion with `core::events::TauriEventSink`
/// which pushes Kubernetes resource updates to the webview.
#[cfg(feature = "ipc")]
pub struct AiTauriSink {
    app: AppHandle,
    runtime: AiRuntime,
    run_id: String,
}

#[cfg(feature = "ipc")]
impl EventSink for AiTauriSink {
    fn emit(&self, ev: AgentEvent) {
        let _ = self.app.emit(
            AI_EVENT,
            k7s_deps::serde_json::json!({ "runId": self.run_id, "event": ev }),
        );
    }

    fn await_approval(&self, call_id: &str) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        // Register synchronously before returning: the `EventSink` contract
        // forbids a spawned registration — an approve arriving before a
        // spawned task got the lock would find no entry and be rejected.
        // The std-mutex critical section is a plain insert (no await), so a
        // guard held here can't deadlock against the async run table.
        self.runtime
            .approvals
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert((self.run_id.clone(), call_id.to_string()), tx);
        rx
    }

    fn is_cancelled(&self) -> bool {
        self.runtime
            .runs
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

#[cfg(feature = "ipc")]
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

#[cfg(feature = "ipc")]
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

#[cfg(feature = "ipc")]
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

#[cfg(feature = "ipc")]
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

#[cfg(feature = "ipc")]
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
#[cfg(feature = "ipc")]
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
#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn ai_approve_tool_call(
    run_id: String,
    call_id: String,
    approved: bool,
    runtime: State<'_, Arc<AiRuntime>>,
) -> AppResult<()> {
    // The std lock is released before the oneshot send's receiver can react,
    // and `await_approval` only ever inserts under it — no await while held.
    if let Some(tx) = runtime
        .approvals
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&(run_id, call_id))
    {
        let _ = tx.send(approved);
        return Ok(());
    }
    Err(k7s_core::error::AppError::Other(
        "no pending approval for that call".into(),
    ))
}

/// Cancel the active run.
#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn ai_cancel(run_id: String, runtime: State<'_, Arc<AiRuntime>>) -> AppResult<()> {
    {
        let mut map = runtime.runs.lock().await;
        if let Some(run) = map.get_mut(&run_id) {
            run.cancelled = true;
        }
    }
    // Decline any pending approvals so the run unblocks. The run-table guard
    // is already dropped (scoped above) — the same `runs` -> `approvals`
    // order as `unregister`, never nested the other way around.
    {
        let mut table = runtime.approvals.lock().unwrap_or_else(|e| e.into_inner());
        let pending: Vec<_> = table
            .keys()
            .filter(|(rid, _)| rid == &run_id)
            .cloned()
            .collect();
        for key in pending {
            if let Some(tx) = table.remove(&key) {
                let _ = tx.send(false);
            }
        }
    }
    Ok(())
}

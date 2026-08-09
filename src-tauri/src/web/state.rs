//! Web state — the shared bits the axum routes close over.
//!
//! The Tauri shell stores the same data in `crate::core::CoreState` (via
//! `app.manage`). Here we wrap it with the SSE receiver, which only the
//! web shell has — the Tauri shell never serves SSE.

use std::sync::Arc;

use crate::core::events::{WebEvent, WebEventReceiver};
use crate::core::CoreState;
use crate::kube::ClientManager;

/// Everything an axum handler needs. Cheap to clone (`Arc` deref + enum).
#[derive(Clone)]
pub struct WebState {
    /// The shared `core::CoreState` — manager (which carries the sink),
    /// data dir for prefs.
    pub core: Arc<CoreState>,
    /// Sender half of the broadcast the `WebEventSink` writes to. We hold a
    /// clone so the broadcast isn't dropped (it auto-closes with no
    /// receivers); every SSE connection calls [`subscribe_sse`] for its own
    /// receiver.
    pub event_tx: tokio::sync::broadcast::Sender<WebEvent>,
}

impl WebState {
    /// Build a fresh web state. The sink the manager gets and the SSE
    /// receivers come from the same broadcast — one emit reaches every
    /// connected client.
    pub fn new(data_dir: std::path::PathBuf) -> Self {
        // The trick: `web_sink` returns both an `EventSink` (which the manager
        // takes) and a *seed* `broadcast::Receiver`. We need a
        // `broadcast::Sender` to keep ourselves, so we go through
        // `web_sink` twice — once to build the sink, once to get a sender to
        // keep. Both wrap the same underlying broadcast.
        let (sink, _seed_rx) = crate::core::events::web_sink(1024);
        let manager = Arc::new(ClientManager::new(sink));
        let core = CoreState::new(manager, data_dir);

        // Grab a sender to keep. `subscribe_sse` will hand out fresh receivers
        // on it for every new SSE connection.
        let event_tx = crate::core::events::web_sink_sender(&core);

        Self { core, event_tx }
    }

    /// A fresh subscriber for a new SSE connection.
    pub fn subscribe_sse(&self) -> WebEventReceiver {
        self.event_tx.subscribe()
    }

    /// Emit an event to all connected SSE clients. Used by the AI chat handler
    /// to push `ai_event` frames.
    pub fn emit_event(&self, name: impl Into<String>, data: serde_json::Value) {
        let _ = self.event_tx.send(WebEvent {
            name: name.into(),
            data,
        });
    }
}

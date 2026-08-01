//! `ClientManager` — the single source of truth for "which cluster is this".
//!
//! The Tauri runtime holds exactly one `Arc<ClientManager>` in its state.
//! Commands take `State<'_, Arc<ClientManager>>` and call methods on it.
//!
//! Lifecycle:
//!   - App start: `ClientManager::new()` (no client yet).
//!   - `connect(ctx)`: builds a `kube::Client`, stores it, returns
//!     `ClusterInfo`. From here, every other method works.
//!   - `disconnect()`: drops the client, clears state.
//!
//! Concurrency:
//!   - The `kube::Client` is `Clone`-cheap (it's an `Arc` internally),
//!     so it lives behind a `tokio::sync::RwLock` and is `clone()`'d
//!     out for each operation.
//!   - Cancellation handles (for log streams, port forwards, shells)
//!     are stored in a separate `Mutex<HashMap<...>>` so they can be
//!     looked up by id from the `stop_*` commands without needing
//!     to lock the client.

use std::collections::HashMap;
use std::sync::Arc;

use kube_client::api::TerminalSize;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, Notify, RwLock};

use super::client::client_for_context;
use super::dto::{ClusterInfo, ContextInfo};
use super::watchers::{self, WatcherHandle};
use crate::error::{AppError, AppResult};

/// Cancellation handle for long-running per-object tasks (logs, shell,
/// port-forward). `take()` on stop; the receiving task exits.
pub type CancelTx = oneshot::Sender<()>;

/// One active port-forward.
#[derive(Debug)]
pub struct PortForwardHandle {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub namespace: String,
    pub local_port: u16,
    pub remote_port: u16,
    pub started_at: chrono::DateTime<chrono::Utc>,
    /// Broadcast-style stop signal (see ShellHandle.cancel).
    pub cancel: Option<Arc<Notify>>,
}

/// One active log stream.
#[derive(Debug)]
pub struct LogStreamHandle {
    pub id: String,
    pub pod: String,
    pub namespace: String,
    pub container: Option<String>,
    pub cancel: Option<CancelTx>,
}

/// One active shell session.
#[derive(Debug, Clone)]
pub struct ShellHandle {
    pub id: String,
    pub pod: String,
    pub namespace: String,
    pub container: String,
    /// Broadcast-style stop signal. A single `notify_one()` wakes every
    /// task (stdout reader, status watcher) that holds a clone. We
    /// prefer this over `oneshot::Sender` because multiple tasks need
    /// to observe the same cancel.
    pub cancel: Option<Arc<Notify>>,
    /// Forward raw bytes from the UI to the exec stdin.
    pub stdin_tx: mpsc::Sender<Vec<u8>>,
    /// Forward terminal resize from the UI to the exec resize channel.
    pub resize_tx: mpsc::Sender<TerminalSize>,
}

/// The state the Tauri runtime holds.
pub struct ClientManager {
    /// Active client; `None` when not connected.
    client: RwLock<Option<kube::Client>>,
    /// The context the user picked (the source of truth for the next
    /// reconnect after a context switch).
    current_context: RwLock<Option<String>>,
    /// Cached summary from the last `connect` (so the UI can show
    /// cluster name / server / version without round-tripping).
    cluster_info: RwLock<Option<ClusterInfo>>,
    /// Live log streams, by id.
    log_streams: tokio::sync::Mutex<HashMap<String, LogStreamHandle>>,
    /// Live shells, by id.
    shells: tokio::sync::Mutex<HashMap<String, ShellHandle>>,
    /// Live port-forwards, by id.
    port_forwards: tokio::sync::Mutex<HashMap<String, PortForwardHandle>>,
    /// Live watchers, by kind.
    watchers: tokio::sync::Mutex<HashMap<String, WatcherHandle>>,
    /// Cluster-status poller task (one at a time).
    status_task: tokio::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl Default for ClientManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ClientManager {
    pub fn new() -> Self {
        Self {
            client: RwLock::new(None),
            current_context: RwLock::new(None),
            cluster_info: RwLock::new(None),
            log_streams: tokio::sync::Mutex::new(HashMap::new()),
            shells: tokio::sync::Mutex::new(HashMap::new()),
            port_forwards: tokio::sync::Mutex::new(HashMap::new()),
            watchers: tokio::sync::Mutex::new(HashMap::new()),
            status_task: tokio::sync::Mutex::new(None),
        }
    }

    /// The active context name, or `None` if not connected.
    pub async fn current_context(&self) -> Option<String> {
        self.current_context.read().await.clone()
    }

    /// The active `kube::Client`. Returns `NotConnected` if the app
    /// hasn't called `connect()` yet.
    pub async fn client(&self) -> AppResult<kube::Client> {
        self.client
            .read()
            .await
            .clone()
            .ok_or(AppError::NotConnected)
    }

    /// Cached `ClusterInfo` (what `connect` returned). `None` until
    /// the first successful connect.
    pub async fn cluster_info(&self) -> Option<ClusterInfo> {
        self.cluster_info.read().await.clone()
    }

    /// Build a client for `context`, store it, probe the cluster, and
    /// return summary info. Existing client (if any) is dropped.
    pub async fn connect(&self, context: &str) -> AppResult<ClusterInfo> {
        let client =
            client_for_context(Some(context))
                .await
                .map_err(|e| AppError::msg(format!(
                    "could not build kube client for context '{context}': {e:#}"
                )))?;

        // Probe /version to populate the cluster info.
        let info = probe_cluster(&client, context)
            .await
            .map_err(|e| AppError::msg(format!("cluster probe failed: {e:#}")))?;

        *self.client.write().await = Some(client);
        *self.current_context.write().await = Some(context.to_string());
        *self.cluster_info.write().await = Some(info.clone());

        // New connection: stop everything that was tied to the old one.
        self.stop_all_tasks().await;

        Ok(info)
    }

    /// Drop the client. Watchers / streams started after this will fail
    /// or be no-ops.
    pub async fn disconnect(&self) {
        *self.client.write().await = None;
        *self.current_context.write().await = None;
        *self.cluster_info.write().await = None;
        self.stop_all_tasks().await;
        self.stop_all_watchers().await;
        self.stop_status_poller().await;
    }

    /// Cancel every running log stream / shell / port-forward.
    /// Called on disconnect and on context switch.
    pub async fn stop_all_tasks(&self) {
        let mut logs = self.log_streams.lock().await;
        for (_, mut h) in logs.drain() {
            if let Some(tx) = h.cancel.take() {
                let _ = tx.send(());
            }
        }
        let mut shells = self.shells.lock().await;
        for (_, mut h) in shells.drain() {
            if let Some(notify) = h.cancel.take() {
                notify.notify_one();
            }
        }
        let mut pfs = self.port_forwards.lock().await;
        for (_, mut h) in pfs.drain() {
            if let Some(notify) = h.cancel.take() {
                notify.notify_one();
            }
        }
    }

    // ---- log stream registry ----

    pub async fn insert_log(&self, h: LogStreamHandle) {
        self.log_streams.lock().await.insert(h.id.clone(), h);
    }

    pub async fn take_log(&self, id: &str) -> Option<LogStreamHandle> {
        self.log_streams.lock().await.remove(id)
    }

    // ---- shell registry ----

    pub async fn insert_shell(&self, h: ShellHandle) {
        self.shells.lock().await.insert(h.id.clone(), h);
    }

    pub async fn take_shell(&self, id: &str) -> Option<ShellHandle> {
        self.shells.lock().await.remove(id)
    }

    /// Get a read-only handle on a live shell by id (for input/resize).
    /// Returns the id + a clone of the channel senders. Cheap.
    pub async fn get_shell_io(
        &self,
        id: &str,
    ) -> Option<(
        tokio::sync::mpsc::Sender<Vec<u8>>,
        tokio::sync::mpsc::Sender<kube_client::api::TerminalSize>,
    )> {
        let shells = self.shells.lock().await;
        shells.get(id).map(|h| (h.stdin_tx.clone(), h.resize_tx.clone()))
    }

    // ---- port-forward registry ----

    pub async fn insert_port_forward(&self, h: PortForwardHandle) {
        self.port_forwards
            .lock()
            .await
            .insert(h.id.clone(), h);
    }

    pub async fn take_port_forward(&self, id: &str) -> Option<PortForwardHandle> {
        self.port_forwards.lock().await.remove(id)
    }

    pub async fn list_port_forwards(&self) -> Vec<PortForwardHandle> {
        self.port_forwards
            .lock()
            .await
            .values()
            .map(|h| PortForwardHandle {
                id: h.id.clone(),
                kind: h.kind.clone(),
                name: h.name.clone(),
                namespace: h.namespace.clone(),
                local_port: h.local_port,
                remote_port: h.remote_port,
                started_at: h.started_at,
                cancel: None, // never hand out a live cancel tx
            })
            .collect()
    }

    // ---- watchers (live resource snapshots) ----

    /// Start the default set of watchers, replacing any existing ones.
    /// Emits `resource-update` events and a final `watch-status` with
    /// the new active count.
    pub async fn start_default_watchers(self: &Arc<Self>, app: &AppHandle) -> AppResult<()> {
        self.stop_all_watchers().await;
        let mut map = self.watchers.lock().await;
        for kind in watchers::DEFAULT_WATCHED {
            match watchers::start_watcher(app.clone(), self.clone(), kind).await {
                Ok(h) => {
                    map.insert((*kind).to_string(), h);
                }
                Err(e) => {
                    tracing::warn!(kind, "start_watcher failed: {e}");
                }
            }
        }
        let count = map.len();
        drop(map);
        let _ = app.emit("watch-status", count);
        tracing::info!(active = count, "default watchers started");
        Ok(())
    }

    /// Abort every running watcher.
    pub async fn stop_all_watchers(&self) {
        let mut map = self.watchers.lock().await;
        for (_, h) in map.drain() {
            h.abort();
        }
    }

    /// Count of currently active watchers.
    pub async fn active_watcher_count(&self) -> usize {
        self.watchers.lock().await.len()
    }

    // ---- cluster-status poller ----

    /// Start the background cluster-status poller. Replaces any prior
    /// one (so context switches get a fresh poller).
    pub async fn start_status_poller(self: &Arc<Self>, app: &AppHandle) {
        self.stop_status_poller().await;
        let handle = watchers::spawn_status_poller(app.clone(), self.clone());
        *self.status_task.lock().await = Some(handle);
        tracing::info!("cluster-status poller started");
    }

    /// Stop the cluster-status poller.
    pub async fn stop_status_poller(&self) {
        if let Some(h) = self.status_task.lock().await.take() {
            h.abort();
        }
    }
}

/// Probe the cluster: server version, name, and address. Used to
/// populate `ClusterInfo` on connect.
async fn probe_cluster(client: &kube::Client, context: &str) -> anyhow::Result<ClusterInfo> {
    // Real `/version` call (kube `version` feature). Cheap and
    // authoritative — no need to guess from a placeholder.
    let version = client
        .apiserver_version()
        .await
        .ok()
        .map(|v| v.git_version)
        .unwrap_or_else(|| "unknown".into());

    // Cheap reachability check + node list (kept so we can show
    // nodesReady/nodesTotal in the footer even before the first
    // status tick).
    use k8s_openapi::api::core::v1::Node;
    use kube::api::{Api, ListParams};
    let _ = Api::<Node>::all(client.clone())
        .list(&ListParams {
            limit: Some(1),
            ..Default::default()
        })
        .await?;

    // Server address: read from the kubeconfig we just used.
    let kc = super::client::load_kubeconfig().unwrap_or_default();
    let cluster_name = kc
        .contexts
        .iter()
        .find(|c| c.name == context)
        .and_then(|c| c.context.as_ref())
        .map(|c| c.cluster.clone())
        .unwrap_or_else(|| context.to_string());
    let server = kc
        .clusters
        .iter()
        .find(|cl| cl.name == cluster_name)
        .and_then(|cl| cl.cluster.as_ref())
        .and_then(|c| c.server.clone())
        .unwrap_or_default();

    Ok(ClusterInfo {
        context: context.to_string(),
        cluster_name,
        server,
        version,
    })
}

/// Re-export `ContextInfo` for callers that import `ClientManager`
/// and want the kubeconfig context shape.
#[allow(unused_imports)]
pub use super::dto::ContextInfo as _ContextInfo;

/// Type alias for what Tauri command signatures take. Most commands
/// want the manager (state) and an optional `kube::Client`. Going
/// through the alias keeps the call sites consistent.
pub type Mgr = Arc<ClientManager>;

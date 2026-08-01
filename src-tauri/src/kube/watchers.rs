//! Reflector-based live watchers — emit `resource-update` events
//! (debounced) to the frontend.
//!
//! ## How it works
//!
//! - One `WatcherHandle` per kind, owned by `ClientManager`.
//! - Each watcher:
//!   1. Emits an **initial snapshot** immediately.
//!   2. Opens a `kube::runtime::watcher` stream and on every event
//!      re-snapshots and re-emits — **throttled** to one emit per
//!      `THROTTLE` window, so a burst of events becomes one UI update.
//! - On disconnect / context switch, the manager drops every handle,
//!   which aborts the task and the stream.
//!
//! We don't care about the **payload** of any event — we re-snapshot
//! on every signal. So each kind owns its own thin loop that converts
//! the typed event stream into a stream of `Result<(), kube_client::Error>`.
//!
//! ## Event names (kept in sync with the React side)
//!
//! - `resource-update`  → `ResourceSnapshot { kind, rows }`
//! - `cluster-status`   → `ClusterStatus` (separate status poller)
//! - `watch-status`     → `number` (count of active watchers)

use std::sync::Arc;
use std::time::Duration;

use futures::Stream;
use futures::StreamExt;
use kube::api::ListParams;
use kube::runtime::watcher;
use tauri::{AppHandle, Emitter};

use crate::error::AppResult;
use crate::kube::dto::{ClusterStatus, ResourceSnapshot};
use crate::kube::manager::ClientManager;

// ---------------------------------------------------------------------------
// Throttle + status polling cadence
// ---------------------------------------------------------------------------

/// Minimum time between two `resource-update` emits for the same kind.
/// Bursts of watcher events become a single UI update.
pub const THROTTLE: Duration = Duration::from_millis(200);

/// Polling interval for the cluster status poller.
pub const STATUS_INTERVAL: Duration = Duration::from_secs(5);

// ---------------------------------------------------------------------------
// Kinds the manager starts by default after `connect`.
// ---------------------------------------------------------------------------

/// The set of kinds the manager starts watching automatically. Adding a
/// new kind? Drop it in here and the frontend will see it update live.
pub const DEFAULT_WATCHED: &[&str] = &[
    "pods",
    "deployments",
    "statefulsets",
    "daemonsets",
    "replicasets",
    "jobs",
    "cronjobs",
    "services",
    "configmaps",
    "secrets",
    "hpa",
    "events",
    "pvc",
    "nodes",
    "namespaces",
];

// ---------------------------------------------------------------------------
// WatcherHandle — drop or abort to stop.
// ---------------------------------------------------------------------------

/// Watcher task handle. Drop or call `abort` to stop.
pub struct WatcherHandle {
    /// Friendly name (for the "watch: N streams active" footer).
    pub kind: String,
    /// The background task; abort on drop.
    pub task: tokio::task::JoinHandle<()>,
}

impl WatcherHandle {
    pub fn abort(&self) {
        self.task.abort();
    }
}

impl Drop for WatcherHandle {
    fn drop(&mut self) {
        self.task.abort();
    }
}

// ---------------------------------------------------------------------------
// start_watcher — public entry point used by ClientManager.
// ---------------------------------------------------------------------------

/// Start a watcher for `kind`. Emits the initial snapshot immediately,
/// then watches and emits (throttled) on every change.
pub async fn start_watcher(
    app: AppHandle,
    mgr: Arc<ClientManager>,
    kind: &'static str,
) -> AppResult<WatcherHandle> {
    let client = mgr.client().await?;

    // 1) Initial snapshot — UI has data right away.
    if let Ok(snap) = snapshot_kind(&client, kind).await {
        let _ = app.emit("resource-update", &snap);
    }

    // 2) Spawn the watch loop. It owns its own client fetch on reconnect.
    let task = tokio::spawn(watch_loop(app, mgr, kind));

    Ok(WatcherHandle {
        kind: kind.to_string(),
        task,
    })
}

/// The actual watch loop for one kind. Reconnects on transient errors
/// (e.g. the watcher's internal backoff), bails on disconnect.
async fn watch_loop(app: AppHandle, mgr: Arc<ClientManager>, kind: &'static str) {
    let mut last_emit: Option<tokio::time::Instant> = None;

    loop {
        let client = match mgr.client().await {
            Ok(c) => c,
            Err(_) => return, // disconnected — bail
        };

        // Build the typed signal stream for this kind.
        let mut stream = match build_signal_stream(&client, kind).await {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(kind, "watcher build failed: {e}");
                if mgr.client().await.is_err() {
                    return;
                }
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }
        };

        // Drain the signal stream. Throttle emits to one per `THROTTLE`.
        while let Some(signal) = stream.next().await {
            match signal {
                Ok(()) => {
                    let now = tokio::time::Instant::now();
                    let elapsed = last_emit.map(|t| now.duration_since(t));
                    let should_emit = match elapsed {
                        None => true,
                        Some(d) => d >= THROTTLE,
                    };
                    if should_emit {
                        last_emit = Some(now);
                        emit_snapshot(&app, &mgr, kind).await;
                    } else {
                        // Throttled — sleep the remainder then emit.
                        let wait = THROTTLE - elapsed.unwrap();
                        tokio::time::sleep(wait).await;
                        if mgr.client().await.is_err() {
                            return;
                        }
                        last_emit = Some(tokio::time::Instant::now());
                        emit_snapshot(&app, &mgr, kind).await;
                    }
                }
                Err(e) => {
                    tracing::warn!(kind, "watcher stream error: {e}");
                    // Rebuild the stream after a short pause.
                    if mgr.client().await.is_err() {
                        return;
                    }
                    break;
                }
            }
        }

        // Stream ended — loop and rebuild.
        if mgr.client().await.is_err() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

async fn emit_snapshot(app: &AppHandle, mgr: &ClientManager, kind: &str) {
    let Ok(client) = mgr.client().await else { return };
    let Ok(snap) = snapshot_kind(&client, kind).await else {
        return;
    };
    let _ = app.emit("resource-update", &snap);
}

// ---------------------------------------------------------------------------
// build_signal_stream — turn a typed `Api<K>` into a stream of Ok(()) / Err.
// ---------------------------------------------------------------------------

/// A signal stream is a stream of `Result<(), anyhow::Error>` —
/// one signal per watcher event. The payload is discarded; we re-snapshot
/// the whole kind on every signal.
type SignalStream = std::pin::Pin<Box<dyn Stream<Item = anyhow::Result<()>> + Send>>;

async fn build_signal_stream(client: &kube::Client, kind: &str) -> anyhow::Result<SignalStream> {
    use k8s_openapi::api::apps::v1::{DaemonSet, Deployment, ReplicaSet, StatefulSet};
    use k8s_openapi::api::autoscaling::v1::HorizontalPodAutoscaler;
    use k8s_openapi::api::batch::v1::{CronJob, Job};
    use k8s_openapi::api::core::v1::{
        ConfigMap, Event, Namespace, Node, PersistentVolumeClaim, Pod, Secret, Service,
    };

    let cfg = kube::runtime::watcher::Config::default();

    /// Wrap a typed watcher stream into our signal shape.
    fn signalize<K, S>(s: S) -> SignalStream
    where
        S: Stream<Item = kube::runtime::watcher::Result<watcher::Event<K>>> + Send + 'static,
    {
        Box::pin(s.map(|res| {
            res.map(|_event| ()).map_err(|e| anyhow::anyhow!("{e}"))
        }))
    }

    Ok(match kind {
        "pods" => signalize(watcher(
            kube::api::Api::<Pod>::all(client.clone()),
            cfg,
        )),
        "deployments" => signalize(watcher(
            kube::api::Api::<Deployment>::all(client.clone()),
            cfg,
        )),
        "statefulsets" => signalize(watcher(
            kube::api::Api::<StatefulSet>::all(client.clone()),
            cfg,
        )),
        "daemonsets" => signalize(watcher(
            kube::api::Api::<DaemonSet>::all(client.clone()),
            cfg,
        )),
        "replicasets" => signalize(watcher(
            kube::api::Api::<ReplicaSet>::all(client.clone()),
            cfg,
        )),
        "jobs" => signalize(watcher(
            kube::api::Api::<Job>::all(client.clone()),
            cfg,
        )),
        "cronjobs" => signalize(watcher(
            kube::api::Api::<CronJob>::all(client.clone()),
            cfg,
        )),
        "services" => signalize(watcher(
            kube::api::Api::<Service>::all(client.clone()),
            cfg,
        )),
        "configmaps" => signalize(watcher(
            kube::api::Api::<ConfigMap>::all(client.clone()),
            cfg,
        )),
        "secrets" => signalize(watcher(
            kube::api::Api::<Secret>::all(client.clone()),
            cfg,
        )),
        "nodes" => signalize(watcher(
            kube::api::Api::<Node>::all(client.clone()),
            cfg,
        )),
        "namespaces" => signalize(watcher(
            kube::api::Api::<Namespace>::all(client.clone()),
            cfg,
        )),
        "hpa" => signalize(watcher(
            kube::api::Api::<HorizontalPodAutoscaler>::all(client.clone()),
            cfg,
        )),
        "events" => signalize(watcher(
            kube::api::Api::<Event>::all(client.clone()),
            cfg,
        )),
        "pvc" => signalize(watcher(
            kube::api::Api::<PersistentVolumeClaim>::all(client.clone()),
            cfg,
        )),
        other => anyhow::bail!("unsupported watched kind: {other}"),
    })
}

// ---------------------------------------------------------------------------
// snapshot_kind — fresh list, used by the watcher on every emit and
// also by the `list_*` Tauri commands for cold reads.
// ---------------------------------------------------------------------------

/// Take a complete snapshot of `kind` via a fresh list call.
pub async fn snapshot_kind(
    client: &kube::Client,
    kind: &str,
) -> Result<ResourceSnapshot, anyhow::Error> {
    use super::mappers;

    let rows: Vec<super::dto::Row> = match kind {
        "pods" => {
            let api: kube::api::Api<k8s_openapi::api::core::v1::Pod> =
                kube::api::Api::all(client.clone());
            let list = api.list(&ListParams::default()).await?;
            list.iter().map(mappers::pod_to_row).collect()
        }
        "deployments" => {
            let api: kube::api::Api<k8s_openapi::api::apps::v1::Deployment> =
                kube::api::Api::all(client.clone());
            let list = api.list(&ListParams::default()).await?;
            list.iter().map(mappers::deployment_to_row).collect()
        }
        "services" => {
            let api: kube::api::Api<k8s_openapi::api::core::v1::Service> =
                kube::api::Api::all(client.clone());
            let list = api.list(&ListParams::default()).await?;
            list.iter().map(mappers::service_to_row).collect()
        }
        "nodes" => {
            let api: kube::api::Api<k8s_openapi::api::core::v1::Node> =
                kube::api::Api::all(client.clone());
            let list = api.list(&ListParams::default()).await?;
            list.iter().map(mappers::node_to_row).collect()
        }
        "namespaces" => {
            let api: kube::api::Api<k8s_openapi::api::core::v1::Namespace> =
                kube::api::Api::all(client.clone());
            let list = api.list(&ListParams::default()).await?;
            list.iter().map(mappers::namespace_to_row).collect()
        }
        "configmaps" => {
            let api: kube::api::Api<k8s_openapi::api::core::v1::ConfigMap> =
                kube::api::Api::all(client.clone());
            let list = api.list(&ListParams::default()).await?;
            list.iter().map(mappers::configmap_to_row).collect()
        }
        "events" => {
            let api: kube::api::Api<k8s_openapi::api::core::v1::Event> =
                kube::api::Api::all(client.clone());
            let list = api.list(&ListParams::default()).await?;
            list.iter().map(mappers::event_to_row).collect()
        }
        "secrets" => {
            let api: kube::api::Api<k8s_openapi::api::core::v1::Secret> =
                kube::api::Api::all(client.clone());
            let list = api.list(&ListParams::default()).await?;
            list.iter().map(mappers::secret_to_row).collect()
        }
        "hpa" => {
            let api: kube::api::Api<
                k8s_openapi::api::autoscaling::v1::HorizontalPodAutoscaler,
            > = kube::api::Api::all(client.clone());
            let list = api.list(&ListParams::default()).await?;
            list.iter().map(mappers::hpa_to_row).collect()
        }
        "statefulsets" => {
            let api: kube::api::Api<k8s_openapi::api::apps::v1::StatefulSet> =
                kube::api::Api::all(client.clone());
            let list = api.list(&ListParams::default()).await?;
            list.iter().map(mappers::statefulset_to_row).collect()
        }
        "daemonsets" => {
            let api: kube::api::Api<k8s_openapi::api::apps::v1::DaemonSet> =
                kube::api::Api::all(client.clone());
            let list = api.list(&ListParams::default()).await?;
            list.iter().map(mappers::daemonset_to_row).collect()
        }
        "replicasets" => {
            let api: kube::api::Api<k8s_openapi::api::apps::v1::ReplicaSet> =
                kube::api::Api::all(client.clone());
            let list = api.list(&ListParams::default()).await?;
            list.iter().map(mappers::replicaset_to_row).collect()
        }
        "jobs" => {
            let api: kube::api::Api<k8s_openapi::api::batch::v1::Job> =
                kube::api::Api::all(client.clone());
            let list = api.list(&ListParams::default()).await?;
            list.iter().map(mappers::job_to_row).collect()
        }
        "cronjobs" => {
            let api: kube::api::Api<k8s_openapi::api::batch::v1::CronJob> =
                kube::api::Api::all(client.clone());
            let list = api.list(&ListParams::default()).await?;
            list.iter().map(mappers::cronjob_to_row).collect()
        }
        "pvc" => {
            let api: kube::api::Api<k8s_openapi::api::core::v1::PersistentVolumeClaim> =
                kube::api::Api::all(client.clone());
            let list = api.list(&ListParams::default()).await?;
            list.iter().map(mappers::pvc_to_row).collect()
        }
        other => anyhow::bail!("snapshot_kind: unsupported kind {other}"),
    };

    Ok(ResourceSnapshot {
        kind: kind.to_string(),
        rows,
    })
}

// ---------------------------------------------------------------------------
// cluster-status poller
// ---------------------------------------------------------------------------

/// Spawn a background task that polls cluster status every
/// [`STATUS_INTERVAL`] and emits a `cluster-status` event.
pub fn spawn_status_poller(app: AppHandle, mgr: Arc<ClientManager>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(STATUS_INTERVAL);
        // First tick fires immediately; skip it so we don't emit a
        // pre-connection status.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            if mgr.client().await.is_err() {
                return; // disconnected
            }
            let status = compute_status(&mgr).await;
            let _ = app.emit("cluster-status", &status);
        }
    })
}

/// Snapshot the cluster status (latency, ready/total nodes, optional
/// metrics-server CPU/mem).
async fn compute_status(mgr: &ClientManager) -> ClusterStatus {
    let mut s = ClusterStatus {
        connected: true,
        ..ClusterStatus::default()
    };

    if let Some(info) = mgr.cluster_info().await {
        s.version = info.version;
    }

    let client = match mgr.client().await {
        Ok(c) => c,
        Err(_) => return s,
    };

    // Latency: time a small list call takes.
    let start = tokio::time::Instant::now();
    let nodes_res = kube::api::Api::<k8s_openapi::api::core::v1::Node>::all(client.clone())
        .list(&kube::api::ListParams {
            limit: Some(50),
            ..Default::default()
        })
        .await;
    s.api_latency_ms = start.elapsed().as_millis() as u64;

    if let Ok(list) = nodes_res {
        s.nodes_total = list.items.len() as u32;
        s.nodes_ready = list
            .items
            .iter()
            .filter(|n| {
                n.status
                    .as_ref()
                    .and_then(|st| st.conditions.as_ref())
                    .map(|conds| {
                        conds
                            .iter()
                            .any(|c| c.type_ == "Ready" && c.status == "True")
                    })
                    .unwrap_or(false)
            })
            .count() as u32;
    }

    // P1: CPU / mem from metrics-server are deferred — k8s-openapi
    // 0.25 doesn't ship `metrics.k8s.io` types without a feature flag.
    // The DTO has `Option<f64>`, so the UI just renders "—".

    s
}

#[allow(dead_code)]
fn parse_cpu(q: Option<k8s_openapi::apimachinery::pkg::api::resource::Quantity>) -> f64 {
    // Reserved for P2 — k8s-openapi 0.25 doesn't ship metrics types
    // without a feature flag. Reused once the feature is enabled.
    let _ = q;
    0.0
}

#[allow(dead_code)]
fn parse_mem(q: Option<k8s_openapi::apimachinery::pkg::api::resource::Quantity>) -> f64 {
    let _ = q;
    0.0
}

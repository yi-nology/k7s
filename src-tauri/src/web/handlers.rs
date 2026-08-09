//! Core HTTP handlers — connection management, preferences, and helpers.
//!
//! Contains the cluster lifecycle commands (`list_contexts`, `connect`,
//! `status`, `import_kubeconfig_content`), preference I/O, the catch-all
//! `not_implemented` stub, and the shared `core_client` helper that every
//! handler module uses.
//!
//! Resource mutation and shell handlers live in their own modules
//! (`resource_handlers`, `shell_handlers`).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use kube::config::Kubeconfig;
use std::sync::Arc;

use crate::core::prefs::{self, Prefs};
use crate::core::shell_common;
use crate::core::CoreState;
use crate::error::{AppError, AppResult};
use crate::kube::{
    client::{self, ClusterInfo, ContextInfo},
    discovery,
    manager::{ConnectionInfo, ImportedContext},
    watchers,
};

use super::state::WebState;
use super::types::*;

// ---------------------------------------------------------------------------
// list_contexts
// ---------------------------------------------------------------------------

/// `POST /invoke/list_contexts` — list kubeconfig contexts (with imports).
pub async fn list_contexts(State(state): State<WebState>) -> axum::response::Response {
    let core = state.core.clone();
    let result = shell_common::merged_contexts(&core.manager).await;
    respond(Ok(result))
}

// ---------------------------------------------------------------------------
// default_kubeconfig_path
// ---------------------------------------------------------------------------

/// `POST /invoke/default_kubeconfig_path` — no body.
pub async fn default_kubeconfig_path() -> axum::response::Response {
    respond(Ok(client::default_kubeconfig_path()))
}

// ---------------------------------------------------------------------------
// status — what the connection banner reads on every poll.
// ---------------------------------------------------------------------------

pub async fn status(State(state): State<WebState>) -> axum::response::Response {
    let info = state.core.manager.connection_info().await;
    // `connected` is the *intersection* of "client is live" and "info is
    // populated". Both halves are set/cleared atomically with the same lock
    // in `set_connected` / `reset`, so in practice they're in lockstep —
    // but the intersection makes the invariant explicit: a half-state
    // (e.g. client leaked through `reset` due to a future refactor) would
    // surface as `connected: false` here rather than a phantom banner.
    let client_alive = state.core.manager.client().await.is_some();
    let dto = StatusDto {
        connected: client_alive && info.is_some(),
        context: info.as_ref().map(|i| i.context.clone()),
        server: info.as_ref().map(|i| i.server.clone()),
        version: info.as_ref().map(|i| i.version.clone()),
        watcher_count: if client_alive {
            // Reuse the read lock the client check just held. Cheap and
            // avoids a second write-side acquire.
            state.core.manager.watcher_count().await
        } else {
            0
        },
    };
    respond(Ok(dto))
}

// ---------------------------------------------------------------------------
// load_prefs / save_prefs
// ---------------------------------------------------------------------------

/// `POST /invoke/load_prefs` — read the prefs file under `state.core.data_dir`.
pub async fn load_prefs(State(state): State<WebState>) -> axum::response::Response {
    let path = state.core.data_dir.join("prefs.json");
    let text = std::fs::read_to_string(&path).ok();
    let prefs: Option<Prefs> = text.and_then(|t| serde_json::from_str(&t).ok());
    respond(Ok(prefs))
}

/// `POST /invoke/save_prefs` — write the prefs file under `state.core.data_dir`.
pub async fn save_prefs(
    State(state): State<WebState>,
    Json(args): Json<SavePrefsArgs>,
) -> axum::response::Response {
    respond(prefs::save_prefs(&state.core.data_dir, &args.prefs))
}

// ---------------------------------------------------------------------------
// import_kubeconfig_content — browser equivalent of the Tauri file dialog.
// ---------------------------------------------------------------------------

/// `POST /api/invoke/import_kubeconfig_content` — parse a kubeconfig the
/// user picked in the browser, register every context in the manager, and
/// return the merged switcher list.
pub async fn import_kubeconfig_content(
    State(state): State<WebState>,
    Json(args): Json<ImportKubeconfigContentArgs>,
) -> axum::response::Response {
    let core = state.core.clone();
    let result: AppResult<ImportResultWire> = (|| async {
        // Parse the YAML exactly like `client::contexts_from_file` does for
        // the Tauri path, so the two shells agree on the wire shape and
        // what "unparseable" looks like to the user.
        let kc = Kubeconfig::from_yaml(&args.contents)
            .map_err(|e| AppError::Kubeconfig(format!("couldn't parse {}: {e}", args.filename)))?;

        let imported: Vec<ContextInfo> = kc
            .contexts
            .iter()
            .map(|ctx| {
                let cluster = ctx
                    .context
                    .as_ref()
                    .map(|c| c.cluster.clone())
                    .unwrap_or_default();
                ContextInfo {
                    name: ctx.name.clone(),
                    cluster,
                    current: false,
                }
            })
            .collect();

        // Register each context so a later `connect` builds from this file.
        // We stash the parsed `Kubeconfig` (rather than the file path)
        // because the web shell has no real file on disk — the bytes came
        // from the user's `<input type="file">` and are gone the moment
        // they pick again.
        for ctx in &imported {
            core.manager
                .add_import(
                    ctx.name.clone(),
                    ImportedContext {
                        path: args.filename.clone(),
                        cluster: ctx.cluster.clone(),
                        kubeconfig: Some(kc.clone()),
                    },
                )
                .await;
        }

        let merged = shell_common::merged_contexts(&core.manager).await;
        Ok(ImportResultWire {
            contexts: merged,
            path: args.filename,
        })
    })()
    .await;
    respond(result)
}

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

/// `POST /invoke/connect` — tear down the current connection, build a
/// client for the requested context, start all watchers and pollers.
pub async fn connect(
    State(state): State<WebState>,
    Json(args): Json<ConnectArgs>,
) -> axum::response::Response {
    let core = state.core.clone();
    let result: AppResult<ClusterInfo> = (|| async {
        // Abort every task from the previous connection first.
        core.manager.reset().await;

        let context = args.context;
        // Three ways to build a client for `context`:
        //   1. It was imported from a file and the file still exists on
        //      disk (Tauri shell).
        //   2. It was imported from a file the web shell uploaded — we
        //      stashed the parsed `Kubeconfig` in the manager, use that.
        //   3. It's a context in the default kubeconfig.
        let (kube_client, server) = if let Some(kc) = core.manager.import_kubeconfig(&context).await
        {
            build_client_from_kubeconfig(kc, &context).await?
        } else if let Some(path) = core.manager.import_path(&context).await {
            client::build_client_from_file(&path, &context).await?
        } else {
            client::build_client(&context).await?
        };
        let version = client::probe_version(&kube_client).await?;

        // Watchers for all built-in kinds (B1).
        let watcher_count = watchers::spawn_all(&core.manager, kube_client.clone()).await;

        // Metrics + status pollers (B23). Read intervals from prefs at connect,
        // so a settings change takes effect on the next connection.
        let pi = prefs::poll_intervals(&prefs::read_prefs(&core.data_dir));
        let (metrics_task, status_task) =
            crate::kube::metrics::spawn_pollers(core.manager.sink(), kube_client.clone(), pi);
        let _ = core.manager.push_task(metrics_task).await;
        let _ = core.manager.push_task(status_task).await;

        // CRD discovery — the same as the Tauri `connect` does (B15).
        let custom = discovery::discover(&kube_client).await;
        core.manager.set_custom_kinds(custom.clone()).await;
        let _ = core
            .manager
            .sink()
            .emit(crate::kube::events::CUSTOM_KINDS, &custom);

        let _ = core
            .manager
            .set_connected(
                kube_client,
                ConnectionInfo {
                    context: context.clone(),
                    server: server.clone(),
                    version: version.clone(),
                },
                watcher_count,
            )
            .await;

        Ok(ClusterInfo {
            context: context.clone(),
            cluster_name: context,
            server,
            version,
        })
    })()
    .await;
    respond(result)
}

// ---------------------------------------------------------------------------
// Catch-all stub for unimplemented commands.
// ---------------------------------------------------------------------------

/// Catch-all for commands we haven't bridged yet. Returns a 501 + a clear
/// error so the front-end knows the call is unimplemented (rather than
/// silently mis-routing).
pub async fn not_implemented() -> axum::response::Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(InvokeError {
            ok: false,
            error: "this command isn't bridged through the web shell yet".to_string(),
        }),
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// Helpers (re-implementations of the small bits commands.rs's connect/get_yaml
// need that aren't already in `kube::`).
// ---------------------------------------------------------------------------

pub(super) async fn core_client(core: &Arc<CoreState>) -> AppResult<kube::Client> {
    // `Disconnected` (not `NotFound`) is intentional: the front-end wants to
    // detect this case and route to a "pick a cluster" flow, not treat it as
    // "the object you asked for doesn't exist". String-matching would be
    // fragile; switching on the error variant in serde-deserialised output
    // is harder, so the error message itself stays human-readable and the
    // Tauri shell (which uses a different error path) keeps its own
    // classification.
    core.manager.client().await.ok_or(AppError::Disconnected)
}

// ---------------------------------------------------------------------------
// SBOM handlers
// ---------------------------------------------------------------------------

/// `POST /api/sbom/image` — Generate SBOM for a container image.
pub async fn sbom_generate_image(
    State(state): State<WebState>,
    Json(req): Json<serde_json::Value>,
) -> axum::response::Response {
    let image_ref = req["image_ref"].as_str().unwrap_or("").to_string();
    let format_str = req["format"].as_str().unwrap_or("cyclonedx");
    let format = crate::kube::sbom::SbomFormat::parse(format_str)
        .unwrap_or(crate::kube::sbom::SbomFormat::CycloneDx);

    let engine = crate::kube::sbom::SbomEngine::new();
    let result: AppResult<_> = async {
        let sbom = engine.generate_with_vulns(&image_ref, &format).await?;
        let storage = crate::kube::sbom_storage::SbomStorage::new(&state.core.data_dir);
        storage.save(&sbom)?;
        Ok(sbom)
    }
    .await;
    respond(result)
}

/// `GET /api/sbom/history` — List SBOM scan history.
pub async fn sbom_list_history(State(state): State<WebState>) -> axum::response::Response {
    let storage = crate::kube::sbom_storage::SbomStorage::new(&state.core.data_dir);
    respond(storage.list())
}

/// `GET /api/sbom/:id` — Get SBOM by ID.
pub async fn sbom_get(
    State(state): State<WebState>,
    Path(id): Path<String>,
) -> axum::response::Response {
    let storage = crate::kube::sbom_storage::SbomStorage::new(&state.core.data_dir);
    respond(storage.load(&id))
}

// ---------------------------------------------------------------------------
// Helpers (re-implementations of the small bits commands.rs's connect/get_yaml
// need that aren't already in `kube::`).
// ---------------------------------------------------------------------------

/// Build a kube client from an already-parsed `Kubeconfig` (the web shell
/// has the file's bytes in memory, not on disk; this avoids re-reading).
/// Mirrors `client::build_client_from_file` line-for-line, just starting
/// from a `Kubeconfig` rather than a path.
async fn build_client_from_kubeconfig(
    kubeconfig: kube::config::Kubeconfig,
    context: &str,
) -> AppResult<(kube::Client, String)> {
    use kube::config::{Config, KubeConfigOptions};
    let options = KubeConfigOptions {
        context: Some(context.to_string()),
        cluster: None,
        user: None,
    };
    let config = Config::from_custom_kubeconfig(kubeconfig, &options)
        .await
        .map_err(|e| AppError::Kubeconfig(e.to_string()))?;
    let server = config.cluster_url.to_string();
    let client = kube::Client::try_from(config)?;
    Ok((client, server))
}

// ---------------------------------------------------------------------------
// AI webhook hooks
// ---------------------------------------------------------------------------

/// POST /hooks/wake — fire-and-forget: wake the agent with a message.
/// The response returns immediately; the agent runs in the background.
pub async fn hook_wake(
    State(state): State<WebState>,
    headers: axum::http::HeaderMap,
    axum::extract::Json(body): axum::extract::Json<serde_json::Value>,
) -> axum::response::Response {
    let hook_config = crate::ai::hooks::HookConfig {
        enabled: true,
        token: std::env::var("K7S_HOOK_TOKEN").unwrap_or_default(),
        ..Default::default()
    };
    let auth = headers.get("authorization").and_then(|v| v.to_str().ok());
    if !crate::ai::hooks::verify_hook(&hook_config, auth) {
        return axum::response::Json(
            serde_json::json!({"success": false, "message": "unauthorized"}),
        )
        .into_response();
    }
    let message = body
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("health check");
    tracing::info!(message = message, "hook/wake triggered");
    axum::response::Json(serde_json::json!({
        "success": true,
        "message": format!("received: {}", message),
    }))
    .into_response()
}

/// POST /hooks/agent — synchronous: send a message, get the response back.
/// Currently returns a placeholder; full integration would construct a
/// ChatRequest and run the agent loop.
pub async fn hook_agent(
    State(_state): State<WebState>,
    headers: axum::http::HeaderMap,
    axum::extract::Json(body): axum::extract::Json<serde_json::Value>,
) -> axum::response::Response {
    let hook_config = crate::ai::hooks::HookConfig {
        enabled: true,
        token: std::env::var("K7S_HOOK_TOKEN").unwrap_or_default(),
        ..Default::default()
    };
    let auth = headers.get("authorization").and_then(|v| v.to_str().ok());
    if !crate::ai::hooks::verify_hook(&hook_config, auth) {
        return axum::response::Json(
            serde_json::json!({"success": false, "message": "unauthorized"}),
        )
        .into_response();
    }
    let message = body.get("message").and_then(|v| v.as_str()).unwrap_or("");
    let skill_id = body.get("skillId").and_then(|v| v.as_str());
    tracing::info!(message = message, skill = skill_id, "hook/agent triggered");
    // Full integration: construct ChatRequest, run AgentLoop, return response.
    // For now, acknowledge receipt.
    axum::response::Json(serde_json::json!({
        "success": true,
        "message": format!("agent received: '{}' (full agent integration pending)", message),
    }))
    .into_response()
}

/// POST /hooks/event — push a cluster event for the agent to analyze.
pub async fn hook_event(
    State(_state): State<WebState>,
    headers: axum::http::HeaderMap,
    axum::extract::Json(body): axum::extract::Json<serde_json::Value>,
) -> axum::response::Response {
    let hook_config = crate::ai::hooks::HookConfig {
        enabled: true,
        token: std::env::var("K7S_HOOK_TOKEN").unwrap_or_default(),
        ..Default::default()
    };
    let auth = headers.get("authorization").and_then(|v| v.to_str().ok());
    if !crate::ai::hooks::verify_hook(&hook_config, auth) {
        return axum::response::Json(
            serde_json::json!({"success": false, "message": "unauthorized"}),
        )
        .into_response();
    }
    let event_type = body
        .get("eventType")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let severity = body
        .get("severity")
        .and_then(|v| v.as_str())
        .unwrap_or("info");
    let description = body
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    tracing::info!(
        event_type = event_type,
        severity = severity,
        description = description,
        "hook/event received"
    );
    // Full integration: store the event, trigger agent analysis if severity >= warning.
    axum::response::Json(serde_json::json!({
        "success": true,
        "message": format!("event received: {} ({})", event_type, severity),
    }))
    .into_response()
}

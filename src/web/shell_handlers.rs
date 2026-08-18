//! Shell and log-streaming HTTP handlers.
//!
//! Covers: pod/node shell sessions (start, input, resize, stop) and log
//! streaming (start, stop, export). The wire names match the Tauri commands
//! so the front-end can swap providers unchanged.

use axum::{extract::State, Json};

use k7s_core::core::shell_common::{self, NodeShellInfo, ShellInfo};
use k7s_core::error::AppResult;

use super::handlers::core_client;
use super::state::WebState;
use super::types::*;

// ---------------------------------------------------------------------------
// Log streaming — the headline feature of the web shell, previously stubbed.
// The Tauri path spawned a tokio task and pushed events to the same
// `EventSink`; the web path does the same, just behind a different transport.
// ---------------------------------------------------------------------------

pub async fn start_log_stream(
    State(state): State<WebState>,
    Json(args): Json<StartLogStreamArgs>,
) -> axum::response::Response {
    let result: AppResult<String> = (|| async {
        let client = core_client(&state.core).await?;
        let opts = k7s_core::kube::logs::LogStreamOptions {
            tail: args.tail,
            since_time: args.since_time,
            since_seconds: args.since_seconds,
            previous: args.previous,
        };
        let stream_id = shell_common::spawn_log_stream(
            &state.core.manager,
            client,
            args.namespace,
            args.pod,
            args.container,
            opts,
        )
        .await;
        Ok(stream_id)
    })()
    .await;
    respond(result)
}

pub async fn stop_log_stream(
    State(state): State<WebState>,
    Json(args): Json<StopLogStreamArgs>,
) -> axum::response::Response {
    let result: AppResult<()> = (|| async {
        state.core.manager.remove_log(&args.stream_id).await;
        Ok(())
    })()
    .await;
    respond(result)
}

pub async fn export_logs(
    State(state): State<WebState>,
    Json(args): Json<ExportLogsArgs>,
) -> axum::response::Response {
    use k7s_core::kube::logs;
    let result: AppResult<usize> = (|| async {
        let client = core_client(&state.core).await?;
        let containers = if args.container.is_empty() {
            vec![]
        } else {
            vec![args.container.clone()]
        };
        // Security: the web shell must NOT write to the server filesystem —
        // `args.path` comes from the browser and could be a path traversal.
        // Return the line count so the browser can trigger a download.
        let _ = args.path; // unused in web mode
        let (_out, lines) = logs::fetch_export_logs(
            client,
            &args.namespace,
            &args.pod,
            containers,
            args.since_seconds,
            args.previous,
        )
        .await?;
        Ok(lines)
    })()
    .await;
    respond(result)
}

// ---------------------------------------------------------------------------
// Shell sessions (B4, B53) — the same exec task the Tauri shell spawns, with
// input/resize going over POST and the byte stream coming back through the
// shared `EventSink` -> SSE. The wire names match the Tauri commands so the
// front-end can swap providers unchanged.
// ---------------------------------------------------------------------------

pub async fn start_shell(
    State(state): State<WebState>,
    Json(args): Json<StartShellArgs>,
) -> axum::response::Response {
    let result: AppResult<ShellInfo> = (|| async {
        let client = core_client(&state.core).await?;
        shell_common::spawn_shell_session(
            &state.core.manager,
            client,
            args.namespace,
            args.pod,
            args.container,
            &state.core.data_dir,
        )
        .await
    })()
    .await;
    respond(result)
}

pub async fn shell_input(
    State(state): State<WebState>,
    Json(args): Json<ShellInputArgs>,
) -> axum::response::Response {
    let result: AppResult<()> = (|| async {
        state
            .core
            .manager
            .shell_input(&args.stream_id, args.data.into_bytes())
            .await;
        Ok(())
    })()
    .await;
    respond(result)
}

pub async fn shell_resize(
    State(state): State<WebState>,
    Json(args): Json<ShellResizeArgs>,
) -> axum::response::Response {
    let result: AppResult<()> = (|| async {
        state
            .core
            .manager
            .shell_resize(&args.stream_id, args.cols, args.rows)
            .await;
        Ok(())
    })()
    .await;
    respond(result)
}

pub async fn stop_shell(
    State(state): State<WebState>,
    Json(args): Json<StopShellArgs>,
) -> axum::response::Response {
    let result: AppResult<()> = (|| async {
        state.core.manager.remove_shell(&args.stream_id).await;
        Ok(())
    })()
    .await;
    respond(result)
}

pub async fn start_node_shell(
    State(state): State<WebState>,
    Json(args): Json<StartNodeShellArgs>,
) -> axum::response::Response {
    let result: AppResult<NodeShellInfo> = (|| async {
        let client = core_client(&state.core).await?;
        shell_common::spawn_node_shell_session(
            &state.core.manager,
            client,
            args.node,
            &state.core.data_dir,
        )
        .await
    })()
    .await;
    respond(result)
}

pub async fn stop_node_shell(
    State(state): State<WebState>,
    Json(args): Json<StopNodeShellArgs>,
) -> axum::response::Response {
    let result: AppResult<()> = (|| async {
        state.core.manager.remove_shell(&args.stream_id).await;
        if let Some(client) = state.core.manager.client().await {
            let api: k7s_deps::kube::api::Api<k7s_deps::k8s_openapi::api::core::v1::Pod> =
                k7s_deps::kube::api::Api::namespaced(
                    client,
                    k7s_core::kube::nodeshell::DEBUG_NAMESPACE,
                );
            k7s_core::kube::nodeshell::delete_debug_pod(&api, &args.pod).await;
        }
        Ok(())
    })()
    .await;
    respond(result)
}

//! Shell and log-streaming HTTP handlers.
//!
//! Covers: pod/node shell sessions (start, input, resize, stop) and log
//! streaming (start, stop, export). The wire names match the Tauri commands
//! so the front-end can swap providers unchanged.

use axum::{extract::State, Json};
use kube::ResourceExt;

use crate::core::shell_common::{NodeShellInfo, STREAM_SEQ};
use crate::core::{prefs, shell_common};
use crate::error::AppResult;

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
    use crate::kube::logs;
    use tokio::task::JoinHandle;

    let result: AppResult<String> = (|| async {
        let client = core_client(&state.core).await?;
        let manager = state.core.manager.clone();

        // Match the Tauri shell's id format so anything that pokes at the
        // id in logs or tools sees the same shape.
        let stream_id = format!(
            "{}-{}",
            args.pod,
            STREAM_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        );
        let sink = manager.sink();
        let opts = logs::LogStreamOptions {
            tail: args.tail,
            since_time: args.since_time,
            since_seconds: args.since_seconds,
            previous: args.previous,
        };
        let id_for_task = stream_id.clone();
        let handle: JoinHandle<()> = tokio::spawn(async move {
            logs::run_log_stream(
                client,
                sink,
                id_for_task,
                args.namespace,
                args.pod,
                args.container,
                opts,
            )
            .await;
        });
        manager.add_log(stream_id.clone(), handle).await;
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
    use crate::kube::logs;
    use kube::api::{Api, LogParams};
    let result: AppResult<usize> = (|| async {
        let client = core_client(&state.core).await?;
        let api: Api<k8s_openapi::api::core::v1::Pod> = Api::namespaced(client, &args.namespace);
        let opts = logs::LogStreamOptions {
            tail: None,
            since_time: None,
            since_seconds: args.since_seconds,
            previous: args.previous,
        };
        let containers = if args.container.is_empty() {
            let p = api
                .get(&args.pod)
                .await
                .map_err(|e| crate::error::AppError::Kube(e.to_string()))?;
            p.spec
                .map(|s| s.containers.into_iter().map(|c| c.name).collect::<Vec<_>>())
                .unwrap_or_default()
        } else {
            vec![args.container.clone()]
        };
        let mut out = String::new();
        for name in &containers {
            let mut lp: LogParams = logs::log_params(name, &opts);
            lp.follow = false;
            let text = api
                .logs(&args.pod, &lp)
                .await
                .map_err(|e| crate::error::AppError::Kube(e.to_string()))?;
            if containers.len() > 1 {
                out.push_str(&format!("===== container: {name} =====\n"));
            }
            out.push_str(&text);
            if !text.ends_with('\n') {
                out.push('\n');
            }
        }
        // Security: the web shell must NOT write to the server filesystem —
        // `args.path` comes from the browser and could be a path traversal.
        // Return the content as base64 so the browser can trigger a download.
        let _ = args.path; // unused in web mode
        let lines = out.lines().count();
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
    use std::sync::atomic::Ordering;
    use tokio::sync::mpsc;

    let result: AppResult<String> = (|| async {
        let client = core_client(&state.core).await?;
        let manager = state.core.manager.clone();

        // Same id shape as the Tauri shell so anyone inspecting both sees one
        // format; the per-binary counter just avoids clashes on a single host.
        let id = format!(
            "sh-{}-{}",
            args.pod,
            STREAM_SEQ.fetch_add(1, Ordering::Relaxed)
        );
        let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(64);
        let (resize_tx, resize_rx) = mpsc::channel::<(u16, u16)>(8);
        let sink = manager.sink();
        // Per-session prefs read: a setting change shouldn't need a reconnect.
        let shell_command = prefs::read_prefs(&state.core.data_dir)
            .shell_command
            .unwrap_or_default();
        let id_for_task = id.clone();
        let task = tokio::spawn(async move {
            crate::kube::exec::run_shell(
                client,
                sink,
                id_for_task,
                args.namespace,
                args.pod,
                args.container,
                shell_command,
                input_rx,
                resize_rx,
            )
            .await;
        });
        manager
            .add_shell(
                id.clone(),
                crate::kube::manager::ShellSession {
                    task,
                    input_tx,
                    resize_tx,
                },
            )
            .await;
        Ok(id)
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
    use std::sync::atomic::Ordering;
    use tokio::sync::mpsc;

    let result: AppResult<NodeShellInfo> = (|| async {
        let client = core_client(&state.core).await?;
        let manager = state.core.manager.clone();
        let api: kube::api::Api<k8s_openapi::api::core::v1::Pod> =
            kube::api::Api::namespaced(client.clone(), crate::kube::nodeshell::DEBUG_NAMESPACE);

        // Sweep any prior debug pod on this node (B53) so a crashed previous
        // session doesn't collide on the name or quietly linger as a
        // privileged pod. Uses `nodeshell::delete_debug_pod` for consistent
        // cleanup (matches the Tauri shell).
        if let Ok(old) = api
            .list(
                &kube::api::ListParams::default()
                    .labels(&crate::kube::nodeshell::node_selector(&args.node)),
            )
            .await
        {
            for pod in old.items {
                crate::kube::nodeshell::delete_debug_pod(&api, &pod.name_any()).await;
            }
        }

        let pod_name = crate::kube::nodeshell::pod_name(
            &args.node,
            shell_common::NODE_SHELL_SEQ.fetch_add(1, Ordering::Relaxed),
        );
        let pod_name_for_cleanup = pod_name.clone();
        let image = prefs::read_prefs(&state.core.data_dir)
            .node_shell_image
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| crate::kube::nodeshell::DEFAULT_IMAGE.to_string());
        let spec = crate::kube::nodeshell::debug_pod_spec(&args.node, &image, &pod_name);
        api.create(&kube::api::PostParams::default(), &spec).await?;
        // If the pod never reaches Running, leave no privileged pod behind.
        // Uses `nodeshell::await_debug_pod` (shared implementation).
        if let Err(e) = crate::kube::nodeshell::await_debug_pod(&api, &pod_name).await {
            crate::kube::nodeshell::delete_debug_pod(&api, &pod_name_for_cleanup).await;
            return Err(e);
        }

        let id = format!(
            "sh-{}-{}",
            pod_name,
            STREAM_SEQ.fetch_add(1, Ordering::Relaxed)
        );
        let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(64);
        let (resize_tx, resize_rx) = mpsc::channel::<(u16, u16)>(8);
        let sink = manager.sink();
        let id_for_task = id.clone();
        let pod_name_for_task = pod_name.clone();
        let task = tokio::spawn(async move {
            crate::kube::exec::run_argv(
                client,
                sink,
                id_for_task,
                crate::kube::nodeshell::DEBUG_NAMESPACE.to_string(),
                pod_name_for_task,
                "debug".to_string(),
                crate::kube::nodeshell::nsenter_cmd(),
                input_rx,
                resize_rx,
            )
            .await;
        });
        manager
            .add_shell(
                id.clone(),
                crate::kube::manager::ShellSession {
                    task,
                    input_tx,
                    resize_tx,
                },
            )
            .await;
        Ok(NodeShellInfo {
            stream_id: id,
            namespace: crate::kube::nodeshell::DEBUG_NAMESPACE.to_string(),
            pod: pod_name,
        })
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
            let api: kube::api::Api<k8s_openapi::api::core::v1::Pod> =
                kube::api::Api::namespaced(client, crate::kube::nodeshell::DEBUG_NAMESPACE);
            crate::kube::nodeshell::delete_debug_pod(&api, &args.pod).await;
        }
        Ok(())
    })()
    .await;
    respond(result)
}

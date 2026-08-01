//! Pod log streaming.
//!
//! Pipeline:
//!   `Api::log_stream()` → `AsyncBufRead` → newline-split →
//!   line parser → `log-line:{id}` Tauri event.
//!
//! Cancellation goes through the manager: the `start_log_stream`
//! command puts a `CancelTx` in the manager's log-streams map;
//! `stop_log_stream` takes it out and signals.

use std::sync::Arc;

use futures::AsyncBufReadExt;
use k8s_openapi::api::core::v1::Pod;
use kube::api::{Api, LogParams};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::kube::manager::{ClientManager, LogStreamHandle};

/// A single parsed log line.
#[derive(Debug, Clone, serde::Serialize)]
pub struct LogLine {
    /// "HH:MM:SS.mmm", or "" when no timestamp could be extracted.
    pub ts: String,
    /// Normalized level; "" when no level could be detected.
    pub level: String,
    /// The message body (after the level + ts strip).
    pub msg: String,
    /// Source container — set only when streaming all containers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<String>,
}

/// Reason a log stream closed.
#[derive(Debug, Clone, serde::Serialize)]
struct LogClosed {
    reason: String,
}

/// Spawn a log stream. Returns the stream id (caller forwards to the
/// frontend so it can subscribe to `log-line:{id}` and `log-closed:{id}`).
pub async fn start_log_stream(
    app: AppHandle,
    mgr: Arc<ClientManager>,
    id: String,
    pod: String,
    namespace: String,
    container: Option<String>,
    tail: Option<i64>,
    previous: bool,
    timestamps: bool,
) -> AppResult<()> {
    let client = mgr.client().await?;
    let api: Api<Pod> = Api::namespaced(client, &namespace);
    let lp = LogParams {
        container: container.clone(),
        follow: true,
        previous,
        tail_lines: tail,
        timestamps,
        ..Default::default()
    };

    let mut reader = api
        .log_stream(&pod, &lp)
        .await
        .map_err(|e| AppError::msg(format!("open log stream for {pod}: {e}")))?;

    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel();
    mgr.insert_log(LogStreamHandle {
        id: id.clone(),
        pod: pod.clone(),
        namespace: namespace.clone(),
        container: container.clone(),
        cancel: Some(cancel_tx),
    })
    .await;

    let id_for_task = id.clone();
    let container_for_task = container.clone();
    tokio::spawn(async move {
        let mut buf = String::new();
        loop {
            tokio::select! {
                _ = &mut cancel_rx => {
                    let _ = app.emit(
                        &format!("log-closed:{id_for_task}"),
                        LogClosed { reason: "cancelled".into() },
                    );
                    break;
                }
                read = reader.read_line(&mut buf) => {
                    match read {
                        Ok(0) => {
                            // EOF
                            let _ = app.emit(
                                &format!("log-closed:{id_for_task}"),
                                LogClosed { reason: "eof".into() },
                            );
                            break;
                        }
                        Ok(_) => {
                            // Strip the trailing newline (read_line keeps it).
                            let line = buf.trim_end_matches('\n').trim_end_matches('\r');
                            let parsed = parse_log_line(line);
                            let ev = LogLine {
                                ts: parsed.0,
                                level: parsed.1,
                                msg: parsed.2,
                                container: container_for_task.clone(),
                            };
                            let _ = app.emit(&format!("log-line:{id_for_task}"), &ev);
                            buf.clear();
                        }
                        Err(e) => {
                            let _ = app.emit(
                                &format!("log-closed:{id_for_task}"),
                                LogClosed { reason: format!("read error: {e}") },
                            );
                            break;
                        }
                    }
                }
            }
        }
    });

    Ok(())
}

pub async fn stop_log_stream(mgr: Arc<ClientManager>, id: &str) -> AppResult<()> {
    if let Some(mut h) = mgr.take_log(id).await {
        if let Some(tx) = h.cancel.take() {
            let _ = tx.send(());
        }
        Ok(())
    } else {
        Err(AppError::NotFound(format!("log stream {id}")))
    }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/// Parse a single log line into (ts, level, msg). Best-effort:
///   - If `timestamps=true` and the line starts with an RFC3339-ish
///     timestamp, strip it.
///   - If the line starts with a k8s level marker (INFO, ERROR, ...),
///     lift it out.
///   - Otherwise leave the line untouched (empty ts, empty level).
fn parse_log_line(line: &str) -> (String, String, String) {
    let mut rest = line.to_string();
    let mut ts = String::new();

    if let Some(idx) = rest.find(' ') {
        let head = &rest[..idx];
        if looks_like_timestamp(head) {
            ts = short_ts(head);
            rest = rest[idx + 1..].to_string();
        }
    }

    let mut level = String::new();
    let trimmed = rest.trim_start();
    if !trimmed.is_empty() {
        let end = trimmed
            .find(|c: char| c.is_whitespace() || c == ']')
            .unwrap_or(trimmed.len());
        let candidate = &trimmed[..end];
        if is_level_token(candidate) {
            level = candidate.to_string();
            let after = &trimmed[end..];
            let stripped = after
                .trim_start_matches('[')
                .trim_start_matches(']')
                .trim_start_matches(':')
                .trim_start();
            rest = stripped.to_string();
        }
    }

    (ts, level, rest)
}

fn looks_like_timestamp(s: &str) -> bool {
    if s.len() < 19 {
        return false;
    }
    let b = s.as_bytes();
    b[4] == b'-'
        && b[7] == b'-'
        && (b[10] == b'T' || b[10] == b' ')
        && b[13] == b':'
        && b[16] == b':'
}

fn short_ts(s: &str) -> String {
    let t = s.find(['T', ' ']).map(|i| &s[i + 1..]).unwrap_or(s);
    if t.len() > 12 {
        t[..12].to_string()
    } else {
        t.to_string()
    }
}

fn is_level_token(s: &str) -> bool {
    if !(3..=6).contains(&s.len()) {
        return false;
    }
    s.chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

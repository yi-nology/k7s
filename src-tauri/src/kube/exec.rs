//! Container exec — both one-shot (`exec_pod`) and interactive shell.
//!
//! ## One-shot
//!
//! `exec_pod` runs a single command and returns stdout/stderr/exit_code.
//! Implemented via `kubectl exec` because that's the only fully-reliable
//! way to read exit codes; kube-rs's `AttachedProcess` is geared at
//! streaming rather than one-shot.
//!
//! ## Interactive shell (P4)
//!
//! `start_shell` opens a `kube::api::AttachedProcess` with `tty=true`,
//! `stdin=true`, `stdout=true`, `stderr=false`. We then:
//!   - read bytes from `stdout` and emit them as `shell-chunk:{id}`
//!     events (Tauri pushes the chunks to the React xterm.js renderer),
//!   - forward bytes received on a `mpsc` channel from the UI to the
//!     process's stdin writer,
//!   - forward terminal resize from a `mpsc` channel to the
//!     process's resize sender.
//!
//! The `CancelTx` from the manager aborts the underlying task on stop.

use std::sync::Arc;

use futures::channel::mpsc as futures_mpsc;
use futures::SinkExt;
use k8s_openapi::api::core::v1::Pod;
use kube::api::{Api, AttachParams};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Notify;

use crate::error::{AppError, AppResult};
use crate::kube::manager::{ClientManager, ShellHandle};

/// A one-shot exec result.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u128,
}

// ---------------------------------------------------------------------------
// One-shot exec — keep the kubectl subprocess path. It's simpler and
// gives us a clean exit code; AttachedProcess is for streaming.
// ---------------------------------------------------------------------------

pub async fn exec_pod(
    _mgr: Arc<ClientManager>,
    name: String,
    namespace: String,
    _container: Option<String>,
    command: Vec<String>,
) -> AppResult<ExecResult> {
    if command.is_empty() {
        return Err(AppError::Invalid(
            "exec_pod: command must not be empty".into(),
        ));
    }

    let ctx = _mgr.current_context().await.unwrap_or_default();

    let mut args: Vec<String> = vec!["exec".into(), name, "-n".into(), namespace];
    if !ctx.is_empty() {
        args.push("--context".into());
        args.push(ctx);
    }
    args.push("--".into());
    for c in &command {
        args.push(c.clone());
    }

    let start = std::time::Instant::now();
    let output = tokio::process::Command::new("kubectl")
        .args(&args)
        .output()
        .await
        .map_err(|e| {
            AppError::msg(format!("kubectl not in PATH or failed to spawn: {e}"))
        })?;
    Ok(ExecResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
        duration_ms: start.elapsed().as_millis(),
    })
}

// ---------------------------------------------------------------------------
// Interactive shell
// ---------------------------------------------------------------------------

/// Reason a shell session ended.
#[derive(Debug, Clone, serde::Serialize)]
struct ShellClosed {
    reason: String,
    /// "Success" or "Failure" — k8s Status.status, not a numeric exit
    /// code. (TTY exec doesn't surface a real exit code via the
    /// websocket protocol.)
    status: String,
}

/// A single output chunk from the shell. The frontend's xterm.js
/// renderer treats this as raw bytes (it understands ANSI escapes
/// on its own).
#[derive(Debug, Clone, serde::Serialize)]
struct ShellChunk {
    /// Base64-encoded raw bytes.
    data: String,
}

/// Spawn an interactive shell session. Returns nothing — the caller
/// already generated the id. The shell id is the lookup key the UI
/// uses to subscribe to events and to send input/resize.
pub async fn start_shell(
    app: AppHandle,
    mgr: Arc<ClientManager>,
    id: String,
    pod: String,
    namespace: String,
    container: Option<String>,
) -> AppResult<()> {
    let client = mgr.client().await?;
    let api: Api<Pod> = Api::namespaced(client, &namespace);

    // Build AttachParams: TTY on, stdin on, stdout on, stderr off
    // (TTY merges stderr into stdout in the kubelet protocol).
    // AttachParams: TTY on, stdin on, stdout on, stderr off
    // (TTY merges stderr into stdout in the kubelet protocol).
    // `container` is a public field — use struct-update syntax.
    let ap = AttachParams {
        container: container.clone(),
        stdin: true,
        stdout: true,
        stderr: false,
        tty: true,
        max_stdin_buf_size: None,
        max_stdout_buf_size: None,
        max_stderr_buf_size: None,
    };

    // Try /bin/sh first; fall back to /bin/bash if sh is missing.
    let mut proc = match api.exec(&pod, ["/bin/sh", "-i"], &ap).await {
        Ok(p) => p,
        Err(_) => api
            .exec(&pod, ["/bin/bash", "-i"], &ap)
            .await
            .map_err(|e| AppError::msg(format!("shell exec: {e}")))?,
    };

    // Take the streams.
    let mut stdout = proc
        .stdout()
        .ok_or_else(|| AppError::msg("shell exec: stdout not enabled"))?;
    let stdin = proc
        .stdin()
        .ok_or_else(|| AppError::msg("shell exec: stdin not enabled"))?;
    let resize_kube_tx = proc
        .terminal_size()
        .ok_or_else(|| AppError::msg("shell exec: terminal_size not available"))?;
    let status_fut = proc
        .take_status()
        .ok_or_else(|| AppError::msg("shell exec: status not available"))?;

    // Register the handle in the manager.
    //
    // `cancel` is a `Notify` (broadcast-style): a single `notify_one`
    // wakes every task that holds a clone, so both the stdout reader
    // and the status watcher can observe the same cancel signal.
    let cancel = Arc::new(Notify::new());
    let (input_tx, mut input_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
    let (resize_tx_mpsc, mut resize_rx) =
        tokio::sync::mpsc::channel::<kube_client::api::TerminalSize>(16);

    mgr.insert_shell(ShellHandle {
        id: id.clone(),
        pod: pod.clone(),
        namespace: namespace.clone(),
        container: container.unwrap_or_default(),
        cancel: Some(cancel.clone()),
        stdin_tx: input_tx,
        resize_tx: resize_tx_mpsc,
    })
    .await;

    // ---- stdin forwarder ----
    // input_rx → stdin writer
    let stdin_task = tokio::spawn(async move {
        let mut stdin = stdin;
        while let Some(data) = input_rx.recv().await {
            if stdin.write_all(&data).await.is_err() {
                break;
            }
            let _ = stdin.flush().await;
        }
    });

    // ---- resize forwarder ----
    // resize_rx → kubelet resize sender (futures mpsc, unbounded, try_send)
    let mut resize_kube_tx = resize_kube_tx;
    let resize_task = tokio::spawn(async move {
        while let Some(size) = resize_rx.recv().await {
            if resize_kube_tx.send(size).await.is_err() {
                break;
            }
        }
    });

    // ---- stdout reader ----
    let id_for_emit = id.clone();
    let app_for_emit = app.clone();
    let cancel_stdout = cancel.clone();
    let stdout_task = tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            let read = tokio::select! {
                _ = cancel_stdout.notified() => return,
                read = stdout.read(&mut buf) => read,
            };
            match read {
                Ok(0) => break,
                Ok(n) => {
                    let b64 = base64_encode(&buf[..n]);
                    let _ = app_for_emit.emit(
                        &format!("shell-chunk:{id_for_emit}"),
                        ShellChunk { data: b64 },
                    );
                }
                Err(_) => break,
            }
        }
    });

    // ---- status watcher ----
    let id_for_status = id.clone();
    let app_for_status = app.clone();
    let status_task = tokio::spawn(async move {
        let mut status_fut = status_fut;
        let status_str: String = tokio::select! {
            _ = cancel.notified() => "Cancelled".into(),
            res = &mut status_fut => {
                match res {
                    Some(s) => s.status.unwrap_or_else(|| "Unknown".into()),
                    None => "Closed".into(),
                }
            }
        };
        let _ = app_for_status.emit(
            &format!("shell-closed:{id_for_status}"),
            ShellClosed {
                reason: "exit".into(),
                status: status_str,
            },
        );
    });

    // Tasks are detached; they self-clean when cancel fires or the
    // process ends. The AttachedProcess stays alive via the still-
    // pending futures we hold in the spawn tasks.
    let _ = (stdin_task, resize_task, stdout_task, status_task);

    Ok(())
}

/// Stop a shell session by id. The notify wakes the loops.
pub async fn stop_shell(mgr: Arc<ClientManager>, id: &str) -> AppResult<()> {
    if let Some(mut h) = mgr.take_shell(id).await {
        if let Some(notify) = h.cancel.take() {
            notify.notify_one();
        }
        Ok(())
    } else {
        Err(AppError::NotFound(format!("shell {id}")))
    }
}

/// Send raw bytes (typed by the user) to a shell's stdin.
pub async fn shell_input(
    mgr: Arc<ClientManager>,
    id: &str,
    data: Vec<u8>,
) -> AppResult<()> {
    let (stdin_tx, _) = mgr
        .get_shell_io(id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("shell {id}")))?;
    stdin_tx
        .send(data)
        .await
        .map_err(|_| AppError::msg("shell stdin closed"))?;
    Ok(())
}

/// Resize the terminal.
pub async fn shell_resize(
    mgr: Arc<ClientManager>,
    id: &str,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    let (_, resize_tx) = mgr
        .get_shell_io(id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("shell {id}")))?;
    resize_tx
        .send(kube_client::api::TerminalSize { width: cols, height: rows })
        .await
        .map_err(|_| AppError::msg("shell resize channel closed"))?;
    Ok(())
}

// Small base64 helper — no need to pull in a crate for the encode side.
fn base64_encode(input: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(input)
}

// Tiny shim to keep imports tidy: futures_mpsc is needed for the
// type alias but SinkExt covers the send() call.
#[allow(unused_imports)]
use futures_mpsc as _mpsc;

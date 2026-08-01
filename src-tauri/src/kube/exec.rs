//! Container exec — placeholder.
//!
//! Will be filled in P4 (shell + port-forward phase). For now this
//! is a thin pass-through to `kubectl exec` so the existing call
//! sites keep working.

use crate::error::AppResult;
use crate::kube::manager::ClientManager;
use std::sync::Arc;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u128,
}

pub async fn exec_pod(
    _mgr: Arc<ClientManager>,
    name: String,
    namespace: String,
    _container: Option<String>,
    command: Vec<String>,
) -> AppResult<ExecResult> {
    if command.is_empty() {
        return Err(crate::error::AppError::Invalid(
            "exec_pod: command must not be empty".into(),
        ));
    }

    // Use the active context so kubectl talks to the right cluster.
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
            crate::error::AppError::msg(format!(
                "kubectl not in PATH or failed to spawn: {e}"
            ))
        })?;
    Ok(ExecResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
        duration_ms: start.elapsed().as_millis(),
    })
}

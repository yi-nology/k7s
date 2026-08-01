//! Kubeconfig context commands: list, import.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::kube::dto::ContextInfo;
use crate::kube::manager::ClientManager;

/// Read `~/.kube/config` (or `$KUBECONFIG`) and return its contexts.
#[tauri::command]
pub async fn list_contexts() -> AppResult<Vec<ContextInfo>> {
    let kc = crate::kube::load_kubeconfig()
        .map_err(|e| AppError::Kubeconfig(format!("{e:#}")))?;
    Ok(crate::kube::summarize_contexts(&kc))
}

/// Read a user-supplied kubeconfig file and merge its contexts in.
/// Returns the merged list (existing + imported) and the path the
/// file was imported from.
#[derive(Debug, serde::Serialize)]
pub struct ImportResult {
    pub contexts: Vec<ContextInfo>,
    pub path: String,
}

#[tauri::command]
pub async fn import_kubeconfig(path: String) -> AppResult<ImportResult> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(AppError::NotFound(format!("kubeconfig at {path}")));
    }
    let imported = crate::kube::load_kubeconfig_from(&p)
        .map_err(|e| AppError::Kubeconfig(format!("{e:#}")))?;
    let existing = crate::kube::load_kubeconfig()
        .map_err(|e| AppError::Kubeconfig(format!("{e:#}")))?;
    let mut merged: Vec<ContextInfo> = crate::kube::summarize_contexts(&existing);
    for ctx in crate::kube::summarize_contexts(&imported) {
        if !merged.iter().any(|c| c.name == ctx.name) {
            merged.push(ctx);
        }
    }
    merged.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(ImportResult {
        contexts: merged,
        path,
    })
}

/// Currently-selected context name. The state lives in `ClientManager`
/// (set by `connect`).
#[tauri::command]
pub async fn current_context(mgr: State<'_, Arc<ClientManager>>) -> AppResult<Option<String>> {
    Ok(mgr.current_context().await)
}

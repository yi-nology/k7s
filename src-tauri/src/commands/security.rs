//! Security audit commands: RBAC analysis and vulnerability scanning.

use crate::commands::core::require_client;
use crate::core::CoreState;
use crate::error::AppResult;
use crate::kube::security_audit;
use std::sync::Arc;
use tauri::State;

/// Run an RBAC security audit on the connected cluster.
#[tauri::command]
pub async fn security_audit_run(
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<security_audit::AuditReport> {
    let client = require_client(&mgr.manager).await?;
    security_audit::run_audit(client).await
}

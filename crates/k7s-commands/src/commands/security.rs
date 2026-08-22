// Security audit commands: RBAC analysis, vulnerability scanning, and permission matrix.

use crate::commands::core::require_client;
use k7s_core::core::CoreState;
use k7s_core::error::AppResult;
use k7s_core::kube::{rbac_matrix, security_audit};
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

/// Build the RBAC permission matrix: who can do what on which resources.
#[tauri::command]
pub async fn rbac_permission_matrix(
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<rbac_matrix::PermissionMatrix> {
    let client = require_client(&mgr.manager).await?;
    rbac_matrix::build_rbac_matrix(client).await
}

//! Events commands — list Kubernetes events for a kind/namespace scope.

use std::sync::Arc;

use k8s_openapi::api::core::v1::Event;
use kube::api::{Api, ListParams};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::kube::dto::Row;
use crate::kube::mappers;
use crate::kube::manager::ClientManager;

#[tauri::command]
pub async fn list_events(
    namespace: Option<String>,
    mgr: State<'_, Arc<ClientManager>>,
) -> AppResult<Vec<Row>> {
    let client = mgr.client().await?;
    let api: Api<Event> = match namespace.as_deref() {
        Some(ns) => Api::namespaced(client, ns),
        None => Api::all(client),
    };
    let list = api
        .list(&ListParams::default())
        .await
        .map_err(|e| AppError::msg(format!("list events: {e}")))?;
    // Newest first.
    let mut rows: Vec<Row> = list.iter().map(mappers::event_to_row).collect();
    rows.sort_by(|a, b| {
        let ta = a.cells.last().and_then(|c| c.sort).unwrap_or(0.0);
        let tb = b.cells.last().and_then(|c| c.sort).unwrap_or(0.0);
        tb.partial_cmp(&ta).unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(rows)
}

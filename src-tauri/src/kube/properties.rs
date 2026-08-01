//! Properties gatherer — placeholder.
//!
//! Filled in P2 (detail panel phase). Will return a generic section
//! document that the frontend renders without per-kind code.

use crate::error::AppResult;
use crate::kube::dto::ResourceSnapshot;
use std::sync::Arc;
use crate::kube::manager::ClientManager;

pub async fn get_properties(
    _mgr: Arc<ClientManager>,
    _kind: &str,
    _namespace: Option<&str>,
    _name: &str,
) -> AppResult<ResourceSnapshot> {
    // P0 stub — properties land in P2.
    Ok(ResourceSnapshot {
        kind: "properties".into(),
        rows: Vec::new(),
    })
}

//! metrics.k8s.io client — placeholder.
//!
//! Filled in P6 (Prometheus + advanced metrics phase).

use crate::error::AppResult;
use std::sync::Arc;
use crate::kube::manager::ClientManager;

pub async fn poll_metrics(
    _mgr: Arc<ClientManager>,
) -> AppResult<Option<crate::kube::dto::ClusterStatus>> {
    Ok(None)
}

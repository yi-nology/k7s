//! CRD discovery — placeholder.
//!
//! Will be filled in P6 (CRD discovery phase).

use crate::error::AppResult;
use crate::kube::dto::ResourceSnapshot;

pub async fn discover_crds(_client: &kube::Client) -> AppResult<Vec<ResourceSnapshot>> {
    Ok(Vec::new())
}

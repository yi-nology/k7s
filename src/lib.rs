//! k7s-core — transport-agnostic Kubernetes business logic.

pub mod ai;
pub mod core;
pub mod error;
pub mod kube;

pub use error::{AppError, AppResult};

// Re-export k7s-deps for shared dependencies
pub use k7s_deps;

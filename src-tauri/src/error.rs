//! Unified error type for the k7s backend.
//!
//! Everything that crosses the Tauri command boundary funnels through
//! `AppError`, so the frontend can show a single, consistent error message
//! (with the underlying cause chain) instead of "stringly typed" surprises.
//!
//! Rules of thumb:
//!   - Wrap anything from `kube`, `k8s_openapi`, `serde_yaml`, etc. with
//!     `AppError::from` (the `From` impl handles the conversion).
//!   - For domain errors, add a new variant rather than smuggling strings.
//!   - The `Display` impl is what the frontend sees — keep it short and useful.

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("kubeconfig error: {0}")]
    Kubeconfig(String),

    #[error("kubernetes API error: {0}")]
    Kube(#[from] kube_client::Error),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_yaml::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid argument: {0}")]
    Invalid(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("forbidden: {0}")]
    Forbidden(String),

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("not connected to a cluster")]
    NotConnected,

    #[error("operation cancelled")]
    Cancelled,

    #[error("{0}")]
    Other(String),
}

impl AppError {
    /// Build a generic error from a `Display` value.
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Other(s.into())
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Other(format!("{e:#}"))
    }
}

/// Tauri commands return `Result<T, AppError>`. The frontend sees a string
/// (Tauri's default for `serde::Serialize` of an `Error` type). We wrap the
/// error in a structured shape so callers can introspect cause if needed,
/// while keeping the surface stable.
#[derive(Debug, Serialize)]
pub struct AppErrorDto {
    pub message: String,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        AppErrorDto {
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

/// Convenience alias used throughout the backend.
pub type AppResult<T> = std::result::Result<T, AppError>;

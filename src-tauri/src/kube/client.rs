//! `kube::Client` construction from a kubeconfig context.
//!
//! This is the only place that touches `Kubeconfig::read` /
//! `Config::from_custom_kubeconfig`. Everything else goes through
//! `ClientManager`.
//!
//! Kept thin on purpose: it answers one question — "give me a client for
//! context X". It does not manage the lifetime (that's `manager.rs`).

use std::path::Path;

use anyhow::{Context, Result};
use kube::config::Kubeconfig;
use serde::Serialize;

use super::dto;

/// What we tell the UI about each context in `~/.kube/config`.
#[derive(Debug, Clone, Serialize)]
pub struct ContextInfo {
    pub name: String,
    pub cluster: String,
    pub user: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    pub is_current: bool,
}

/// Read and parse the default kubeconfig (`~/.kube/config` or `KUBECONFIG`).
pub fn load_kubeconfig() -> Result<Kubeconfig> {
    Kubeconfig::read().context("failed to read kubeconfig")
}

/// Variant that also accepts an explicit path, for "import kubeconfig".
pub fn load_kubeconfig_from(path: &Path) -> Result<Kubeconfig> {
    Kubeconfig::from_yaml(
        &std::fs::read_to_string(path)
            .with_context(|| format!("failed to read {}", path.display()))?,
    )
    .with_context(|| format!("failed to parse {}", path.display()))
}

/// Convert a parsed kubeconfig into UI-friendly `ContextInfo`s.
pub fn summarize_contexts(kc: &Kubeconfig) -> Vec<dto::ContextInfo> {
    let current = kc.current_context.clone();
    let mut out: Vec<dto::ContextInfo> = kc
        .contexts
        .iter()
        .map(|ctx| {
            let (cluster, user, namespace) = match ctx.context.as_ref() {
                Some(c) => (
                    c.cluster.clone(),
                    c.user.clone().unwrap_or_default(),
                    c.namespace.clone(),
                ),
                None => (String::new(), String::new(), None),
            };
            dto::ContextInfo {
                name: ctx.name.clone(),
                cluster,
                user,
                namespace,
                is_current: current.as_deref() == Some(ctx.name.as_str()),
            }
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Build a `kube::Client` for a given context. If `context` is `None`,
/// falls back to the default kubeconfig selection (or in-cluster config).
pub async fn client_for_context(context: Option<&str>) -> Result<kube::Client> {
    let mut kc = load_kubeconfig()?;
    if let Some(name) = context {
        kc.current_context = Some(name.to_string());
    }
    let config = kube::Config::from_custom_kubeconfig(kc, &Default::default())
        .await
        .context("failed to build kube config")?;
    kube::Client::try_from(config).context("failed to construct kube client")
}

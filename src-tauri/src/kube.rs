//! Kubernetes client + kubeconfig helpers.

use anyhow::{Context, Result};
use kube::config::Kubeconfig;
use serde::Serialize;

/// Lightweight description of a kubeconfig context for the UI.
#[derive(Debug, Clone, Serialize)]
pub struct ContextInfo {
    pub name: String,
    pub cluster: String,
    pub user: String,
    pub namespace: Option<String>,
    pub is_current: bool,
}

/// Load and parse the default kubeconfig (`~/.kube/config` or `KUBECONFIG`).
pub fn load_kubeconfig() -> Result<Kubeconfig> {
    Kubeconfig::read().context("failed to read kubeconfig")
}

/// Convert a parsed kubeconfig into UI-friendly `ContextInfo`s.
pub fn summarize_contexts(kc: &Kubeconfig) -> Vec<ContextInfo> {
    let current = kc.current_context.clone();
    let mut out: Vec<ContextInfo> = kc
        .contexts
        .iter()
        .map(|ctx| {
            // NamedContext shape varies between kube versions; this destructuring
            // accommodates both `String` and `Option<String>` for the optional fields.
            let (cluster, user, namespace) = match ctx.context.as_ref() {
                Some(c) => {
                    let cluster = c.cluster.clone();
                    let user = c.user.clone();
                    let namespace = c.namespace.clone();
                    // If user is Option<String>, unwrap or use empty; if it's String, keep it.
                    let user = match user {
                        Some(u) => u,
                        None => String::new(),
                    };
                    (cluster, user, namespace)
                }
                None => (String::new(), String::new(), None),
            };
            ContextInfo {
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

/// Build a `kube::Client` for a given context name. If `context` is `None`,
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

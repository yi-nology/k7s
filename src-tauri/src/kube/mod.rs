//! Kubernetes client + resource management.
//!
//! Split into focused submodules, each owning a single concern:
//!
//!   - [`client`]    — `kube::Client` construction from a context name
//!   - [`dto`]       — wire types shared with the React frontend
//!   - [`mappers`]   — `k8s_openapi` → DTO conversion (the "semantic" layer)
//!   - [`manager`]   — `ClientManager`: active client + connection-scoped state
//!   - [`watchers`]  — reflector framework; per-kind watchers
//!   - [`logs`]      — pod log streaming + line parsing
//!   - [`exec`]      — container exec (kubectl subproc, by design)
//!   - [`portforward`] — TCP forwarder (pods + services)
//!   - [`properties`]  — "what is this wired to" gatherer
//!   - [`metrics`]   — metrics.k8s.io client
//!   - [`discovery`] — CRD discovery
//!   - [`helm`]      — Helm release Secret decoder
//!
//! A read of [`mappers`] is the easiest way to see how the data flows:
//!   `k8s_openapi::Pod` → `pod_to_row(&Pod) -> Row` (in [`mappers`])
//!                                          → `ResourceSnapshot` (in [`dto`])
//!                                          → `tauri::Emitter::emit("resource-update", ...)` (in [`manager`])
//!                                          → React `onResourceUpdate` (in `src/providers/tauri/TauriProvider.ts`)
//!                                          → Zustand store (in `src/store/useStore.ts`)
//!                                          → `<ResourceTable rows={...} />`

pub mod client;
pub mod discovery;
pub mod dto;
pub mod exec;
pub mod logs;
pub mod manager;
pub mod mappers;
pub mod metrics;
pub mod portforward;
pub mod properties;
pub mod watchers;

pub use client::{client_for_context, load_kubeconfig, load_kubeconfig_from, summarize_contexts};
pub use dto::*;
pub use manager::ClientManager;

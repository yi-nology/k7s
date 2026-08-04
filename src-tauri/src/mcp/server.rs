//! The MCP server itself.
//!
//! One struct (`K7sMcpServer`) that holds an `Arc<ClientManager>` and exposes
//! the same Kubernetes plumbing the desktop/web shells use, but as a set of
//! MCP `#[tool]` methods. The macros (`#[tool_router]` / `#[tool_handler]`)
//! generate the JSON schema for inputs and wire each method into the tool
//! dispatch table.
//!
//! Tool method implementations are split across domain-specific files
//! included via `include!`:
//! - `connection.rs` -- list_contexts, connect, disconnect, status
//! - `read_tools.rs` -- list/get/describe resources, events, logs
//! - `write_tools.rs` -- apply, delete, scale, cordon, restart, drain
//! - `shell_tools.rs` -- shells, port-forwards, exec, pod files, convenience getters
//! - `helm_tools.rs` -- Helm install/upgrade/uninstall/rollback, repo management
//! - `monitoring_tools.rs` -- Prometheus, AlertManager, Grafana, image registry,
//!   image sync, diagnostics, and enhanced AI integration tools

use std::sync::Arc;

use k8s_openapi::api::core::v1::Pod;
use kube::api::{Api, DeleteParams, DynamicObject, ListParams, Patch, PatchParams, PostParams};
use kube::{Client, ResourceExt};
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, Content, ErrorData as McpError, ServerCapabilities, ServerInfo};
use rmcp::{tool, tool_handler, tool_router, ServiceExt};
use serde::Serialize;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::core::events::mcp_sink;
use crate::core::CoreState;
use crate::error::AppError;
use crate::kube::{
    alerting, client as kube_client, drain, endpoints, grafana, helm_market, helm_ops,
    image_archive, image_sync, imagerepo,
    manager::{ClientManager, ForwardDto, ImportedContext, ShellSession},
    metrics_config, nodeshell, pod_files, portforward, restart, saved_queries, templates,
    ResourceKind,
};
use crate::mcp::kube_api;
use rmcp::transport::stdio;

// Parameter structs and helpers are in sibling modules.
use super::helpers::*;
use super::params::*;

// ---------------------------------------------------------------------------
// Server struct
// ---------------------------------------------------------------------------

/// The MCP server. Cloning is cheap: it holds an `Arc<CoreState>` (which
/// wraps an `Arc<ClientManager>`) and a `ToolRouter` (the rmcp-side dispatch
/// table the `#[tool_router]` macro builds).
#[derive(Clone)]
pub struct K7sMcpServer {
    core: Arc<CoreState>,
    /// The `#[tool_router]` macro generates `Self::tool_router()` that
    /// returns a fully populated `ToolRouter<Self>`; we cache it here so
    /// every method call hits the same instance.
    tool_router: ToolRouter<Self>,
}

impl K7sMcpServer {
    /// Build a fresh server. `data_dir` is a small writable scratch dir the
    /// server uses to stash future persistent prefs (currently unused -- the
    /// MCP shell has no Settings dialog to read them from).
    pub fn new(data_dir: std::path::PathBuf) -> Self {
        let manager = Arc::new(ClientManager::new(mcp_sink()));
        // `CoreState::new` already returns `Arc<Self>` -- wrap once, not twice.
        let core = CoreState::new(manager, data_dir);
        Self {
            core,
            tool_router: Self::tool_router(),
        }
    }

    /// Direct access to the manager, for the stdio loop. Tool methods go
    /// through `self.client()` and `self.manager()`.
    pub fn manager(&self) -> Arc<ClientManager> {
        self.core.manager.clone()
    }

    pub fn client(&self) -> Arc<CoreState> {
        self.core.clone()
    }
}

#[tool_router]
impl K7sMcpServer {
    // -----------------------------------------------------------------------
    // Connection tools (list_contexts, connect, disconnect, status)
    // -----------------------------------------------------------------------
    include!("connection.rs");

    // -----------------------------------------------------------------------
    // Read tools (list_resources, get_resource, describe_resource, etc.)
    // -----------------------------------------------------------------------
    include!("read_tools.rs");

    // -----------------------------------------------------------------------
    // Write tools (apply_yaml, delete, scale, cordon, restart, drain)
    // -----------------------------------------------------------------------
    include!("write_tools.rs");

    // -----------------------------------------------------------------------
    // Shell, exec, port-forward, pod files, and convenience getters
    // -----------------------------------------------------------------------
    include!("shell_tools.rs");

    // -----------------------------------------------------------------------
    // Helm operations and chart repository management
    // -----------------------------------------------------------------------
    include!("helm_tools.rs");

    // -----------------------------------------------------------------------
    // Monitoring, image registry, image sync, and AI integration tools
    // -----------------------------------------------------------------------
    include!("monitoring_tools.rs");
}

// ---------------------------------------------------------------------------
// ServerHandler -- rmcp boilerplate. `#[tool_handler]` synthesises the
// dispatch (list_tools / call_tool) from the `#[tool]` methods on the impl
// above; we just need to describe the server in `get_info`.
// ---------------------------------------------------------------------------

#[tool_handler(router = self.tool_router)]
impl rmcp::ServerHandler for K7sMcpServer {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::default();
        // The lib's CARGO_PKG_NAME is `k7s`, but a host (Claude Desktop,
        // Cursor) distinguishes MCP servers by `serverInfo.name` -- the lib
        // name would be ambiguous if a future `k7s-X` binary joined. Pin
        // it to the binary's name; the version stays sourced from the
        // lib's CARGO_PKG_VERSION so the same `cargo build` updates both
        // the CLI and the MCP server in lockstep.
        info.server_info.name = "k7s-mcp".to_string();
        info.server_info.version = env!("CARGO_PKG_VERSION").to_string();
        info.instructions = Some(
            "k7s MCP -- Kubernetes tooling for AI clients. \
             Call `list_contexts` then `connect` before any cluster operation; \
             use the built-in kind ids (pods, deployments, services, nodes, ...) \
             for the common resources, `list_custom_kinds` for CRDs, or \
             `list_api_resources` for the full kubectl-api-resources table. \
             Reads: `list_resources` / `get_resource` / `describe_resource` / \
             `get_events` / `get_logs` / `list_endpoints` / `top_pods` / \
             `top_nodes` / `rollout_status`. \
             Writes: `apply_yaml` / `dry_run_yaml` / `apply_yaml_bundle` / \
             `dry_run_yaml_bundle` / `delete_resource` / `scale_resource` / \
             `set_cordon` / `restart_pod` / `restart_rollout` / `drain_node` / \
             `trigger_cronjob`. \
             Helm: `helm_install` / `helm_upgrade` / `helm_uninstall` / \
             `helm_rollback` / `helm_history` / `helm_show_values` / \
             `helm_list_repos` / `helm_search_charts` / `helm_add_repo` / \
             `helm_remove_repo` / `helm_update_repo`. \
             Execution: `exec_command` (one-shot) or `start_shell` (interactive); \
             `start_node_shell` for a node root shell. \
             Pod files: `pod_list_files` / `pod_read_file` / `pod_write_file` / \
             `pod_download_file` / `pod_upload_file`. \
             Port-forwards: `start_port_forward` / `start_service_port_forward`. \
             Monitoring (instances configured in the UI): `prometheus_query` / \
             `prometheus_query_range` / `alertmanager_alerts` / \
             `alertmanager_silences` / `grafana_dashboard_url` / \
             `image_registry_tags` / `image_registry_manifest` / `saved_query_run`. \
             Image import (air-gapped clusters): `image_sync_status` / \
             `image_copy` (copy docker:// or docker-archive: sources into a \
             configured internal registry; requires skopeo on PATH) / \
             `image_inspect_archive`. \
             Long-lived sessions return an id you pass to the matching `stop_*` tool."
                .to_string(),
        );
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info
    }
}

// ---------------------------------------------------------------------------
// Stdio entry
// ---------------------------------------------------------------------------

/// Serve MCP over stdin/stdout. Used by the `k7s-mcp` binary.
pub async fn serve_stdio(server: K7sMcpServer) -> Result<(), Box<dyn std::error::Error>> {
    let service = server.serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}

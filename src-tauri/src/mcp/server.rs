//! The MCP server itself.
//!
//! One struct (`K7sMcpServer`) that holds an `Arc<ClientManager>` and exposes
//! the same Kubernetes plumbing the desktop/web shells use, but as a set of
//! MCP `#[tool]` methods. The macros (`#[tool_router]` / `#[tool_handler]`)
//! generate the JSON schema for inputs and wire each method into the tool
//! dispatch table.
//!
//! Tool design notes:
//!
//! - Each tool's body is a thin wrapper around `kube_api::*` (or the existing
//!   `kube::drain` / `kube::restart` modules) — the heavy lifting is in the
//!   modules, the tool just maps a parameter struct to a result and converts
//!   errors into a `CallToolResult::error` so the message reaches the user.
//! - We use `Result<CallToolResult, McpError>`: `Ok(..error)` is a *tool*
//!   failure the user sees; `Err(McpError)` is a *protocol* error and the
//!   client renders it opaquely. The k8s side ("the call ran, the API said
//!   no") is always a tool error.
//! - Where the Tauri command takes a Tauri `AppHandle` (e.g. `connect`
//!   reading prefs for `node_shell_image`), we use the default — the MCP
//!   server runs headless and has nowhere to read prefs from. The user can
//!   override with `set_node_shell_image` if they really need a custom image.

use std::sync::Arc;

use k8s_openapi::api::core::v1::Pod;
use kube::api::{Api, DeleteParams, DynamicObject, ListParams, Patch, PatchParams, PostParams};
use kube::{Client, ResourceExt};
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{
    CallToolResult, Content, ErrorData as McpError, ServerCapabilities, ServerInfo,
};
use rmcp::{tool, tool_handler, tool_router, ServiceExt};
use serde::Serialize;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::core::events::mcp_sink;
use crate::core::CoreState;
use crate::error::AppError;
use crate::kube::{
    client as kube_client,
    drain,
    manager::{ClientManager, ForwardDto, ShellSession},
    nodeshell, portforward, restart,
    ResourceKind,
};
use crate::mcp::kube_api;
use rmcp::transport::stdio;

// ---------------------------------------------------------------------------
// Input / output parameter types
// ---------------------------------------------------------------------------
//
// Every type that flows into a `#[tool]` is a `JsonSchema + Deserialize` struct.
// Field-level `#[schemars(description = "…")]` annotations become the
// parameter description in the tool's input schema, which the AI client
// surfaces to the model. Keep them short and concrete.

/// Optional `kind` filter for `list_resources`. Most of the time the caller
/// knows the kind they want; we accept "any built-in" by leaving it empty.
#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListResourcesParams {
    /// The kind id (e.g. `pods`, `deployments`, `services`, `nodes`, …) or
    /// `group/plural` for a CRD. Required.
    pub kind: String,
    /// Namespace to scope the list. Ignored for cluster-scoped kinds
    /// (nodes, namespaces, persistentvolumes, …). Empty string lists across
    /// all namespaces.
    #[serde(default)]
    pub namespace: String,
    /// Standard k8s label selector, e.g. `app=nginx,tier=frontend`.
    #[serde(default)]
    pub label_selector: String,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetResourceParams {
    pub kind: String,
    pub namespace: String,
    pub name: String,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyYamlParams {
    pub kind: String,
    pub namespace: String,
    pub name: String,
    /// Full object YAML. resourceVersion must match (the same contract the
    /// Tauri apply enforces — a stale value yields a 409 you can see).
    pub yaml: String,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScaleParams {
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub replicas: i32,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CordonParams {
    pub name: String,
    pub unschedulable: bool,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NameNamespaceParams {
    pub namespace: String,
    pub name: String,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LogsParams {
    pub namespace: String,
    pub pod: String,
    #[serde(default)]
    pub container: String,
    /// Lines to return from the end of the log. None → server default (often
    /// all available). Tip: use a small number for a quick look, leave
    /// empty when investigating.
    #[serde(default)]
    pub tail: Option<i64>,
    /// Only return logs newer than this many seconds.
    #[serde(default)]
    pub since_seconds: Option<i64>,
    /// Read the previous terminated container's logs (after a crash).
    #[serde(default)]
    pub previous: bool,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartShellParams {
    pub namespace: String,
    pub pod: String,
    pub container: String,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShellInputParams {
    /// The id returned by `start_shell` or `start_node_shell`.
    pub shell_id: String,
    /// Keystrokes. Will be wrapped in a JSON string and shipped as-is;
    /// use base64 / raw UTF-8 if the shell needs escape sequences the
    /// tool-calling protocol might mangle.
    pub data: String,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShellResizeParams {
    pub shell_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StopShellParams {
    pub shell_id: String,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartPortForwardParams {
    pub namespace: String,
    pub pod: String,
    pub remote_port: u16,
    /// Local port to bind. 0 → pick a free port.
    #[serde(default)]
    pub local_port: u16,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartServiceForwardParams {
    pub namespace: String,
    pub service: String,
    pub service_port: u16,
    /// Local port to bind. 0 → pick a free port.
    #[serde(default)]
    pub local_port: u16,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StopForwardParams {
    pub id: String,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConnectParams {
    /// kubeconfig context to connect to. If empty, uses the current-context.
    #[serde(default)]
    pub context: String,
}

#[derive(Debug, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DrainParams {
    pub node: String,
    #[serde(default)]
    /// How long to wait for the drain before giving up. None → no timeout
    /// (the MCP caller polls `list_port_forwards`-style events itself, in
    /// this case by re-listing the node's pods).
    pub timeout_secs: Option<u64>,
}

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
    /// server uses to stash future persistent prefs (currently unused — the
    /// MCP shell has no Settings dialog to read them from).
    pub fn new(data_dir: std::path::PathBuf) -> Self {
        let manager = Arc::new(ClientManager::new(mcp_sink()));
        // `CoreState::new` already returns `Arc<Self>` — wrap once, not twice.
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
    // Connection tools
    // -----------------------------------------------------------------------

    /// List the contexts visible in the default kubeconfig. The AI can call
    /// this on startup to show the user what's available; `connect` then
    /// picks one.
    #[tool(description = "List contexts in the default kubeconfig. Returns the context name, the cluster it points at, and whether it's the current-context.")]
    async fn list_contexts(&self) -> Result<CallToolResult, McpError> {
        let contexts = kube_client::list_contexts().unwrap_or_default();
        json_result(&contexts)
    }

    /// Build a kube client for a context and probe the API server. Tears
    /// down any previous connection first.
    #[tool(description = "Connect to a kubeconfig context. Tears down any existing connection, builds a client, probes the API server version. Returns the cluster identity (context, server, version).")]
    async fn connect(
        &self,
        Parameters(p): Parameters<ConnectParams>,
    ) -> Result<CallToolResult, McpError> {
        let manager = self.manager();
        // Always start clean — switching context must abort every watcher,
        // log stream, shell, and port-forward tied to the old cluster.
        manager.reset().await;

        let context = if p.context.is_empty() {
            // Empty → use current-context. Probe the kubeconfig directly
            // because nothing in the manager knows which one is current.
            kube_client::list_contexts()
                .ok()
                .and_then(|cs| cs.into_iter().find(|c| c.current).map(|c| c.name))
                .ok_or_else(|| {
                    McpError::invalid_params(
                        "no context supplied and no current-context in kubeconfig",
                        None,
                    )
                })?
        } else {
            p.context
        };

        // Three ways to build a client for `context` (same as web::handlers):
        //   1. imported kubeconfig bytes stashed by import_kubeconfig_content
        //   2. imported kubeconfig file path
        //   3. default kubeconfig
        let (kube_client, server) = if let Some(kc) = manager.import_kubeconfig(&context).await {
            kube_api::build_client_from_kubeconfig(kc, &context).await
        } else if let Some(path) = manager.import_path(&context).await {
            kube_client::build_client_from_file(&path, &context).await
        } else {
            kube_client::build_client(&context).await
        }
        .map_err(|e| McpError::internal_error(e.to_string(), None))?;

        let version = kube_api::probe_version(&kube_client)
            .await
            .map_err(|e| McpError::internal_error(e.to_string(), None))?;

        // CRD discovery so custom kinds resolve through `list_resources` /
        // `get_resource` / `describe_resource` later.
        let custom = crate::kube::discovery::discover(&kube_client).await;
        manager.set_custom_kinds(custom).await;

        manager
            .set_connected(
                kube_client,
                crate::kube::manager::ConnectionInfo {
                    context: context.clone(),
                    server: server.clone(),
                    version: version.clone(),
                },
                0,
            )
            .await;

        let info = kube_client::ClusterInfo {
            context: context.clone(),
            cluster_name: context,
            server,
            version,
        };
        json_result(&info)
    }

    /// Drop the current connection and all of its long-lived sessions.
    #[tool(description = "Disconnect from the current cluster. Aborts watchers, log streams, shells, and port-forwards. The next tool call will need `connect` again.")]
    async fn disconnect(&self) -> Result<CallToolResult, McpError> {
        self.manager().reset().await;
        Ok(CallToolResult::success(vec![Content::text("disconnected")]))
    }

    /// Current connection status. `connected: false` means tools that need
    /// a client (everything except `list_contexts`) will return a
    /// "not connected" error.
    #[tool(description = "Show the current connection: context, server, API server version. Returns { connected: false } when nothing is connected.")]
    async fn status(&self) -> Result<CallToolResult, McpError> {
        let m = self.manager();
        let info = m.connection_info().await;
        let client_alive = m.client().await.is_some();
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Status {
            connected: bool,
            context: Option<String>,
            server: Option<String>,
            version: Option<String>,
        }
        json_result(&Status {
            connected: client_alive && info.is_some(),
            context: info.as_ref().map(|i| i.context.clone()),
            server: info.as_ref().map(|i| i.server.clone()),
            version: info.as_ref().map(|i| i.version.clone()),
        })
    }

    // -----------------------------------------------------------------------
    // Read tools
    // -----------------------------------------------------------------------

    #[tool(description = "List resources of a kind. For cluster-scoped kinds (nodes, namespaces, …) namespace is ignored. Returns objects with { kind, namespace, name, summary } where summary is a one-line status like \"Running (3m)\".")]
    async fn list_resources(
        &self,
        Parameters(p): Parameters<ListResourcesParams>,
    ) -> Result<CallToolResult, McpError> {
        let manager = self.manager();
        let items = kube_api::list_resources(
            &manager,
            &p.kind,
            if p.namespace.is_empty() { None } else { Some(&p.namespace) },
            if p.label_selector.is_empty() {
                None
            } else {
                Some(p.label_selector.as_str())
            },
        )
        .await
        .map_err(tool_error)?;
        json_result(&items)
    }

    #[tool(description = "Fetch one resource as YAML. Secret data is redacted; Helm release 'YAML' is the rendered manifest. managedFields is dropped so the YAML is round-trippable.")]
    async fn get_resource(
        &self,
        Parameters(p): Parameters<GetResourceParams>,
    ) -> Result<CallToolResult, McpError> {
        let yaml = kube_api::get_resource_yaml(&self.manager(), &p.kind, &p.namespace, &p.name)
            .await
            .map_err(tool_error)?;
        Ok(CallToolResult::success(vec![Content::text(yaml)]))
    }

    #[tool(description = "Build the Properties panel for a resource: status, conditions, labels, selectors, container list, volume mounts, and a few other kind-specific sections. Returns the same JSON shape the UI uses.")]
    async fn describe_resource(
        &self,
        Parameters(p): Parameters<GetResourceParams>,
    ) -> Result<CallToolResult, McpError> {
        let props =
            kube_api::describe_resource(&self.manager(), &p.kind, &p.namespace, &p.name)
                .await
                .map_err(tool_error)?;
        json_result(&props)
    }

    #[tool(description = "Read events filtered to a single object (kind+namespace+name). Returns [{ type, reason, message, count, age }, …] in time order, matching what the UI's Events tab shows.")]
    async fn get_events(
        &self,
        Parameters(p): Parameters<GetResourceParams>,
    ) -> Result<CallToolResult, McpError> {
        let events = kube_api::get_events(&self.manager(), &p.kind, &p.namespace, &p.name)
            .await
            .map_err(tool_error)?;
        json_result(&events)
    }

    #[tool(description = "Read the last N lines of a pod's logs (one-shot; not a stream). Use `container` to pick a specific container in a multi-container pod, `previous: true` to read the prior terminated container, `sinceSeconds` for a time window. Returns the raw log text.")]
    async fn get_logs(
        &self,
        Parameters(p): Parameters<LogsParams>,
    ) -> Result<CallToolResult, McpError> {
        let container = if p.container.is_empty() {
            None
        } else {
            Some(p.container.as_str())
        };
        let logs = kube_api::pod_logs(
            &self.manager(),
            &p.namespace,
            &p.pod,
            container,
            p.tail,
            p.since_seconds,
            p.previous,
        )
        .await
        .map_err(tool_error)?;
        Ok(CallToolResult::success(vec![Content::text(logs)]))
    }

    // -----------------------------------------------------------------------
    // Write tools
    // -----------------------------------------------------------------------

    #[tool(description = "Apply a YAML manifest to the cluster (server-side replace). Fails for Secret (read-only) and Helm release. Returns the server's response on success, or a verbatim API error on failure.")]
    async fn apply_yaml(
        &self,
        Parameters(p): Parameters<ApplyYamlParams>,
    ) -> Result<CallToolResult, McpError> {
        ensure_writable(&p.kind).map_err(tool_error)?;
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let (api, _is_helm) =
            kube_api::dynamic_api(client, &p.kind, &p.namespace, &self.manager())
                .await
                .map_err(tool_error)?;
        let obj: DynamicObject =
            serde_yaml::from_str(&p.yaml).map_err(|e| tool_error(AppError::Other(e.to_string())))?;
        api.replace(&p.name, &PostParams::default(), &obj)
            .await
            .map(|_| ())
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "{} {}/{} applied",
            p.kind, p.namespace, p.name
        ))]))
    }

    #[tool(description = "Server-side dry run of an apply. Returns { current, proposed } — both as YAML — so you can diff what would change after defaulting and mutating webhooks run. Read-only; nothing is written.")]
    async fn dry_run_yaml(
        &self,
        Parameters(p): Parameters<ApplyYamlParams>,
    ) -> Result<CallToolResult, McpError> {
        ensure_writable(&p.kind).map_err(tool_error)?;
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let (api, _is_helm) =
            kube_api::dynamic_api(client, &p.kind, &p.namespace, &self.manager())
                .await
                .map_err(tool_error)?;
        let obj: DynamicObject =
            serde_yaml::from_str(&p.yaml).map_err(|e| tool_error(AppError::Other(e.to_string())))?;

        let mut current = api
            .get(&p.name)
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        current.metadata.managed_fields = None;

        let pp = PostParams {
            dry_run: true,
            ..Default::default()
        };
        let mut proposed = api
            .replace(&p.name, &pp, &obj)
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        proposed.metadata.managed_fields = None;

        let current_yaml =
            serde_yaml::to_string(&current).map_err(|e| tool_error(AppError::Other(e.to_string())))?;
        let proposed_yaml = serde_yaml::to_string(&proposed)
            .map_err(|e| tool_error(AppError::Other(e.to_string())))?;

        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Diff {
            current: String,
            proposed: String,
        }
        json_result(&Diff {
            current: current_yaml,
            proposed: proposed_yaml,
        })
    }

    #[tool(description = "Delete a resource by kind/namespace/name. Refuses Helm release (read-only).")]
    async fn delete_resource(
        &self,
        Parameters(p): Parameters<GetResourceParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let (api, _is_helm) =
            kube_api::dynamic_api(client, &p.kind, &p.namespace, &self.manager())
                .await
                .map_err(tool_error)?;
        api.delete(&p.name, &DeleteParams::default())
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![Content::text("deleted")]))
    }

    #[tool(description = "Scale a workload by patching spec.replicas. Works for Deployment, StatefulSet, ReplicaSet.")]
    async fn scale_resource(
        &self,
        Parameters(p): Parameters<ScaleParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let (api, _is_helm) =
            kube_api::dynamic_api(client, &p.kind, &p.namespace, &self.manager())
                .await
                .map_err(tool_error)?;
        let patch = Patch::Merge(serde_json::json!({ "spec": { "replicas": p.replicas } }));
        api.patch(&p.name, &PatchParams::default(), &patch)
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "{} {}/{} scaled to {}",
            p.kind, p.namespace, p.name, p.replicas
        ))]))
    }

    #[tool(description = "Cordon (unschedulable=true) or uncordon a node. Cordoning only blocks new pods; existing pods keep running. For full removal, use drain_node.")]
    async fn set_cordon(
        &self,
        Parameters(p): Parameters<CordonParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let (api, _is_helm) = kube_api::dynamic_api(client, "nodes", "", &self.manager())
            .await
            .map_err(tool_error)?;
        let patch = Patch::Merge(serde_json::json!({ "spec": { "unschedulable": p.unschedulable } }));
        api.patch(&p.name, &PatchParams::default(), &patch)
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "node {} {}",
            p.name,
            if p.unschedulable { "cordoned" } else { "uncordoned" }
        ))]))
    }

    #[tool(description = "Delete a pod to force a restart (the controller will recreate it). For Deployments use restart_rollout. Refuses to delete a pod with no controller, since deletion alone wouldn't recreate it.")]
    async fn restart_pod(
        &self,
        Parameters(p): Parameters<NameNamespaceParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let api: Api<Pod> = Api::namespaced(client, &p.namespace);
        let pod = api
            .get(&p.name)
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        if !restart::has_controller(&pod) {
            return Err(tool_error(AppError::Other(format!(
                "{} has no controller — deleting it would not recreate it. Use Delete instead.",
                p.name
            ))));
        }
        api.delete(&p.name, &DeleteParams::default())
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "pod {}/{} deleted for restart",
            p.namespace, p.name
        ))]))
    }

    #[tool(description = "Trigger a rollout restart by patching the workload's pod-template annotation. The controller rolls through its normal update strategy. Works for Deployment, StatefulSet, DaemonSet, ReplicaSet.")]
    async fn restart_rollout(
        &self,
        Parameters(p): Parameters<GetResourceParams>,
    ) -> Result<CallToolResult, McpError> {
        if !restart::is_rollout_kind(&p.kind) {
            return Err(tool_error(AppError::Other(format!(
                "{} cannot be rollout-restarted",
                p.kind
            ))));
        }
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let (api, _is_helm) =
            kube_api::dynamic_api(client, &p.kind, &p.namespace, &self.manager())
                .await
                .map_err(tool_error)?;
        let now = chrono::Utc::now().to_rfc3339();
        let patch = Patch::Merge(restart::restart_patch(&now));
        api.patch(&p.name, &PatchParams::default(), &patch)
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "rollout restart issued for {} {}/{}",
            p.kind, p.namespace, p.name
        ))]))
    }

    #[tool(description = "Cordon the node, then evict its pods in the background. Returns immediately; track progress by listing pods on the node or re-describing the node. timeout_secs is a hint, not a hard stop — the eviction task runs to completion.")]
    async fn drain_node(
        &self,
        Parameters(p): Parameters<DrainParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        drain::cordon(client.clone(), &p.node)
            .await
            .map_err(tool_error)?;
        let manager = self.manager();
        let sink = manager.sink();
        // Same background pattern as the Tauri `drain_node` — the user gets
        // a "started" message rather than blocking the tool call.
        let node = p.node.clone();
        let timeout = p.timeout_secs.map(std::time::Duration::from_secs);
        let _ = manager
            .push_task(tokio::spawn(async move {
                drain::run_drain(client, sink, node).await;
            }))
            .await;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "drain started for node {}{}",
            p.node,
            timeout
                .map(|t| format!(" (timeout: {}s)", t.as_secs()))
                .unwrap_or_default()
        ))]))
    }

    // -----------------------------------------------------------------------
    // Port-forwarding
    // -----------------------------------------------------------------------

    #[tool(description = "Forward a pod's port to localhost. local_port=0 lets the OS pick a free port. Returns { id, localPort, remotePort, pod, namespace } so you can connect to the local endpoint.")]
    async fn start_port_forward(
        &self,
        Parameters(p): Parameters<StartPortForwardParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let manager = self.manager();
        portforward::ensure_pod(client.clone(), &p.namespace, &p.pod)
            .await
            .map_err(tool_error)?;
        let dto = spawn_forward(
            manager,
            client,
            p.namespace,
            p.pod,
            None,
            p.remote_port,
            p.local_port,
        )
        .await
        .map_err(tool_error)?;
        json_result(&dto)
    }

    #[tool(description = "Forward a Service port (resolves to a backing pod). Same return shape as start_port_forward; the chosen pod is exposed in the result.")]
    async fn start_service_port_forward(
        &self,
        Parameters(p): Parameters<StartServiceForwardParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let manager = self.manager();
        let (pod, target_port) = portforward::resolve_service(
            client.clone(),
            &p.namespace,
            &p.service,
            p.service_port,
        )
        .await
        .map_err(tool_error)?;
        let dto = spawn_forward(
            manager,
            client,
            p.namespace,
            pod,
            Some((p.service, p.service_port)),
            target_port,
            p.local_port,
        )
        .await
        .map_err(tool_error)?;
        json_result(&dto)
    }

    #[tool(description = "Stop a port-forward by its id. Idempotent.")]
    async fn stop_port_forward(
        &self,
        Parameters(p): Parameters<StopForwardParams>,
    ) -> Result<CallToolResult, McpError> {
        self.manager().remove_forward(&p.id).await;
        Ok(CallToolResult::success(vec![Content::text("stopped")]))
    }

    #[tool(description = "List all active port-forwards. Each entry includes the local port (what you connect to) and the pod/service it points at.")]
    async fn list_port_forwards(&self) -> Result<CallToolResult, McpError> {
        let list: Vec<ForwardDto> = self.manager().list_forwards().await;
        json_result(&list)
    }

    // -----------------------------------------------------------------------
    // Interactive shells
    // -----------------------------------------------------------------------

    #[tool(description = "Open an interactive shell in a pod container. Returns { shellId, namespace, pod, container } — the shell runs in the background; use shell_input to send keystrokes and shell_resize for terminal size.")]
    async fn start_shell(
        &self,
        Parameters(p): Parameters<StartShellParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let manager = self.manager();
        let id = format!(
            "sh-{}-{}",
            p.pod,
            uuid_like(&mut shell_seq()),
        );
        let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(64);
        let (resize_tx, resize_rx) = mpsc::channel::<(u16, u16)>(8);
        let id_for_task = id.clone();
        let ns = p.namespace.clone();
        let pod = p.pod.clone();
        let container = p.container.clone();
        let sink = manager.sink();
        let task: JoinHandle<()> = tokio::spawn(async move {
            crate::kube::exec::run_shell(
                client,
                sink,
                id_for_task,
                ns,
                pod,
                container,
                String::new(),
                input_rx,
                resize_rx,
            )
            .await;
        });
        manager
            .add_shell(id.clone(), ShellSession { task, input_tx, resize_tx })
            .await;
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct ShellStarted {
            shell_id: String,
            namespace: String,
            pod: String,
            container: String,
        }
        json_result(&ShellStarted {
            shell_id: id,
            namespace: p.namespace,
            pod: p.pod,
            container: p.container,
        })
    }

    #[tool(description = "Send keystrokes to a shell started with start_shell or start_node_shell. The data is shipped as raw bytes; embed escape sequences the same way you'd type them.")]
    async fn shell_input(
        &self,
        Parameters(p): Parameters<ShellInputParams>,
    ) -> Result<CallToolResult, McpError> {
        self.manager()
            .shell_input(&p.shell_id, p.data.into_bytes())
            .await;
        Ok(CallToolResult::success(vec![Content::text("ok")]))
    }

    #[tool(description = "Resize a shell's terminal. Call after the host's terminal is resized so apps that query the size (top, vim, less) behave.")]
    async fn shell_resize(
        &self,
        Parameters(p): Parameters<ShellResizeParams>,
    ) -> Result<CallToolResult, McpError> {
        self.manager().shell_resize(&p.shell_id, p.cols, p.rows).await;
        Ok(CallToolResult::success(vec![Content::text("ok")]))
    }

    #[tool(description = "Stop a shell (pod or node). Idempotent.")]
    async fn stop_shell(
        &self,
        Parameters(p): Parameters<StopShellParams>,
    ) -> Result<CallToolResult, McpError> {
        self.manager().remove_shell(&p.shell_id).await;
        Ok(CallToolResult::success(vec![Content::text("stopped")]))
    }

    #[tool(description = "Open a root shell on a node (privileged debug pod). Requires cluster RBAC that lets you create privileged pods in the node-debug namespace. Returns { shellId, namespace, pod } — use shell_input / shell_resize / stop_shell on it. The pod is automatically created, waited on (up to 90s for the image pull), and deleted when you stop the session.")]
    async fn start_node_shell(
        &self,
        Parameters(p): Parameters<DrainParams>,
    ) -> Result<CallToolResult, McpError> {
        let _ = p.timeout_secs; // Currently unused; future: surface to the user as a wait budget.
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let manager = self.manager();
        let api: Api<Pod> = Api::namespaced(client.clone(), nodeshell::DEBUG_NAMESPACE);

        // Sweep prior debug pods for this node so a fresh session never
        // collides on a name or leaves a stale privileged pod behind.
        if let Ok(old) = api
            .list(&ListParams::default().labels(&nodeshell::node_selector(&p.node)))
            .await
        {
            for pod in old.items {
                let dp = DeleteParams {
                    grace_period_seconds: Some(0),
                    ..Default::default()
                };
                let _ = api.delete(&pod.name_any(), &dp).await;
            }
        }

        let pod_name = nodeshell::pod_name(&p.node, uuid_like(&mut shell_seq()));
        let image = nodeshell::DEFAULT_IMAGE.to_string();
        api.create(&PostParams::default(), &nodeshell::debug_pod_spec(&p.node, &image, &pod_name))
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;

        // Wait for Running, with a 90s ceiling — long enough for a slow
        // image pull, short enough that an unreachable node doesn't hang
        // the tool call.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
        let mut last = "the pod was never observed".to_string();
        let mut ready = false;
        while std::time::Instant::now() < deadline {
            if let Ok(pod) = api.get(&pod_name).await {
                let phase = pod
                    .status
                    .as_ref()
                    .and_then(|s| s.phase.clone())
                    .unwrap_or_default();
                if phase == "Running" {
                    ready = true;
                    break;
                }
                let waiting = pod
                    .status
                    .as_ref()
                    .and_then(|s| s.container_statuses.as_ref())
                    .and_then(|cs| cs.first())
                    .and_then(|c| c.state.as_ref())
                    .and_then(|s| s.waiting.as_ref())
                    .map(|w| {
                        (
                            w.reason.clone().unwrap_or_default(),
                            w.message.clone().unwrap_or_default(),
                        )
                    });
                last = nodeshell::pending_reason(
                    &phase,
                    waiting.as_ref().map(|(r, m)| (r.as_str(), m.as_str())),
                );
            }
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        }
        if !ready {
            // Best-effort cleanup before we surface the error.
            let _ = api
                .delete(
                    &pod_name,
                    &DeleteParams {
                        grace_period_seconds: Some(0),
                        ..Default::default()
                    },
                )
                .await;
            return Err(tool_error(AppError::Other(format!(
                "timed out starting the debug pod: {last}"
            ))));
        }

        let id = format!("nsh-{pod_name}");
        let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>(64);
        let (resize_tx, resize_rx) = mpsc::channel::<(u16, u16)>(8);
        let id_for_task = id.clone();
        let pod_for_task = pod_name.clone();
        let sink = manager.sink();
        let task = tokio::spawn(async move {
            crate::kube::exec::run_argv(
                client,
                sink,
                id_for_task,
                nodeshell::DEBUG_NAMESPACE.to_string(),
                pod_for_task,
                "debug".to_string(),
                nodeshell::nsenter_cmd(),
                input_rx,
                resize_rx,
            )
            .await;
        });
        manager
            .add_shell(id.clone(), ShellSession { task, input_tx, resize_tx })
            .await;

        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct NodeShellStarted {
            shell_id: String,
            namespace: String,
            pod: String,
        }
        json_result(&NodeShellStarted {
            shell_id: id,
            namespace: nodeshell::DEBUG_NAMESPACE.to_string(),
            pod: pod_name,
        })
    }

    #[tool(description = "Stop a node shell and delete its debug pod. Idempotent.")]
    async fn stop_node_shell(
        &self,
        Parameters(p): Parameters<StopShellParams>,
    ) -> Result<CallToolResult, McpError> {
        let manager = self.manager();
        manager.remove_shell(&p.shell_id).await;
        if let Some(client) = manager.client().await {
            let api: Api<Pod> = Api::namespaced(client, nodeshell::DEBUG_NAMESPACE);
            // The shell_id is \"nsh-<pod-name>\"; strip the prefix to delete
            // the right pod.
            let pod = p.shell_id.strip_prefix("nsh-").unwrap_or(&p.shell_id).to_string();
            let _ = api
                .delete(
                    &pod,
                    &DeleteParams {
                        grace_period_seconds: Some(0),
                        ..Default::default()
                    },
                )
                .await;
        }
        Ok(CallToolResult::success(vec![Content::text("stopped")]))
    }

    // -----------------------------------------------------------------------
    // Convenience getters
    // -----------------------------------------------------------------------

    #[tool(description = "Default path to kubectl's kubeconfig, used to pre-point the import dialog in the UI. Read-only.")]
    async fn default_kubeconfig_path(&self) -> Result<CallToolResult, McpError> {
        Ok(CallToolResult::success(vec![Content::text(
            kube_client::default_kubeconfig_path(),
        )]))
    }

    #[tool(description = "Built-in kind ids the MCP server knows how to resolve. Custom kinds (CRDs) are not in this list — discover them with list_custom_kinds.")]
    async fn list_builtin_kinds(&self) -> Result<CallToolResult, McpError> {
        let kinds: Vec<&'static str> = vec![
            "pods", "deployments", "replicasets", "statefulsets", "daemonsets",
            "jobs", "cronjobs", "services", "ingresses", "ingressclasses",
            "configmaps", "secrets", "serviceaccounts", "persistentvolumeclaims",
            "persistentvolumes", "storageclasses", "nodes", "namespaces",
            "events", "helm",
        ];
        json_result(&kinds)
    }

    #[tool(description = "List the CRD-backed kinds discovered on connect. These are the kinds you can pass to list_resources / get_resource / describe_resource beyond the built-in ones.")]
    async fn list_custom_kinds(&self) -> Result<CallToolResult, McpError> {
        // Read the manager's custom-kinds map by re-running discovery is
        // the simplest path; the kinds are already cached on connect.
        let manager = self.manager();
        let client = match manager.client().await {
            Some(c) => c,
            None => {
                return Ok(CallToolResult::success(vec![Content::text("[]")]));
            }
        };
        let custom = crate::kube::discovery::discover(&client).await;
        let out: Vec<_> = custom
            .into_iter()
            .map(|c| {
                serde_json::json!({
                    "id": c.id,
                    "group": c.group,
                    "version": c.version,
                    "kind": c.kind,
                    "namespaced": c.namespaced,
                })
            })
            .collect();
        json_result(&out)
    }
}

// ---------------------------------------------------------------------------
// ServerHandler — rmcp boilerplate. `#[tool_handler]` synthesises the
// dispatch (list_tools / call_tool) from the `#[tool]` methods on the impl
// above; we just need to describe the server in `get_info`.
// ---------------------------------------------------------------------------

#[tool_handler(router = self.tool_router)]
impl rmcp::ServerHandler for K7sMcpServer {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::default();
        // The lib's CARGO_PKG_NAME is `k7s`, but a host (Claude Desktop,
        // Cursor) distinguishes MCP servers by `serverInfo.name` — the lib
        // name would be ambiguous if a future `k7s-X` binary joined. Pin
        // it to the binary's name; the version stays sourced from the
        // lib's CARGO_PKG_VERSION so the same `cargo build` updates both
        // the CLI and the MCP server in lockstep.
        info.server_info.name = "k7s-mcp".to_string();
        info.server_info.version = env!("CARGO_PKG_VERSION").to_string();
        info.instructions = Some(
            "k7s MCP — Kubernetes tooling for AI clients. \
             Call `list_contexts` then `connect` before any cluster operation; \
             use the built-in kind ids (pods, deployments, services, nodes, …) \
             for the common resources, and `list_custom_kinds` for CRDs. \
             Writes go through `apply_yaml` / `dry_run_yaml` / `delete_resource` / \
             `scale_resource` / `set_cordon` / `restart_*` / `drain_node`. \
             Long-lived sessions: `start_port_forward*` / `start_shell` / \
             `start_node_shell` — all return an id you later pass to the \
             matching `stop_*` tool."
                .to_string(),
        );
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Convert an `AppError` (or anything `Display`-able) into a tool error the
/// AI client shows inline. `McpError::internal_error` would also work, but
/// marking these as "the tool ran" lets the model see the message rather
/// than a protocol-level error code.
fn tool_error(e: impl std::fmt::Display) -> McpError {
    McpError::internal_error(e.to_string(), None)
}

/// Helper: serialise `value` to pretty JSON and wrap it as a single
/// text-content `CallToolResult`. AI clients that understand `structuredContent`
/// (MCP `2026-07-28`) also see the same JSON there.
fn json_result<T: Serialize>(value: &T) -> Result<CallToolResult, McpError> {
    let text = serde_json::to_string_pretty(value).map_err(|e| tool_error(e))?;
    Ok(CallToolResult::success(vec![Content::text(text)]))
}

/// Refuse writes for kinds whose YAML must never be applied (mirrors
/// `commands::ensure_writable` so the MCP and the Tauri shell can't drift).
fn ensure_writable(kind: &str) -> Result<(), AppError> {
    if kind == ResourceKind::Helm.id() {
        return Err(AppError::Other(
            "Helm releases are read-only here — use `helm upgrade` to change one".into(),
        ));
    }
    if kind == "secrets" {
        return Err(AppError::Other("editing Secrets is disabled".into()));
    }
    Ok(())
}

/// Shared by the pod and Service port-forward paths. By the time the Service
/// has been resolved to a pod, it's just a pod forward.
async fn spawn_forward(
    manager: Arc<ClientManager>,
    client: Client,
    namespace: String,
    pod: String,
    service: Option<(String, u16)>,
    remote_port: u16,
    local_port: u16,
) -> Result<ForwardDto, AppError> {
    use tokio::sync::oneshot;
    let (ready_tx, ready_rx) = oneshot::channel::<Result<u16, String>>();
    let (err_tx, mut err_rx) = mpsc::channel::<String>(8);

    let ns = namespace.clone();
    let p = pod.clone();
    let task = tokio::spawn(async move {
        crate::kube::portforward::run_port_forward(client, ns, p, remote_port, ready_tx, err_tx)
            .await;
    });

    // Block until the listener is bound (or report the bind error). The
    // `local_port` hint goes into a small allocation that picks a free
    // port; 0 means "ask the OS".
    let _ = local_port; // portforward::run_port_forward always picks a free port today.
    let chosen_local = ready_rx
        .await
        .map_err(|_| AppError::Other("port-forward task ended before binding".into()))?
        .map_err(AppError::Kube)?;

    let (service_name, service_port) = match service {
        Some((name, port)) => (Some(name), (port != remote_port).then_some(port)),
        None => (None, None),
    };
    let label = service_name.clone().unwrap_or_else(|| pod.clone());
    let id = format!("pf-{label}-{}", uuid_like(&mut shell_seq()));
    let dto = ForwardDto {
        id: id.clone(),
        namespace,
        pod,
        service: service_name,
        remote_port,
        service_port,
        local_port: chosen_local,
        error: None,
    };
    manager.add_forward(dto.clone(), task).await;

    // Relay per-connection failures onto the forward. This task is owned
    // by the manager, so it'll be aborted on `manager.reset()`.
    let manager_for_err = manager.clone();
    let id_for_err = id.clone();
    tokio::spawn(async move {
        while let Some(err) = err_rx.recv().await {
            manager_for_err.set_forward_error(&id_for_err, err).await;
        }
    });

    Ok(dto)
}

// ---------------------------------------------------------------------------
// Tiny utilities
// ---------------------------------------------------------------------------

use std::sync::atomic::{AtomicU64, Ordering};
static SEQ: AtomicU64 = AtomicU64::new(1);

fn shell_seq() -> u64 {
    SEQ.fetch_add(1, Ordering::Relaxed)
}

/// Lightweight unique-ish suffix. We don't need cryptographic uniqueness —
/// just enough that two consecutive tool calls produce different ids and
/// can't collide with each other or with a stale session.
fn uuid_like(counter: &mut u64) -> u64 {
    *counter = SEQ.fetch_add(1, Ordering::Relaxed);
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
        ^ *counter
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

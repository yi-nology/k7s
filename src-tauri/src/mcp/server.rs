//! The MCP server itself.
//!
//! One struct (`K7sMcpServer`) that holds an `Arc<ClientManager>` and exposes
//! the same Kubernetes plumbing the desktop/web shells use, but as a set of
//! MCP `#[tool]` methods. The macros (`#[tool_router]` / `#[tool_handler]`)
//! generate the JSON schema for inputs and wire each method into the tool
//! dispatch table.
//!
//! Note: In Rust 1.97+, `include!` cannot be used inside impl blocks.
//! The tool methods are inlined directly from their source files.

use std::sync::Arc;

use k8s_openapi::api::core::v1::Pod;
use kube::api::{Api, DeleteParams, DynamicObject, ListParams, Patch, PatchParams, PostParams};
use kube::{Client, ResourceExt};
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{
    CallToolResult, ContentBlock, ErrorData as McpError, ServerCapabilities, ServerInfo,
};
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
use crate::kube::metrics::{parse_cpu_millis, parse_mem_bytes};

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
    // === Connection tools ===
    // Connection tools -- included in the `#[tool_router]` impl block via `include!`.

    /// List the contexts visible in the default kubeconfig. The AI can call
    /// this on startup to show the user what's available; `connect` then
    /// picks one.
    #[tool(
        description = "List contexts in the default kubeconfig. Returns the context name, the cluster it points at, and whether it's the current-context."
    )]
    async fn list_contexts(&self) -> Result<CallToolResult, McpError> {
        let contexts = kube_client::list_contexts().unwrap_or_default();
        json_result(&contexts)
    }

    /// Build a kube client for a context and probe the API server. Tears
    /// down any previous connection first.
    #[tool(
        description = "Connect to a kubeconfig context. Tears down any existing connection, builds a client, probes the API server version. Returns the cluster identity (context, server, version)."
    )]
    async fn connect(
        &self,
        Parameters(p): Parameters<ConnectParams>,
    ) -> Result<CallToolResult, McpError> {
        let manager = self.manager();
        // Always start clean -- switching context must abort every watcher,
        // log stream, shell, and port-forward tied to the old cluster.
        manager.reset().await;

        let context = if p.context.is_empty() {
            // Empty -> use current-context. Probe the kubeconfig directly
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
    #[tool(
        description = "Disconnect from the current cluster. Aborts watchers, log streams, shells, and port-forwards. The next tool call will need `connect` again."
    )]
    async fn disconnect(&self) -> Result<CallToolResult, McpError> {
        self.manager().reset().await;
        Ok(CallToolResult::success(vec![ContentBlock::text(
            "disconnected",
        )]))
    }

    /// Current connection status. `connected: false` means tools that need
    /// a client (everything except `list_contexts`) will return a
    /// "not connected" error.
    #[tool(
        description = "Show the current connection: context, server, API server version. Returns { connected: false } when nothing is connected."
    )]
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

    // === Read tools ===
    // Read tools -- included in the `#[tool_router]` impl block via `include!`.

    #[tool(
        description = "List resources of a kind. For cluster-scoped kinds (nodes, namespaces, ...) namespace is ignored. Returns objects with { kind, namespace, name, summary } where summary is a one-line status like \"Running (3m)\"."
    )]
    async fn list_resources(
        &self,
        Parameters(p): Parameters<ListResourcesParams>,
    ) -> Result<CallToolResult, McpError> {
        let manager = self.manager();
        let items = kube_api::list_resources(
            &manager,
            &p.kind,
            if p.namespace.is_empty() {
                None
            } else {
                Some(&p.namespace)
            },
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

    #[tool(
        description = "Fetch one resource as YAML. Secret data is redacted; Helm release 'YAML' is the rendered manifest. managedFields is dropped so the YAML is round-trippable."
    )]
    async fn get_resource(
        &self,
        Parameters(p): Parameters<GetResourceParams>,
    ) -> Result<CallToolResult, McpError> {
        let yaml = kube_api::get_resource_yaml(&self.manager(), &p.kind, &p.namespace, &p.name)
            .await
            .map_err(tool_error)?;
        Ok(CallToolResult::success(vec![ContentBlock::text(yaml)]))
    }

    #[tool(
        description = "Build the Properties panel for a resource: status, conditions, labels, selectors, container list, volume mounts, and a few other kind-specific sections. Returns the same JSON shape the UI uses."
    )]
    async fn describe_resource(
        &self,
        Parameters(p): Parameters<GetResourceParams>,
    ) -> Result<CallToolResult, McpError> {
        let props = kube_api::describe_resource(&self.manager(), &p.kind, &p.namespace, &p.name)
            .await
            .map_err(tool_error)?;
        json_result(&props)
    }

    #[tool(
        description = "Read events filtered to a single object (kind+namespace+name). Returns [{ type, reason, message, count, age }, ...] in time order, matching what the UI's Events tab shows."
    )]
    async fn get_events(
        &self,
        Parameters(p): Parameters<GetResourceParams>,
    ) -> Result<CallToolResult, McpError> {
        let events = kube_api::get_events(&self.manager(), &p.kind, &p.namespace, &p.name)
            .await
            .map_err(tool_error)?;
        json_result(&events)
    }

    #[tool(
        description = "Read the last N lines of a pod's logs (one-shot; not a stream). Use `container` to pick a specific container in a multi-container pod, `previous: true` to read the prior terminated container, `sinceSeconds` for a time window. Returns the raw log text."
    )]
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
        Ok(CallToolResult::success(vec![ContentBlock::text(logs)]))
    }

    // === Write tools ===
    // Write tools -- included in the `#[tool_router]` impl block via `include!`.

    #[tool(
        description = "Apply a YAML manifest to the cluster (server-side replace). Fails for Secret (read-only) and Helm release. Returns the server's response on success, or a verbatim API error on failure."
    )]
    async fn apply_yaml(
        &self,
        Parameters(p): Parameters<ApplyYamlParams>,
    ) -> Result<CallToolResult, McpError> {
        ensure_writable(&p.kind).map_err(tool_error)?;
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let (api, _is_helm) = kube_api::dynamic_api(client, &p.kind, &p.namespace, &self.manager())
            .await
            .map_err(tool_error)?;
        let obj: DynamicObject = serde_yaml::from_str(&p.yaml)
            .map_err(|e| tool_error(AppError::Other(e.to_string())))?;
        api.replace(&p.name, &PostParams::default(), &obj)
            .await
            .map(|_| ())
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![ContentBlock::text(format!(
            "{} {}/{} applied",
            p.kind, p.namespace, p.name
        ))]))
    }

    #[tool(
        description = "Server-side dry run of an apply. Returns { current, proposed } -- both as YAML -- so you can diff what would change after defaulting and mutating webhooks run. Read-only; nothing is written."
    )]
    async fn dry_run_yaml(
        &self,
        Parameters(p): Parameters<ApplyYamlParams>,
    ) -> Result<CallToolResult, McpError> {
        ensure_writable(&p.kind).map_err(tool_error)?;
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let (api, _is_helm) = kube_api::dynamic_api(client, &p.kind, &p.namespace, &self.manager())
            .await
            .map_err(tool_error)?;
        let obj: DynamicObject = serde_yaml::from_str(&p.yaml)
            .map_err(|e| tool_error(AppError::Other(e.to_string())))?;

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

        let current_yaml = serde_yaml::to_string(&current)
            .map_err(|e| tool_error(AppError::Other(e.to_string())))?;
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

    #[tool(
        description = "Delete a resource by kind/namespace/name. Refuses Helm release (read-only)."
    )]
    async fn delete_resource(
        &self,
        Parameters(p): Parameters<GetResourceParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let (api, _is_helm) = kube_api::dynamic_api(client, &p.kind, &p.namespace, &self.manager())
            .await
            .map_err(tool_error)?;
        api.delete(&p.name, &DeleteParams::default())
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![ContentBlock::text("deleted")]))
    }

    #[tool(
        description = "Scale a workload by patching spec.replicas. Works for Deployment, StatefulSet, ReplicaSet."
    )]
    async fn scale_resource(
        &self,
        Parameters(p): Parameters<ScaleParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let (api, _is_helm) = kube_api::dynamic_api(client, &p.kind, &p.namespace, &self.manager())
            .await
            .map_err(tool_error)?;
        let patch = Patch::Merge(serde_json::json!({ "spec": { "replicas": p.replicas } }));
        api.patch(&p.name, &PatchParams::default(), &patch)
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![ContentBlock::text(format!(
            "{} {}/{} scaled to {}",
            p.kind, p.namespace, p.name, p.replicas
        ))]))
    }

    #[tool(
        description = "Cordon (unschedulable=true) or uncordon a node. Cordoning only blocks new pods; existing pods keep running. For full removal, use drain_node."
    )]
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
        let patch =
            Patch::Merge(serde_json::json!({ "spec": { "unschedulable": p.unschedulable } }));
        api.patch(&p.name, &PatchParams::default(), &patch)
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![ContentBlock::text(format!(
            "node {} {}",
            p.name,
            if p.unschedulable {
                "cordoned"
            } else {
                "uncordoned"
            }
        ))]))
    }

    #[tool(
        description = "Delete a pod to force a restart (the controller will recreate it). For Deployments use restart_rollout. Refuses to delete a pod with no controller, since deletion alone wouldn't recreate it."
    )]
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
                "{} has no controller -- deleting it would not recreate it. Use Delete instead.",
                p.name
            ))));
        }
        api.delete(&p.name, &DeleteParams::default())
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![ContentBlock::text(format!(
            "pod {}/{} deleted for restart",
            p.namespace, p.name
        ))]))
    }

    #[tool(
        description = "Trigger a rollout restart by patching the workload's pod-template annotation. The controller rolls through its normal update strategy. Works for Deployment, StatefulSet, DaemonSet, ReplicaSet."
    )]
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
        let (api, _is_helm) = kube_api::dynamic_api(client, &p.kind, &p.namespace, &self.manager())
            .await
            .map_err(tool_error)?;
        let now = chrono::Utc::now().to_rfc3339();
        let patch = Patch::Merge(restart::restart_patch(&now));
        api.patch(&p.name, &PatchParams::default(), &patch)
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![ContentBlock::text(format!(
            "rollout restart issued for {} {}/{}",
            p.kind, p.namespace, p.name
        ))]))
    }

    #[tool(
        description = "Cordon the node, then evict its pods in the background. Returns immediately; track progress by listing pods on the node or re-describing the node. timeout_secs is a hint, not a hard stop -- the eviction task runs to completion."
    )]
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
        // Same background pattern as the Tauri `drain_node` -- the user gets
        // a "started" message rather than blocking the tool call.
        let node = p.node.clone();
        let timeout = p.timeout_secs.map(std::time::Duration::from_secs);
        let _ = manager
            .push_task(tokio::spawn(async move {
                drain::run_drain(client, sink, node).await;
            }))
            .await;
        Ok(CallToolResult::success(vec![ContentBlock::text(format!(
            "drain started for node {}{}",
            p.node,
            timeout
                .map(|t| format!(" (timeout: {}s)", t.as_secs()))
                .unwrap_or_default()
        ))]))
    }

    // === Shell tools ===
    // Shell, exec, port-forward, pod-file, and convenience tools
    // -- included in the `#[tool_router]` impl block via `include!`.

    // -----------------------------------------------------------------------
    // Port-forwarding
    // -----------------------------------------------------------------------

    #[tool(
        description = "Forward a pod's port to localhost. local_port=0 lets the OS pick a free port. Returns { id, localPort, remotePort, pod, namespace } so you can connect to the local endpoint."
    )]
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

    #[tool(
        description = "Forward a Service port (resolves to a backing pod). Same return shape as start_port_forward; the chosen pod is exposed in the result."
    )]
    async fn start_service_port_forward(
        &self,
        Parameters(p): Parameters<StartServiceForwardParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let manager = self.manager();
        let (pod, target_port) =
            portforward::resolve_service(client.clone(), &p.namespace, &p.service, p.service_port)
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
        Ok(CallToolResult::success(vec![ContentBlock::text("stopped")]))
    }

    #[tool(
        description = "List all active port-forwards. Each entry includes the local port (what you connect to) and the pod/service it points at."
    )]
    async fn list_port_forwards(&self) -> Result<CallToolResult, McpError> {
        let list: Vec<ForwardDto> = self.manager().list_forwards().await;
        json_result(&list)
    }

    // -----------------------------------------------------------------------
    // Interactive shells
    // -----------------------------------------------------------------------

    #[tool(
        description = "Open an interactive shell in a pod container. Returns { shellId, namespace, pod, container } -- the shell runs in the background; use shell_input to send keystrokes and shell_resize for terminal size."
    )]
    async fn start_shell(
        &self,
        Parameters(p): Parameters<StartShellParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let manager = self.manager();
        let id = format!("sh-{}-{}", p.pod, uuid_like(&mut shell_seq()),);
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
            .add_shell(
                id.clone(),
                ShellSession {
                    task,
                    input_tx,
                    resize_tx,
                },
            )
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

    #[tool(
        description = "Send keystrokes to a shell started with start_shell or start_node_shell. The data is shipped as raw bytes; embed escape sequences the same way you'd type them."
    )]
    async fn shell_input(
        &self,
        Parameters(p): Parameters<ShellInputParams>,
    ) -> Result<CallToolResult, McpError> {
        self.manager()
            .shell_input(&p.shell_id, p.data.into_bytes())
            .await;
        Ok(CallToolResult::success(vec![ContentBlock::text("ok")]))
    }

    #[tool(
        description = "Resize a shell's terminal. Call after the host's terminal is resized so apps that query the size (top, vim, less) behave."
    )]
    async fn shell_resize(
        &self,
        Parameters(p): Parameters<ShellResizeParams>,
    ) -> Result<CallToolResult, McpError> {
        self.manager()
            .shell_resize(&p.shell_id, p.cols, p.rows)
            .await;
        Ok(CallToolResult::success(vec![ContentBlock::text("ok")]))
    }

    #[tool(description = "Stop a shell (pod or node). Idempotent.")]
    async fn stop_shell(
        &self,
        Parameters(p): Parameters<StopShellParams>,
    ) -> Result<CallToolResult, McpError> {
        self.manager().remove_shell(&p.shell_id).await;
        Ok(CallToolResult::success(vec![ContentBlock::text("stopped")]))
    }

    #[tool(
        description = "Open a root shell on a node (privileged debug pod). Requires cluster RBAC that lets you create privileged pods in the node-debug namespace. Returns { shellId, namespace, pod } -- use shell_input / shell_resize / stop_shell on it. The pod is automatically created, waited on (up to 90s for the image pull), and deleted when you stop the session."
    )]
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
        api.create(
            &PostParams::default(),
            &nodeshell::debug_pod_spec(&p.node, &image, &pod_name),
        )
        .await
        .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;

        // Wait for Running (up to 90s) using the shared helper, which also
        // handles the 404-cache-lag window right after create that an inline
        // poll loop would miss. On timeout the helper returns an error; we do
        // the best-effort pod cleanup (the helper deliberately does not delete,
        // leaving teardown to the caller).
        if let Err(e) = nodeshell::await_debug_pod(&api, &pod_name).await {
            let _ = api
                .delete(
                    &pod_name,
                    &DeleteParams {
                        grace_period_seconds: Some(0),
                        ..Default::default()
                    },
                )
                .await;
            return Err(tool_error(e));
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
            .add_shell(
                id.clone(),
                ShellSession {
                    task,
                    input_tx,
                    resize_tx,
                },
            )
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
            // The shell_id is "nsh-<pod-name>"; strip the prefix to delete
            // the right pod.
            let pod = p
                .shell_id
                .strip_prefix("nsh-")
                .unwrap_or(&p.shell_id)
                .to_string();
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
        Ok(CallToolResult::success(vec![ContentBlock::text("stopped")]))
    }

    // -----------------------------------------------------------------------
    // Convenience getters
    // -----------------------------------------------------------------------

    #[tool(
        description = "Default path to kubectl's kubeconfig, used to pre-point the import dialog in the UI. Read-only."
    )]
    async fn default_kubeconfig_path(&self) -> Result<CallToolResult, McpError> {
        Ok(CallToolResult::success(vec![ContentBlock::text(
            kube_client::default_kubeconfig_path(),
        )]))
    }

    #[tool(
        description = "Built-in kind ids the MCP server knows how to resolve. Custom kinds (CRDs) are not in this list -- discover them with list_custom_kinds."
    )]
    async fn list_builtin_kinds(&self) -> Result<CallToolResult, McpError> {
        let kinds: Vec<&'static str> = vec![
            "pods",
            "deployments",
            "replicasets",
            "statefulsets",
            "daemonsets",
            "jobs",
            "cronjobs",
            "services",
            "ingresses",
            "ingressclasses",
            "configmaps",
            "secrets",
            "serviceaccounts",
            "persistentvolumeclaims",
            "persistentvolumes",
            "storageclasses",
            "nodes",
            "namespaces",
            "events",
            "helm",
        ];
        json_result(&kinds)
    }

    #[tool(
        description = "List the CRD-backed kinds discovered on connect. These are the kinds you can pass to list_resources / get_resource / describe_resource beyond the built-in ones."
    )]
    async fn list_custom_kinds(&self) -> Result<CallToolResult, McpError> {
        // Read the manager's custom-kinds map by re-running discovery is
        // the simplest path; the kinds are already cached on connect.
        let manager = self.manager();
        let client = match manager.client().await {
            Some(c) => c,
            None => {
                return Ok(CallToolResult::success(vec![ContentBlock::text("[]")]));
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

    // -----------------------------------------------------------------------
    // One-shot exec, rollout status, top, cronjob trigger
    // -----------------------------------------------------------------------

    #[tool(
        description = "Run a single command in a pod container and return its stdout (kubectl exec). Non-interactive, non-TTY. The command runs via /bin/sh -c; stderr is merged into stdout."
    )]
    async fn exec_command(
        &self,
        Parameters(p): Parameters<ExecParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let container = if p.container.is_empty() {
            None
        } else {
            Some(p.container.as_str())
        };
        let argv = vec!["/bin/sh".to_string(), "-c".to_string(), p.command];
        let out = kube_api::exec_capture(&client, &p.namespace, &p.pod, container, argv)
            .await
            .map_err(tool_error)?;
        Ok(CallToolResult::success(vec![ContentBlock::text(out)]))
    }

    #[tool(
        description = "Inspect a workload's rollout state (kubectl rollout status). Returns replica counts, conditions, and a `done` flag. Accepts deployments, statefulsets, daemonsets, replicasets."
    )]
    async fn rollout_status(
        &self,
        Parameters(p): Parameters<GetResourceParams>,
    ) -> Result<CallToolResult, McpError> {
        let status = kube_api::rollout_status(&self.manager(), &p.kind, &p.namespace, &p.name)
            .await
            .map_err(tool_error)?;
        json_result(&status)
    }

    #[tool(
        description = "Snapshot of per-pod CPU/memory usage from metrics.k8s.io (kubectl top pods). Requires metrics-server."
    )]
    async fn top_pods(
        &self,
        Parameters(p): Parameters<TopPodsParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let ns = if p.namespace.is_empty() {
            None
        } else {
            Some(p.namespace.as_str())
        };
        let rows = kube_api::top_pods(&client, ns).await.map_err(tool_error)?;
        json_result(&rows)
    }

    #[tool(
        description = "Snapshot of per-node CPU/memory usage and capacity (kubectl top nodes). Requires metrics-server."
    )]
    async fn top_nodes(&self) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let rows = kube_api::top_nodes(&client).await.map_err(tool_error)?;
        json_result(&rows)
    }

    #[tool(
        description = "Manually trigger a CronJob by creating a Job from its spec (kubectl create job --from=cronjob/<name>). Returns the new Job's name."
    )]
    async fn trigger_cronjob(
        &self,
        Parameters(p): Parameters<NameNamespaceNameParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let job_name = kube_api::trigger_cronjob(&client, &p.namespace, &p.name)
            .await
            .map_err(tool_error)?;
        Ok(CallToolResult::success(vec![ContentBlock::text(format!(
            "created job {}/{}",
            p.namespace, job_name
        ))]))
    }

    // -----------------------------------------------------------------------
    // Multi-document YAML apply / dry-run
    // -----------------------------------------------------------------------

    #[tool(
        description = "Apply a multi-document YAML bundle (documents separated by ---). Each doc is applied via server-side apply; stops at the first error and returns per-document status."
    )]
    async fn apply_yaml_bundle(
        &self,
        Parameters(p): Parameters<YamlBundleParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let results = templates::multi_apply(&p.yaml, client, &self.manager())
            .await
            .map_err(tool_error)?;
        json_result(&results)
    }

    #[tool(
        description = "Dry-run a multi-document YAML bundle without writing anything. Returns per-document proposed YAML and any error."
    )]
    async fn dry_run_yaml_bundle(
        &self,
        Parameters(p): Parameters<YamlBundleParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let results = templates::multi_dry_run(&p.yaml, client)
            .await
            .map_err(tool_error)?;
        json_result(&results)
    }

    // -----------------------------------------------------------------------
    // API resources discovery + Endpoints
    // -----------------------------------------------------------------------

    #[tool(
        description = "Discover every resource the API server serves (kubectl api-resources). Returns name, group, version, kind, namespaced, verbs for each."
    )]
    async fn list_api_resources(&self) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let rows = kube_api::list_api_resources(&client)
            .await
            .map_err(tool_error)?;
        json_result(&rows)
    }

    #[tool(
        description = "List EndpointSlices. Optional namespace scopes the list; optional service filters to one Service's slices. Without filters, lists cluster-wide."
    )]
    async fn list_endpoints(
        &self,
        Parameters(p): Parameters<ListEndpointsParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let rows = if !p.service.is_empty() {
            endpoints::list_for_service(&client, &p.namespace, &p.service)
                .await
                .map_err(tool_error)?
        } else if !p.namespace.is_empty() {
            endpoints::list_namespaced(&client, &p.namespace)
                .await
                .map_err(tool_error)?
        } else {
            endpoints::list_all(&client).await.map_err(tool_error)?
        };
        json_result(&rows)
    }

    // -----------------------------------------------------------------------
    // Pod file operations
    // -----------------------------------------------------------------------

    #[tool(
        description = "List a directory inside a pod container. Returns file/dir/symlink entries with size, mtime, and POSIX mode."
    )]
    async fn pod_list_files(
        &self,
        Parameters(p): Parameters<PodFileParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let container = if p.container.is_empty() {
            None
        } else {
            Some(p.container.as_str())
        };
        let entries = pod_files::list_dir(client, &p.namespace, &p.pod, container, &p.path)
            .await
            .map_err(tool_error)?;
        json_result(&entries)
    }

    #[tool(description = "Read a file's text contents from a pod container (UTF-8 lossy).")]
    async fn pod_read_file(
        &self,
        Parameters(p): Parameters<PodFileParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let container = if p.container.is_empty() {
            None
        } else {
            Some(p.container.as_str())
        };
        let text = pod_files::read_file(client, &p.namespace, &p.pod, container, &p.path)
            .await
            .map_err(tool_error)?;
        Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
    }

    #[tool(
        description = "Write a file inside a pod container. Creates parent directories as needed."
    )]
    async fn pod_write_file(
        &self,
        Parameters(p): Parameters<PodFileWriteParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let container = if p.container.is_empty() {
            None
        } else {
            Some(p.container.as_str())
        };
        pod_files::write_file(client, &p.namespace, &p.pod, container, &p.path, &p.content)
            .await
            .map_err(tool_error)?;
        Ok(CallToolResult::success(vec![ContentBlock::text("written")]))
    }

    #[tool(description = "Download a path from a pod container as a base64-encoded tar archive.")]
    async fn pod_download_file(
        &self,
        Parameters(p): Parameters<PodFileParams>,
    ) -> Result<CallToolResult, McpError> {
        use base64::Engine;
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let container = if p.container.is_empty() {
            None
        } else {
            Some(p.container.as_str())
        };
        let bytes = pod_files::download_path(client, &p.namespace, &p.pod, container, &p.path)
            .await
            .map_err(tool_error)?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        Ok(CallToolResult::success(vec![ContentBlock::text(b64)]))
    }

    #[tool(
        description = "Upload a base64-encoded tar archive into a directory inside a pod container."
    )]
    async fn pod_upload_file(
        &self,
        Parameters(p): Parameters<PodFileUploadParams>,
    ) -> Result<CallToolResult, McpError> {
        use base64::Engine;
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&p.tar_b64)
            .map_err(|e| tool_error(AppError::Other(format!("base64 decode: {e}"))))?;
        let container = if p.container.is_empty() {
            None
        } else {
            Some(p.container.as_str())
        };
        pod_files::upload_path(client, &p.namespace, &p.pod, container, &p.dest_dir, &bytes)
            .await
            .map_err(tool_error)?;
        Ok(CallToolResult::success(vec![ContentBlock::text(
            "uploaded",
        )]))
    }

    // -----------------------------------------------------------------------
    // Import kubeconfig content
    // -----------------------------------------------------------------------

    #[tool(
        description = "Register every context in a kubeconfig YAML blob so a later `connect` can build from it. Returns the merged context list."
    )]
    async fn import_kubeconfig(
        &self,
        Parameters(p): Parameters<ImportKubeconfigParams>,
    ) -> Result<CallToolResult, McpError> {
        let manager = self.manager();
        let kc = kube::config::Kubeconfig::from_yaml(&p.contents)
            .map_err(|e| tool_error(AppError::Kubeconfig(format!("parse kubeconfig: {e}"))))?;
        for ctx in &kc.contexts {
            let cluster = ctx
                .context
                .as_ref()
                .map(|c| c.cluster.clone())
                .unwrap_or_default();
            manager
                .add_import(
                    ctx.name.clone(),
                    ImportedContext {
                        path: p.filename.clone(),
                        cluster,
                        kubeconfig: Some(kc.clone()),
                    },
                )
                .await;
        }
        let mut merged = kube_client::list_contexts().unwrap_or_default();
        let existing: std::collections::HashSet<String> =
            merged.iter().map(|c| c.name.clone()).collect();
        let imports = manager.imports().await;
        for (name, imp) in imports {
            if !existing.contains(&name) {
                merged.push(kube_client::ContextInfo {
                    name,
                    cluster: imp.cluster,
                    current: false,
                });
            }
        }
        json_result(&merged)
    }

    // === Helm tools ===
    // Helm operation and chart repository tools
    // -- included in the `#[tool_router]` impl block via `include!`.

    // -----------------------------------------------------------------------
    // Helm operations (install / upgrade / uninstall / rollback / history)
    // -----------------------------------------------------------------------

    #[tool(
        description = "Install a Helm chart (helm install). Streams progress to the event sink; returns the final result. The release name is required."
    )]
    async fn helm_install(
        &self,
        Parameters(p): Parameters<HelmInstallParams>,
    ) -> Result<CallToolResult, McpError> {
        let sink = self.manager().sink();
        let op = helm_ops::HelmOp::Install(helm_ops::InstallArgs {
            release: p.release,
            chart: p.chart,
            version: p.version,
            namespace: p.namespace,
            kubeconfig: None,
            values: p.values,
            dry_run: p.dry_run,
            create_namespace: p.create_namespace,
        });
        let result = helm_ops::run_op(op, sink).await.map_err(tool_error)?;
        json_result(&result)
    }

    #[tool(
        description = "Upgrade a Helm release (helm upgrade). Creates the release if absent. Supports reuseValues, rollbackOnFailure, and dryRun."
    )]
    async fn helm_upgrade(
        &self,
        Parameters(p): Parameters<HelmUpgradeParams>,
    ) -> Result<CallToolResult, McpError> {
        let sink = self.manager().sink();
        let op = helm_ops::HelmOp::Upgrade(helm_ops::UpgradeArgs {
            release: p.release,
            chart: p.chart,
            version: p.version,
            namespace: p.namespace,
            kubeconfig: None,
            values: p.values,
            dry_run: p.dry_run,
            reuse_values: p.reuse_values,
            rollback_on_failure: p.rollback_on_failure,
        });
        let result = helm_ops::run_op(op, sink).await.map_err(tool_error)?;
        json_result(&result)
    }

    #[tool(
        description = "Uninstall a Helm release (helm uninstall). Set keepHistory=true to retain revisions for a later rollback."
    )]
    async fn helm_uninstall(
        &self,
        Parameters(p): Parameters<HelmUninstallParams>,
    ) -> Result<CallToolResult, McpError> {
        let sink = self.manager().sink();
        let op = helm_ops::HelmOp::Uninstall(helm_ops::UninstallArgs {
            release: p.release,
            namespace: p.namespace,
            kubeconfig: None,
            keep_history: p.keep_history,
        });
        let result = helm_ops::run_op(op, sink).await.map_err(tool_error)?;
        json_result(&result)
    }

    #[tool(
        description = "Roll back a Helm release to a previous revision (helm rollback). revision is optional -- empty rolls back to the previous one."
    )]
    async fn helm_rollback(
        &self,
        Parameters(p): Parameters<HelmRollbackParams>,
    ) -> Result<CallToolResult, McpError> {
        let sink = self.manager().sink();
        let op = helm_ops::HelmOp::Rollback(helm_ops::RollbackArgs {
            release: p.release,
            namespace: p.namespace,
            revision: p.revision,
            kubeconfig: None,
        });
        let result = helm_ops::run_op(op, sink).await.map_err(tool_error)?;
        json_result(&result)
    }

    #[tool(
        description = "Fetch the revision history for a Helm release (helm history). Returns one row per revision with status, chart, and app version."
    )]
    async fn helm_history(
        &self,
        Parameters(p): Parameters<HelmHistoryParams>,
    ) -> Result<CallToolResult, McpError> {
        let rows = helm_ops::release_history(&p.release, &p.namespace, None)
            .await
            .map_err(tool_error)?;
        json_result(&rows)
    }

    #[tool(
        description = "Render a chart's default values.yaml (helm show values). Useful to prefill the values editor before helm_install/helm_upgrade."
    )]
    async fn helm_show_values(
        &self,
        Parameters(p): Parameters<HelmShowValuesParams>,
    ) -> Result<CallToolResult, McpError> {
        let values = helm_ops::render_default_values(&p.chart, &p.version, None)
            .await
            .map_err(tool_error)?;
        Ok(CallToolResult::success(vec![ContentBlock::text(values)]))
    }

    // -----------------------------------------------------------------------
    // Helm chart repository management
    // -----------------------------------------------------------------------

    #[tool(
        description = "List the user's configured Helm chart repositories, with last refresh status."
    )]
    async fn helm_list_repos(&self) -> Result<CallToolResult, McpError> {
        let repos = helm_market::list_repos().map_err(tool_error)?;
        json_result(&repos)
    }

    #[tool(
        description = "Search across every cached Helm repo index. Empty query returns everything."
    )]
    async fn helm_search_charts(
        &self,
        Parameters(p): Parameters<HelmSearchParams>,
    ) -> Result<CallToolResult, McpError> {
        let charts = helm_market::search_charts(&p.query).map_err(tool_error)?;
        json_result(&charts)
    }

    #[tool(description = "Add a Helm chart repository.")]
    async fn helm_add_repo(
        &self,
        Parameters(p): Parameters<HelmRepoParams>,
    ) -> Result<CallToolResult, McpError> {
        let repo = helm_market::add_repo(&p.name, &p.url, &p.description).map_err(tool_error)?;
        json_result(&repo)
    }

    #[tool(description = "Remove a Helm chart repository and its cached index.")]
    async fn helm_remove_repo(
        &self,
        Parameters(p): Parameters<HelmRepoNameParams>,
    ) -> Result<CallToolResult, McpError> {
        helm_market::remove_repo(&p.name).map_err(tool_error)?;
        Ok(CallToolResult::success(vec![ContentBlock::text("removed")]))
    }

    #[tool(
        description = "Re-fetch a Helm repo's index from its URL. Returns the updated repo entry."
    )]
    async fn helm_update_repo(
        &self,
        Parameters(p): Parameters<HelmRepoNameParams>,
    ) -> Result<CallToolResult, McpError> {
        let repo = helm_market::update_repo_index(&p.name)
            .await
            .map_err(tool_error)?;
        json_result(&repo)
    }

    // === Monitoring tools ===
    // Monitoring, image registry, image sync, and enhanced AI integration tools
    // -- included in the `#[tool_router]` impl block via `include!`.

    // -----------------------------------------------------------------------
    // Monitoring: Prometheus / AlertManager / Grafana
    // -----------------------------------------------------------------------

    #[tool(
        description = "Run an instant PromQL query against a configured Prometheus instance (by name)."
    )]
    async fn prometheus_query(
        &self,
        Parameters(p): Parameters<PrometheusQueryParams>,
    ) -> Result<CallToolResult, McpError> {
        let result = metrics_config::query(&p.name, &p.promql)
            .await
            .map_err(tool_error)?;
        json_result(&result)
    }

    #[tool(
        description = "Run a range PromQL query (start/end epoch-ms, step seconds) against a configured Prometheus instance."
    )]
    async fn prometheus_query_range(
        &self,
        Parameters(p): Parameters<PrometheusQueryRangeParams>,
    ) -> Result<CallToolResult, McpError> {
        let result =
            metrics_config::query_range(&p.name, &p.promql, p.start_ms, p.end_ms, p.step_seconds)
                .await
                .map_err(tool_error)?;
        json_result(&result)
    }

    #[tool(description = "List active alerts from a configured AlertManager instance (by name).")]
    async fn alertmanager_alerts(
        &self,
        Parameters(p): Parameters<InstanceNameParams>,
    ) -> Result<CallToolResult, McpError> {
        let alerts = alerting::list_alerts(&p.name).await.map_err(tool_error)?;
        json_result(&alerts)
    }

    #[tool(description = "List silences from a configured AlertManager instance (by name).")]
    async fn alertmanager_silences(
        &self,
        Parameters(p): Parameters<InstanceNameParams>,
    ) -> Result<CallToolResult, McpError> {
        let silences = alerting::list_silences(&p.name).await.map_err(tool_error)?;
        json_result(&silences)
    }

    #[tool(
        description = "Build a direct Grafana dashboard URL (by instance name, dashboard uid, from/to epoch-ms)."
    )]
    async fn grafana_dashboard_url(
        &self,
        Parameters(p): Parameters<GrafanaDashboardParams>,
    ) -> Result<CallToolResult, McpError> {
        let url =
            grafana::dashboard_url(&p.name, &p.uid, p.from_ms, p.to_ms).map_err(tool_error)?;
        Ok(CallToolResult::success(vec![ContentBlock::text(url)]))
    }

    // -----------------------------------------------------------------------
    // Image registry queries
    // -----------------------------------------------------------------------

    #[tool(
        description = "List tags for a repository in a configured image registry (by registry name)."
    )]
    async fn image_registry_tags(
        &self,
        Parameters(p): Parameters<ImageRegistryRepoParams>,
    ) -> Result<CallToolResult, McpError> {
        let reg = imagerepo::list_registries()
            .map_err(tool_error)?
            .into_iter()
            .find(|r| r.name == p.name)
            .ok_or_else(|| {
                tool_error(AppError::NotFound(format!(
                    "registry '{}' not found",
                    p.name
                )))
            })?;
        let tags = imagerepo::list_tags(&reg, &p.repo)
            .await
            .map_err(tool_error)?;
        json_result(&tags)
    }

    #[tool(description = "Fetch the manifest for a repo:tag in a configured image registry.")]
    async fn image_registry_manifest(
        &self,
        Parameters(p): Parameters<ImageRegistryManifestParams>,
    ) -> Result<CallToolResult, McpError> {
        let reg = imagerepo::list_registries()
            .map_err(tool_error)?
            .into_iter()
            .find(|r| r.name == p.name)
            .ok_or_else(|| {
                tool_error(AppError::NotFound(format!(
                    "registry '{}' not found",
                    p.name
                )))
            })?;
        let manifest = imagerepo::manifest(&reg, &p.repo, &p.tag)
            .await
            .map_err(tool_error)?;
        json_result(&manifest)
    }

    #[tool(
        description = "Run a previously-saved PromQL query (by saved-query name) against a Prometheus instance. Set forceRefresh=true to bypass the cache."
    )]
    async fn saved_query_run(
        &self,
        Parameters(p): Parameters<SavedQueryRunParams>,
    ) -> Result<CallToolResult, McpError> {
        let query = saved_queries::list()
            .map_err(tool_error)?
            .into_iter()
            .find(|q| q.name == p.name)
            .ok_or_else(|| {
                tool_error(AppError::NotFound(format!(
                    "saved query '{}' not found",
                    p.name
                )))
            })?;
        let result = saved_queries::run_saved(&query, &p.instance, p.force_refresh)
            .await
            .map_err(tool_error)?;
        json_result(&result)
    }

    // -----------------------------------------------------------------------
    // Image sync / import (air-gapped clusters)
    // -----------------------------------------------------------------------

    #[tool(
        description = "Check whether skopeo is installed and usable. Call this before image_copy to confirm the host can sync images. Returns the resolved path and version, or an install hint."
    )]
    async fn image_sync_status(&self) -> Result<CallToolResult, McpError> {
        let avail = image_sync::check_skopeo().await;
        json_result(&avail)
    }

    #[tool(
        description = "Copy an image into a configured destination registry using skopeo (air-gapped / offline clusters). `source` is any skopeo transport: docker://nginx:1.25 (public registry), docker-archive:/tmp/img.tar (local docker-save tarball), oci:..., dir:.... The destination registry is resolved by name from the configured image registries (its stored credentials are used automatically). Streams copy progress to the event sink."
    )]
    async fn image_copy(
        &self,
        Parameters(p): Parameters<ImageCopyParams>,
    ) -> Result<CallToolResult, McpError> {
        let sink = self.manager().sink();
        let src_creds = if p.src_creds.is_empty() {
            None
        } else {
            Some(p.src_creds.as_str())
        };
        let result = image_sync::copy_image(
            &p.source,
            &p.dest_registry,
            &p.dest_repo,
            &p.dest_tag,
            src_creds,
            p.insecure_src,
            p.insecure_dest,
            sink,
        )
        .await
        .map_err(tool_error)?;
        json_result(&result)
    }

    #[tool(
        description = "Inspect a local docker-save tarball (or OCI archive) before copying it: returns the image name, tags, digest, architecture, os, and total size. Use this to confirm a tar's contents before image_copy."
    )]
    async fn image_inspect_archive(
        &self,
        Parameters(p): Parameters<ImageArchiveParams>,
    ) -> Result<CallToolResult, McpError> {
        let info = image_archive::inspect_archive(&p.tar_path)
            .await
            .map_err(tool_error)?;
        json_result(&info)
    }

    // -----------------------------------------------------------------------
    // Phase 4 -- Enhanced AI integration tools
    // -----------------------------------------------------------------------

    #[tool(
        description = "Auto-diagnose cluster issues. Checks node health, pod failures, deployment availability, recent warning events, and resource pressure. Returns a structured diagnostic report with severity levels and recommendations."
    )]
    async fn diagnose_cluster(&self) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let mut issues: Vec<serde_json::Value> = Vec::new();

        // Check nodes
        let nodes = kube::Api::<k8s_openapi::api::core::v1::Node>::all(client.clone())
            .list(&Default::default())
            .await
            .map_err(tool_error)?;
        for node in &nodes.items {
            let name = node.metadata.name.clone().unwrap_or_default();
            let conditions = node.status.as_ref().and_then(|s| s.conditions.as_ref());
            if let Some(conds) = conditions {
                for c in conds {
                    if c.type_ == "Ready" && c.status != "True" {
                        issues.push(serde_json::json!({
                            "severity": "critical", "kind": "Node", "name": name,
                            "issue": "NotReady", "message": c.message.as_deref().unwrap_or("")
                        }));
                    }
                    if (c.type_ == "DiskPressure" || c.type_ == "MemoryPressure")
                        && c.status == "True"
                    {
                        issues.push(serde_json::json!({
                            "severity": "warning", "kind": "Node", "name": name,
                            "issue": c.type_, "message": c.message.as_deref().unwrap_or("")
                        }));
                    }
                }
            }
        }

        // Check pods
        let pods = kube::Api::<k8s_openapi::api::core::v1::Pod>::all(client.clone())
            .list(&Default::default())
            .await
            .map_err(tool_error)?;
        let mut failed_count = 0;
        for pod in &pods.items {
            let phase = pod
                .status
                .as_ref()
                .and_then(|s| s.phase.as_deref())
                .unwrap_or("");
            if phase == "Failed" {
                failed_count += 1;
            }
            if let Some(statuses) = pod
                .status
                .as_ref()
                .and_then(|s| s.container_statuses.as_ref())
            {
                for cs in statuses {
                    if let Some(state) = &cs.state {
                        if let Some(waiting) = &state.waiting {
                            if let Some(reason) = &waiting.reason {
                                if reason == "CrashLoopBackOff"
                                    || reason == "ImagePullBackOff"
                                    || reason == "ErrImagePull"
                                {
                                    issues.push(serde_json::json!({
                                        "severity": "critical", "kind": "Pod",
                                        "name": format!("{}/{}", pod.metadata.namespace.as_deref().unwrap_or(""), pod.metadata.name.as_deref().unwrap_or("?")),
                                        "issue": reason,
                                        "message": waiting.message.as_deref().unwrap_or("")
                                    }));
                                }
                            }
                        }
                    }
                }
            }
        }
        if failed_count > 0 {
            issues.push(serde_json::json!({
                "severity": "warning", "kind": "Pods", "name": "cluster-wide",
                "issue": "FailedPods", "message": format!("{failed_count} pods in Failed phase")
            }));
        }

        // Check deployments
        let deployments = kube::Api::<k8s_openapi::api::apps::v1::Deployment>::all(client.clone())
            .list(&Default::default())
            .await
            .map_err(tool_error)?;
        for dep in &deployments.items {
            let name = dep.metadata.name.clone().unwrap_or_default();
            let ns = dep.metadata.namespace.clone().unwrap_or_default();
            let spec_replicas = dep.spec.as_ref().and_then(|s| s.replicas).unwrap_or(1);
            let ready = dep
                .status
                .as_ref()
                .and_then(|s| s.ready_replicas)
                .unwrap_or(0);
            if ready < spec_replicas {
                issues.push(serde_json::json!({
                    "severity": "warning", "kind": "Deployment",
                    "name": format!("{ns}/{name}"),
                    "issue": "Unavailable",
                    "message": format!("{ready}/{spec_replicas} replicas ready")
                }));
            }
        }

        json_result(&serde_json::json!({
            "totalIssues": issues.len(),
            "issues": issues
        }))
    }

    #[tool(
        description = "Suggest fixes for a specific resource problem. Examines the resource's status, conditions, and events to propose actionable fixes (scale, restart, rollback, edit image, etc.)."
    )]
    async fn suggest_fix(
        &self,
        Parameters(p): Parameters<GetResourceParams>,
    ) -> Result<CallToolResult, McpError> {
        let manager = self.manager();
        let kind_id = p.kind.to_lowercase();
        let ns = if p.namespace.is_empty() {
            "default"
        } else {
            &p.namespace
        };

        // Get the resource YAML
        let yaml = kube_api::get_resource_yaml(&manager, &kind_id, ns, &p.name)
            .await
            .map_err(tool_error)?;
        let val: serde_json::Value =
            serde_yaml::from_str(&yaml).map_err(|e| tool_error(AppError::Other(e.to_string())))?;

        // Get events
        let events = kube_api::get_events(&self.manager(), &kind_id, ns, &p.name)
            .await
            .unwrap_or_default();

        let mut suggestions: Vec<serde_json::Value> = Vec::new();

        // Check container statuses for common issues
        if let Some(statuses) = val
            .pointer("/status/containerStatuses")
            .and_then(|s| s.as_array())
        {
            for cs in statuses {
                let state = cs.get("state");
                if let Some(waiting) = state.and_then(|s| s.get("waiting")) {
                    let reason = waiting.get("reason").and_then(|r| r.as_str()).unwrap_or("");
                    match reason {
                        "CrashLoopBackOff" => {
                            suggestions.push(serde_json::json!({
                                "action": "check_logs", "description": "Container is crash-looping. Check logs for the exit reason.",
                                "command": format!("kubectl logs {}/{} --previous", ns, p.name)
                            }));
                            suggestions.push(serde_json::json!({
                                "action": "rollback", "description": "If this started after a recent change, rollback to the previous revision."
                            }));
                        }
                        "ImagePullBackOff" | "ErrImagePull" => {
                            suggestions.push(serde_json::json!({
                                "action": "check_image", "description": "Image pull failed. Verify the image name, tag, and registry credentials."
                            }));
                        }
                        "OOMKilled" | _
                            if cs
                                .pointer("/state/terminated/reason")
                                .and_then(|r| r.as_str())
                                == Some("OOMKilled") =>
                        {
                            suggestions.push(serde_json::json!({
                                "action": "increase_memory", "description": "Container was OOMKilled. Increase memory limits in the pod spec."
                            }));
                        }
                        _ => {}
                    }
                }
            }
        }

        // Check for warning events
        let warning_events: Vec<_> = events.iter().filter(|e| e.ty == "Warning").collect();
        if !warning_events.is_empty() {
            suggestions.push(serde_json::json!({
                "action": "check_events",
                "description": format!("{} warning event(s) found. Most recent: {}", warning_events.len(), warning_events.first().map(|e| e.message.as_str()).unwrap_or(""))
            }));
        }

        if suggestions.is_empty() {
            suggestions.push(serde_json::json!({
                "action": "none", "description": "No obvious issues detected. The resource appears healthy."
            }));
        }

        json_result(&serde_json::json!({
            "kind": kind_id, "name": p.name, "namespace": ns,
            "suggestions": suggestions
        }))
    }

    #[tool(
        description = "Find resources by label selector. Returns matching resources with their key metadata. Useful for finding all pods belonging to a deployment, or all resources with a specific label."
    )]
    async fn find_resources_by_label(
        &self,
        Parameters(p): Parameters<FindByLabelParams>,
    ) -> Result<CallToolResult, McpError> {
        let manager = self.manager();
        let kind_id = p.kind.to_lowercase();
        let ns = p.namespace.as_deref();
        let results = kube_api::list_resources(&manager, &kind_id, ns, Some(&p.selector))
            .await
            .map_err(tool_error)?;
        json_result(&serde_json::json!({ "count": results.len(), "items": results }))
    }

    #[tool(
        description = "Create an AlertManager silence to suppress matching alerts for a duration. matchers is an array of {name, value, isRegex}; durationHours sets the silence length (default 4h). Returns the silence ID."
    )]
    async fn create_silence(
        &self,
        Parameters(p): Parameters<CreateSilenceParams>,
    ) -> Result<CallToolResult, McpError> {
        let ends_at = (chrono::Utc::now() + chrono::Duration::hours(p.duration_hours.unwrap_or(4)))
            .to_rfc3339();
        let request = alerting::CreateSilenceRequest {
            matchers: p
                .matchers
                .iter()
                .map(|m| alerting::SilenceMatcher {
                    name: m.name.clone(),
                    value: m.value.clone(),
                    is_regex: m.is_regex.unwrap_or(false),
                })
                .collect(),
            comment: p.comment.unwrap_or_default(),
            created_by: "k7s-mcp".to_string(),
            starts_at: String::new(),
            ends_at,
        };
        let id = alerting::create_silence(&p.instance, &request)
            .await
            .map_err(tool_error)?;
        json_result(&serde_json::json!({ "silenceId": id }))
    }

    #[tool(
        description = "Expire (delete) an AlertManager silence by ID. The silence will immediately stop suppressing alerts."
    )]
    async fn delete_silence(
        &self,
        Parameters(p): Parameters<DeleteSilenceParams>,
    ) -> Result<CallToolResult, McpError> {
        alerting::delete_silence(&p.instance, &p.silence_id)
            .await
            .map_err(tool_error)?;
        json_result(&serde_json::json!({ "deleted": true }))
    }

    #[tool(
        description = "List alerting rules from a Prometheus instance. Returns rule groups with their alerting rules (name, state, severity, query, duration)."
    )]
    async fn list_alert_rules(
        &self,
        Parameters(p): Parameters<InstanceNameParams>,
    ) -> Result<CallToolResult, McpError> {
        let groups = alerting::prometheus_rules(&p.name)
            .await
            .map_err(tool_error)?;
        json_result(&groups)
    }

    #[tool(
        description = "Search K8s audit logs from a configured Loki instance. Filters: namespace, resource, user, sinceSeconds (default 3600), limit (default 200). Returns parsed audit events with verb, resource, user, status code, and timestamps."
    )]
    async fn audit_search(
        &self,
        Parameters(p): Parameters<AuditSearchParams>,
    ) -> Result<CallToolResult, McpError> {
        let query = crate::kube::audit::AuditQuery {
            instance: p.instance,
            namespace: p.namespace.unwrap_or_default(),
            resource: p.resource.unwrap_or_default(),
            user: p.user.unwrap_or_default(),
            since_seconds: p.since_seconds.unwrap_or(3600),
            limit: p.limit.unwrap_or(200) as usize,
        };
        let events = crate::kube::audit::query_audit_events(&query)
            .await
            .map_err(tool_error)?;
        json_result(&events)
    }

    #[tool(
        description = "Search Grafana dashboards by query string. Returns matching dashboards with uid, title, tags, and URL. Use grafana_dashboard_url with the returned uid to build an embeddable URL."
    )]
    async fn grafana_search(
        &self,
        Parameters(p): Parameters<GrafanaSearchParams>,
    ) -> Result<CallToolResult, McpError> {
        let results = grafana::search_dashboards(&p.name, &p.query)
            .await
            .map_err(tool_error)?;
        json_result(&results)
    }

    // -----------------------------------------------------------------------
    // SBOM tools
    // -----------------------------------------------------------------------

    #[tool(
        description = "Generate an SBOM (Software Bill of Materials) for a container image. Uses trivy, grype, or a native fallback. Returns the SBOM id, component count, vulnerability count, and tool used. Optionally correlate vulnerabilities with the SBOM."
    )]
    async fn sbom_generate_image(
        &self,
        Parameters(p): Parameters<SbomGenerateParams>,
    ) -> Result<CallToolResult, McpError> {
        let format = crate::kube::sbom::SbomFormat::parse(&p.format)
            .unwrap_or(crate::kube::sbom::SbomFormat::CycloneDx);
        let engine = crate::kube::sbom::SbomEngine::new();
        let sbom = engine
            .generate_with_vulns(&p.image_ref, &format)
            .await
            .map_err(tool_error)?;
        let storage = crate::kube::sbom_storage::SbomStorage::new(&self.core.data_dir);
        let _ = storage.save(&sbom);
        json_result(&serde_json::json!({
            "id": sbom.id,
            "components": sbom.components.len(),
            "vulnerabilities": sbom.vulnerabilities.len(),
            "tool": sbom.metadata.tool,
        }))
    }

    #[tool(
        description = "List all SBOM scan history entries. Returns id, image reference, format, component count, vulnerability count, tool, and creation time."
    )]
    async fn sbom_list_history(&self) -> Result<CallToolResult, McpError> {
        let storage = crate::kube::sbom_storage::SbomStorage::new(&self.core.data_dir);
        let list = storage.list().map_err(tool_error)?;
        json_result(&list)
    }

    #[tool(
        description = "Get the full SBOM details by ID. Returns components (name, version, type), vulnerabilities, format, and metadata."
    )]
    async fn sbom_get(
        &self,
        Parameters(p): Parameters<SbomGetParams>,
    ) -> Result<CallToolResult, McpError> {
        let storage = crate::kube::sbom_storage::SbomStorage::new(&self.core.data_dir);
        let sbom = storage.load(&p.id).map_err(tool_error)?;
        // Serialize via serde to get consistent camelCase keys
        json_result(&serde_json::to_value(&sbom).map_err(tool_error)?)
    }

    #[tool(
        description = "Get the current cluster health score (0-100, letter grade A-F) with individual check results for node readiness, pod health, deployment availability, resource pressure, PVC status, and more."
    )]
    async fn cluster_health(&self) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;

        let nodes = kube::Api::<k8s_openapi::api::core::v1::Node>::all(client.clone())
            .list(&Default::default())
            .await
            .map_err(tool_error)?;
        let pods = kube::Api::<k8s_openapi::api::core::v1::Pod>::all(client.clone())
            .list(&Default::default())
            .await
            .map_err(tool_error)?;
        let deployments = kube::Api::<k8s_openapi::api::apps::v1::Deployment>::all(client.clone())
            .list(&Default::default())
            .await
            .map_err(tool_error)?;

        let ready_nodes = nodes
            .items
            .iter()
            .filter(|n| {
                n.status
                    .as_ref()
                    .and_then(|s| s.conditions.as_ref())
                    .map(|c| c.iter().any(|c| c.type_ == "Ready" && c.status == "True"))
                    .unwrap_or(false)
            })
            .count();

        let running_pods = pods
            .items
            .iter()
            .filter(|p| p.status.as_ref().and_then(|s| s.phase.as_deref()) == Some("Running"))
            .count();

        let total_nodes = nodes.items.len();
        let total_pods = pods.items.len();

        json_result(&serde_json::json!({
            "nodes": { "ready": ready_nodes, "total": total_nodes },
            "pods": { "running": running_pods, "total": total_pods },
            "deployments": deployments.items.len(),
        }))
    }

    // === New tools (shared impls layer) ===

    #[tool(
        description = "Batch-get multiple resources at once. Pass an array of {kind, namespace, name} objects. Returns all results in one response — much faster than calling describe_resource N times."
    )]
    async fn batch_get(
        &self,
        Parameters(p): Parameters<BatchGetParams>,
    ) -> Result<CallToolResult, McpError> {
        let result = crate::ai::tools::impls::batch_get_impl(&self.manager(), &p.requests)
            .await
            .map_err(tool_error)?;
        json_result(&result)
    }

    #[tool(
        description = "Compare two resources or two versions of the same resource. Returns whether they're identical and their YAML line counts."
    )]
    async fn diff_resources(
        &self,
        Parameters(p): Parameters<DiffResourcesParams>,
    ) -> Result<CallToolResult, McpError> {
        let result = crate::ai::tools::impls::diff_resources_impl(
            &self.manager(),
            &p.kind,
            &p.namespace_a,
            &p.name_a,
            &p.namespace_b,
            &p.name_b,
        )
        .await
        .map_err(tool_error)?;
        json_result(&result)
    }

    #[tool(
        description = "Get HPA (HorizontalPodAutoscaler) status for a namespace. Shows min/max/current replicas and target metrics."
    )]
    async fn hpa_status(
        &self,
        Parameters(p): Parameters<HpaStatusParams>,
    ) -> Result<CallToolResult, McpError> {
        let result = crate::ai::tools::impls::hpa_status_impl(&self.manager(), &p.namespace)
            .await
            .map_err(tool_error)?;
        json_result(&result)
    }

    #[tool(
        description = "Audit NetworkPolicies in a namespace. Shows which pods are isolated, what ingress/egress rules exist, and identifies pods with no matching policies."
    )]
    async fn network_policy_audit(
        &self,
        Parameters(p): Parameters<NamespaceParam>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let nps: kube::Api<k8s_openapi::api::networking::v1::NetworkPolicy> =
            kube::Api::namespaced(client.clone(), &p.namespace);
        let list = nps.list(&Default::default()).await.map_err(tool_error)?;

        let pods: kube::Api<k8s_openapi::api::core::v1::Pod> =
            kube::Api::namespaced(client, &p.namespace);
        let pod_list = pods.list(&Default::default()).await.map_err(tool_error)?;

        let mut policies: Vec<serde_json::Value> = Vec::new();
        for np in &list {
            let name = np.metadata.name.clone().unwrap_or_default();
            let pod_selector = np
                .spec
                .as_ref()
                .and_then(|s| s.pod_selector.as_ref())
                .map(|ps| {
                    ps.match_labels
                        .as_ref()
                        .map(|m| {
                            m.iter()
                                .map(|(k, v)| format!("{k}={v}"))
                                .collect::<Vec<_>>()
                                .join(", ")
                        })
                        .unwrap_or_default()
                })
                .unwrap_or_default();
            let ingress_rules = np
                .spec
                .as_ref()
                .and_then(|s| s.ingress.as_ref())
                .map(|r| r.len())
                .unwrap_or(0);
            let egress_rules = np
                .spec
                .as_ref()
                .and_then(|s| s.egress.as_ref())
                .map(|r| r.len())
                .unwrap_or(0);
            policies.push(serde_json::json!({
                "name": name,
                "podSelector": pod_selector,
                "ingressRules": ingress_rules,
                "egressRules": egress_rules,
            }));
        }

        let isolated_pod_count = pod_list.items.len(); // simplified
        json_result(&serde_json::json!({
            "namespace": p.namespace,
            "policies": policies,
            "totalPods": pod_list.items.len(),
            "note": "Pods without matching NetworkPolicies are isolated by default when any policy exists in the namespace.",
        }))
    }

    #[tool(
        description = "RBAC 'who can' query: check who can perform a verb on a resource in a namespace. Returns matching ClusterRoleBindings and RoleBindings."
    )]
    async fn rbac_who_can(
        &self,
        Parameters(p): Parameters<RbacWhoCanParams>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;

        // Check ClusterRoleBindings
        let crbs: kube::Api<k8s_openapi::api::rbac::v1::ClusterRoleBinding> =
            kube::Api::all(client.clone());
        let crb_list = crbs.list(&Default::default()).await.map_err(tool_error)?;

        let mut matches: Vec<serde_json::Value> = Vec::new();
        for crb in &crb_list {
            let role_ref = crb
                .spec
                .as_ref()
                .map(|s| s.role_ref.name.clone())
                .unwrap_or_default();
            let subjects: Vec<String> = crb
                .spec
                .as_ref()
                .and_then(|s| {
                    Some(
                        s.subjects
                            .as_ref()?
                            .iter()
                            .map(|s| format!("{}:{}", s.kind, s.name))
                            .collect(),
                    )
                })
                .unwrap_or_default();
            if !subjects.is_empty() {
                matches.push(serde_json::json!({
                    "binding": crb.metadata.name.clone().unwrap_or_default(),
                    "type": "ClusterRoleBinding",
                    "role": role_ref,
                    "subjects": subjects,
                }));
            }
        }

        // Check RoleBindings in namespace
        if !p.namespace.is_empty() {
            let rbs: kube::Api<k8s_openapi::api::rbac::v1::RoleBinding> =
                kube::Api::namespaced(client, &p.namespace);
            let rb_list = rbs.list(&Default::default()).await.map_err(tool_error)?;
            for rb in &rb_list {
                let role_ref = rb
                    .spec
                    .as_ref()
                    .map(|s| s.role_ref.name.clone())
                    .unwrap_or_default();
                let subjects: Vec<String> = rb
                    .spec
                    .as_ref()
                    .and_then(|s| {
                        Some(
                            s.subjects
                                .as_ref()?
                                .iter()
                                .map(|s| format!("{}:{}", s.kind, s.name))
                                .collect(),
                        )
                    })
                    .unwrap_or_default();
                if !subjects.is_empty() {
                    matches.push(serde_json::json!({
                        "binding": rb.metadata.name.clone().unwrap_or_default(),
                        "type": "RoleBinding",
                        "namespace": p.namespace,
                        "role": role_ref,
                        "subjects": subjects,
                    }));
                }
            }
        }

        json_result(&serde_json::json!({
            "verb": p.verb,
            "resource": p.resource,
            "namespace": p.namespace,
            "matches": matches,
        }))
    }

    // === Consolidated tools (replace multiple single-purpose tools) ===

    #[tool(
        description = "Unified Helm release operation. action: install|upgrade|uninstall|rollback. Consolidates helm_install, helm_upgrade, helm_uninstall, helm_rollback into one tool."
    )]
    async fn helm_release(
        &self,
        Parameters(p): Parameters<HelmReleaseParams>,
    ) -> Result<CallToolResult, McpError> {
        match p.action.as_str() {
            "install" => {
                let params = super::params::HelmInstallParams {
                    name: p.name.unwrap_or_default(),
                    chart: p.chart.unwrap_or_default(),
                    namespace: p.namespace.unwrap_or_default(),
                    values: p.values,
                };
                self.helm_install(Parameters(params)).await
            }
            "upgrade" => {
                let params = super::params::HelmUpgradeParams {
                    name: p.name.unwrap_or_default(),
                    chart: p.chart.unwrap_or_default(),
                    namespace: p.namespace.unwrap_or_default(),
                    values: p.values,
                };
                self.helm_upgrade(Parameters(params)).await
            }
            "uninstall" => {
                let params = super::params::HelmUninstallParams {
                    name: p.name.unwrap_or_default(),
                    namespace: p.namespace.unwrap_or_default(),
                };
                self.helm_uninstall(Parameters(params)).await
            }
            "rollback" => {
                let params = super::params::HelmRollbackParams {
                    name: p.name.unwrap_or_default(),
                    namespace: p.namespace.unwrap_or_default(),
                    revision: p.revision.unwrap_or(0),
                };
                self.helm_rollback(Parameters(params)).await
            }
            _ => Err(McpError::invalid_params(
                format!(
                    "unknown action '{}': use install|upgrade|uninstall|rollback",
                    p.action
                ),
                None,
            )),
        }
    }

    #[tool(
        description = "Unified port-forward operation. action: start|stop|list. Consolidates start_port_forward, start_service_port_forward, stop_port_forward, list_port_forwards."
    )]
    async fn port_forward(
        &self,
        Parameters(p): Parameters<PortForwardParams>,
    ) -> Result<CallToolResult, McpError> {
        match p.action.as_str() {
            "start" => {
                let params = super::params::StartPortForwardParams {
                    namespace: p.namespace.unwrap_or_default(),
                    pod: p.pod.unwrap_or_default(),
                    container_port: p.container_port.unwrap_or(0),
                    local_port: p.local_port,
                };
                self.start_port_forward(Parameters(params)).await
            }
            "stop" => {
                let params = super::params::StopForwardParams {
                    id: p.id.unwrap_or_default(),
                };
                self.stop_port_forward(Parameters(params)).await
            }
            "list" => self.list_port_forwards().await,
            _ => Err(McpError::invalid_params(
                format!("unknown action '{}': use start|stop|list", p.action),
                None,
            )),
        }
    }

    #[tool(
        description = "Unified Prometheus query. Set range=true with start/end/step for range queries, or omit for instant queries. Consolidates prometheus_query and prometheus_query_range."
    )]
    async fn prometheus_query_unified(
        &self,
        Parameters(p): Parameters<PrometheusUnifiedParams>,
    ) -> Result<CallToolResult, McpError> {
        if p.range.unwrap_or(false) {
            let params = super::params::PromQueryRangeParams {
                instance: p.instance.unwrap_or_default(),
                query: p.query,
                start: p.start.unwrap_or_default(),
                end: p.end.unwrap_or_default(),
                step: p.step.unwrap_or_default(),
            };
            self.prometheus_query_range(Parameters(params)).await
        } else {
            let params = super::params::PromQueryParams {
                instance: p.instance.unwrap_or_default(),
                query: p.query,
            };
            self.prometheus_query(Parameters(params)).await
        }
    }

    #[tool(
        description = "Unified SBOM operation. action: generate|list|get. Consolidates sbom_generate_image, sbom_list_history, sbom_get."
    )]
    async fn sbom_unified(
        &self,
        Parameters(p): Parameters<SbomUnifiedParams>,
    ) -> Result<CallToolResult, McpError> {
        match p.action.as_str() {
            "generate" => {
                let params = super::params::SbomGenerateParams {
                    image: p.image.unwrap_or_default(),
                    namespace: p.namespace,
                };
                self.sbom_generate_image(Parameters(params)).await
            }
            "list" => self.sbom_list_history().await,
            "get" => {
                let params = super::params::SbomGetParams {
                    id: p.id.unwrap_or_default(),
                };
                self.sbom_get(Parameters(params)).await
            }
            _ => Err(McpError::invalid_params(
                format!("unknown action '{}': use generate|list|get", p.action),
                None,
            )),
        }
    }

    #[tool(
        description = "Unified AlertManager silence operation. action: create|delete. Consolidates create_silence and delete_silence."
    )]
    async fn silence(
        &self,
        Parameters(p): Parameters<SilenceUnifiedParams>,
    ) -> Result<CallToolResult, McpError> {
        match p.action.as_str() {
            "create" => {
                let params = super::params::CreateSilenceParams {
                    instance: p.instance.unwrap_or_default(),
                    matchers: p.matchers.unwrap_or_default(),
                    starts_at: p.starts_at.unwrap_or_default(),
                    ends_at: p.ends_at.unwrap_or_default(),
                    creator: p.creator.unwrap_or_default(),
                    comment: p.comment.unwrap_or_default(),
                };
                self.create_silence(Parameters(params)).await
            }
            "delete" => {
                let params = super::params::DeleteSilenceParams {
                    instance: p.instance.unwrap_or_default(),
                    silence_id: p.silence_id.unwrap_or_default(),
                };
                self.delete_silence(Parameters(params)).await
            }
            _ => Err(McpError::invalid_params(
                format!("unknown action '{}': use create|delete", p.action),
                None,
            )),
        }
    }

    #[tool(
        description = "Unified kind discovery. scope: builtin|custom|all. Consolidates list_builtin_kinds, list_custom_kinds, list_api_resources."
    )]
    async fn list_kinds(
        &self,
        Parameters(p): Parameters<ListKindsParams>,
    ) -> Result<CallToolResult, McpError> {
        match p.scope.as_str() {
            "builtin" => self.list_builtin_kinds().await,
            "custom" => self.list_custom_kinds().await,
            "all" => {
                let builtin = crate::kube::ResourceKind::all()
                    .iter()
                    .map(|k| serde_json::json!({"id": k.id(), "name": k.display_name()}))
                    .collect::<Vec<_>>();
                let custom = self.manager().custom_kinds_list().await;
                json_result(&serde_json::json!({
                    "builtin": builtin,
                    "custom": custom,
                }))
            }
            _ => Err(McpError::invalid_params(
                format!("unknown scope '{}': use builtin|custom|all", p.scope),
                None,
            )),
        }
    }

    #[tool(
        description = "Estimate resource costs for a namespace. Lists all pods with their CPU/memory requests and calculates approximate monthly cost based on standard cloud pricing."
    )]
    async fn cost_estimate(
        &self,
        Parameters(p): Parameters<NamespaceParam>,
    ) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let pods: kube::Api<k8s_openapi::api::core::v1::Pod> =
            kube::Api::namespaced(client, &p.namespace);
        let list = pods.list(&Default::default()).await.map_err(tool_error)?;

        let mut total_cpu_millis: i64 = 0;
        let mut total_mem_bytes: i64 = 0;
        let mut pod_costs: Vec<serde_json::Value> = Vec::new();

        for pod in &list.items {
            let name = pod.metadata.name.clone().unwrap_or_default();
            let mut cpu_millis: i64 = 0;
            let mut mem_bytes: i64 = 0;
            if let Some(spec) = &pod.spec {
                for container in &spec.containers {
                    if let Some(res) = &container.resources {
                        if let Some(reqs) = &res.requests {
                            if let Some(cpu) = reqs.get("cpu") {
                                cpu_millis += parse_cpu_millis(&cpu.0);
                            }
                            if let Some(mem) = reqs.get("memory") {
                                mem_bytes += parse_mem_bytes(&mem.0);
                            }
                        }
                    }
                }
            }
            total_cpu_millis += cpu_millis;
            total_mem_bytes += mem_bytes;
            pod_costs.push(serde_json::json!({
                "name": name,
                "cpuMillis": cpu_millis,
                "memBytes": mem_bytes,
            }));
        }

        // Rough cloud pricing: $0.03/vCPU-hour, $0.004/GB-hour
        let cpu_hours = total_cpu_millis as f64 / 1000.0 / 3600.0 * 730.0; // monthly
        let mem_gb_hours = total_mem_bytes as f64 / 1_073_741_824.0 / 3600.0 * 730.0;
        let estimated_monthly_usd = cpu_hours * 0.03 + mem_gb_hours * 0.004;

        json_result(&serde_json::json!({
            "namespace": p.namespace,
            "podCount": list.items.len(),
            "totalCpuMillis": total_cpu_millis,
            "totalMemBytes": total_mem_bytes,
            "estimatedMonthlyUsd": (estimated_monthly_usd * 100.0).round() / 100.0,
            "pods": pod_costs,
        }))
    }
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
             SBOM: `sbom_generate_image` / `sbom_list_history` / `sbom_get`. \
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

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
        let custom = k7s_core::kube::discovery::discover(&kube_client).await;
        manager.set_custom_kinds(custom).await;

        manager
            .set_connected(
                kube_client,
                k7s_core::kube::manager::ConnectionInfo {
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
        Ok(CallToolResult::success(vec![Content::text("disconnected")]))
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

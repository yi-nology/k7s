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
        Ok(CallToolResult::success(vec![Content::text(yaml)]))
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
        Ok(CallToolResult::success(vec![Content::text(logs)]))
    }

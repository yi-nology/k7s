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
        let obj: DynamicObject = k7s_deps::yaml_serde::from_str(&p.yaml)
            .map_err(|e| tool_error(AppError::Other(e.to_string())))?;
        api.replace(&p.name, &PostParams::default(), &obj)
            .await
            .map(|_| ())
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![Content::text(format!(
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
        let obj: DynamicObject = k7s_deps::yaml_serde::from_str(&p.yaml)
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

        let current_yaml = k7s_deps::yaml_serde::to_string(&current)
            .map_err(|e| tool_error(AppError::Other(e.to_string())))?;
        let proposed_yaml = k7s_deps::yaml_serde::to_string(&proposed)
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
        Ok(CallToolResult::success(vec![Content::text("deleted")]))
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
        let patch = Patch::Merge(k7s_deps::serde_json::json!({ "spec": { "replicas": p.replicas } }));
        api.patch(&p.name, &PatchParams::default(), &patch)
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![Content::text(format!(
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
            Patch::Merge(k7s_deps::serde_json::json!({ "spec": { "unschedulable": p.unschedulable } }));
        api.patch(&p.name, &PatchParams::default(), &patch)
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![Content::text(format!(
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
        Ok(CallToolResult::success(vec![Content::text(format!(
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
        let now = k7s_deps::chrono::Utc::now().to_rfc3339();
        let patch = Patch::Merge(restart::restart_patch(&now));
        api.patch(&p.name, &PatchParams::default(), &patch)
            .await
            .map_err(|e| tool_error(AppError::Kube(e.to_string())))?;
        Ok(CallToolResult::success(vec![Content::text(format!(
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
        Ok(CallToolResult::success(vec![Content::text(format!(
            "drain started for node {}{}",
            p.node,
            timeout
                .map(|t| format!(" (timeout: {}s)", t.as_secs()))
                .unwrap_or_default()
        ))]))
    }

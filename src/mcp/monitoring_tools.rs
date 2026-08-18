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
        Ok(CallToolResult::success(vec![Content::text(url)]))
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
        let mut issues: Vec<k7s_deps::serde_json::Value> = Vec::new();

        // Check nodes
        let nodes: Vec<k7s_deps::k8s_openapi::api::core::v1::Node> = k7s_deps::kube::Api::all(client.clone())
            .list(&Default::default())
            .await
            .map_err(tool_error)?;
        for node in &nodes.items {
            let name = node.metadata.name.clone().unwrap_or_default();
            let conditions = node.status.as_ref().and_then(|s| s.conditions.as_ref());
            if let Some(conds) = conditions {
                for c in conds {
                    if c.type_ == "Ready" && c.status != "True" {
                        issues.push(k7s_deps::serde_json::json!({
                            "severity": "critical", "kind": "Node", "name": name,
                            "issue": "NotReady", "message": c.message.as_deref().unwrap_or("")
                        }));
                    }
                    if (c.type_ == "DiskPressure" || c.type_ == "MemoryPressure")
                        && c.status == "True"
                    {
                        issues.push(k7s_deps::serde_json::json!({
                            "severity": "warning", "kind": "Node", "name": name,
                            "issue": c.type_, "message": c.message.as_deref().unwrap_or("")
                        }));
                    }
                }
            }
        }

        // Check pods
        let pods: Vec<k7s_deps::k8s_openapi::api::core::v1::Pod> =
            k7s_deps::kube::Api::<k7s_deps::k8s_openapi::api::core::v1::Pod>::all(client.clone())
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
                    if let Some(waiting) = &cs.waiting {
                        if let Some(reason) = &waiting.reason {
                            if reason == "CrashLoopBackOff"
                                || reason == "ImagePullBackOff"
                                || reason == "ErrImagePull"
                            {
                                issues.push(k7s_deps::serde_json::json!({
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
        if failed_count > 0 {
            issues.push(k7s_deps::serde_json::json!({
                "severity": "warning", "kind": "Pods", "name": "cluster-wide",
                "issue": "FailedPods", "message": format!("{failed_count} pods in Failed phase")
            }));
        }

        // Check deployments
        let deployments: Vec<k7s_deps::k8s_openapi::api::apps::v1::Deployment> =
            k7s_deps::kube::Api::all(client.clone())
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
                issues.push(k7s_deps::serde_json::json!({
                    "severity": "warning", "kind": "Deployment",
                    "name": format!("{ns}/{name}"),
                    "issue": "Unavailable",
                    "message": format!("{ready}/{spec_replicas} replicas ready")
                }));
            }
        }

        json_result(&k7s_deps::serde_json::json!({
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
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;
        let kind_id = p.kind.to_lowercase();
        let ns = p.namespace.as_deref().unwrap_or("default");

        // Get the resource YAML
        let yaml = kube_api::get_resource_yaml(&client, &kind_id, ns, &p.name)
            .await
            .map_err(tool_error)?;
        let val: k7s_deps::serde_json::Value =
            k7s_deps::yaml_serde::from_str(&yaml).map_err(|e| tool_error(AppError::Other(e.to_string())))?;

        // Get events
        let events = kube_api::get_object_events(&client, &kind_id, ns, &p.name)
            .await
            .unwrap_or_default();

        let mut suggestions: Vec<k7s_deps::serde_json::Value> = Vec::new();

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
                            suggestions.push(k7s_deps::serde_json::json!({
                                "action": "check_logs", "description": "Container is crash-looping. Check logs for the exit reason.",
                                "command": format!("kubectl logs {}/{} --previous", ns, p.name)
                            }));
                            suggestions.push(k7s_deps::serde_json::json!({
                                "action": "rollback", "description": "If this started after a recent change, rollback to the previous revision."
                            }));
                        }
                        "ImagePullBackOff" | "ErrImagePull" => {
                            suggestions.push(k7s_deps::serde_json::json!({
                                "action": "check_image", "description": "Image pull failed. Verify the image name, tag, and registry credentials."
                            }));
                        }
                        "OOMKilled" | _
                            if cs
                                .pointer("/state/terminated/reason")
                                .and_then(|r| r.as_str())
                                == Some("OOMKilled") =>
                        {
                            suggestions.push(k7s_deps::serde_json::json!({
                                "action": "increase_memory", "description": "Container was OOMKilled. Increase memory limits in the pod spec."
                            }));
                        }
                        _ => {}
                    }
                }
            }
        }

        // Check for warning events
        let warning_events: Vec<_> = events.iter().filter(|e| e.0 == "Warning").collect();
        if !warning_events.is_empty() {
            suggestions.push(k7s_deps::serde_json::json!({
                "action": "check_events",
                "description": format!("{} warning event(s) found. Most recent: {}", warning_events.len(), warning_events.first().map(|e| e.2.as_str()).unwrap_or(""))
            }));
        }

        if suggestions.is_empty() {
            suggestions.push(k7s_deps::serde_json::json!({
                "action": "none", "description": "No obvious issues detected. The resource appears healthy."
            }));
        }

        json_result(&k7s_deps::serde_json::json!({
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
        json_result(&k7s_deps::serde_json::json!({ "count": results.len(), "items": results }))
    }

    #[tool(
        description = "Create an AlertManager silence to suppress matching alerts for a duration. matchers is an array of {name, value, isRegex}; durationHours sets the silence length (default 4h). Returns the silence ID."
    )]
    async fn create_silence(
        &self,
        Parameters(p): Parameters<CreateSilenceParams>,
    ) -> Result<CallToolResult, McpError> {
        let ends_at = (k7s_deps::chrono::Utc::now() + k7s_deps::chrono::Duration::hours(p.duration_hours.unwrap_or(4)))
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
        json_result(&k7s_deps::serde_json::json!({ "silenceId": id }))
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
        json_result(&k7s_deps::serde_json::json!({ "deleted": true }))
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
        let query = k7s_core::kube::audit::AuditQuery {
            instance: p.instance,
            namespace: p.namespace.unwrap_or_default(),
            resource: p.resource.unwrap_or_default(),
            user: p.user.unwrap_or_default(),
            since_seconds: p.since_seconds.unwrap_or(3600),
            limit: p.limit.unwrap_or(200) as usize,
        };
        let events = k7s_core::kube::audit::query_audit_events(&query)
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

    #[tool(
        description = "Get the current cluster health score (0-100, letter grade A-F) with individual check results for node readiness, pod health, deployment availability, resource pressure, PVC status, and more."
    )]
    async fn cluster_health(&self) -> Result<CallToolResult, McpError> {
        let client = kube_api::require_client(&self.manager())
            .await
            .map_err(tool_error)?;

        let nodes: Vec<k7s_deps::k8s_openapi::api::core::v1::Node> = k7s_deps::kube::Api::all(client.clone())
            .list(&Default::default())
            .await
            .map_err(tool_error)?;
        let pods: Vec<k7s_deps::k8s_openapi::api::core::v1::Pod> = k7s_deps::kube::Api::all(client.clone())
            .list(&Default::default())
            .await
            .map_err(tool_error)?;
        let deployments: Vec<k7s_deps::k8s_openapi::api::apps::v1::Deployment> =
            k7s_deps::kube::Api::all(client.clone())
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

        json_result(&k7s_deps::serde_json::json!({
            "nodes": { "ready": ready_nodes, "total": total_nodes },
            "pods": { "running": running_pods, "total": total_pods },
            "deployments": deployments.items.len(),
        }))
    }

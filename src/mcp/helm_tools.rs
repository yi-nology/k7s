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
        Ok(CallToolResult::success(vec![Content::text(values)]))
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
        Ok(CallToolResult::success(vec![Content::text("removed")]))
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

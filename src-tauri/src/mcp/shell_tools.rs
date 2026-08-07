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
        Ok(CallToolResult::success(vec![Content::text("stopped")]))
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
        Ok(CallToolResult::success(vec![Content::text("ok")]))
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
        // handles the 404-cache-lag window right after create. On timeout we do
        // the best-effort pod cleanup (the helper deliberately does not delete).
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
        Ok(CallToolResult::success(vec![Content::text("stopped")]))
    }

    // -----------------------------------------------------------------------
    // Convenience getters
    // -----------------------------------------------------------------------

    #[tool(
        description = "Default path to kubectl's kubeconfig, used to pre-point the import dialog in the UI. Read-only."
    )]
    async fn default_kubeconfig_path(&self) -> Result<CallToolResult, McpError> {
        Ok(CallToolResult::success(vec![Content::text(
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
        Ok(CallToolResult::success(vec![Content::text(out)]))
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
        Ok(CallToolResult::success(vec![Content::text(format!(
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
        Ok(CallToolResult::success(vec![Content::text(text)]))
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
        Ok(CallToolResult::success(vec![Content::text("written")]))
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
        Ok(CallToolResult::success(vec![Content::text(b64)]))
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
        Ok(CallToolResult::success(vec![Content::text("uploaded")]))
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

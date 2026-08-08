//! Diagnostic tools. These are read-only (no `is_write` override) but do more
//! than a single kube call: they aggregate several reads and return a curated
//! problem list, so the LLM can answer "what's wrong?" in one shot instead of
//! chaining list→describe→events→logs itself.

use crate::ai::error::AiResult;
use crate::ai::tools::{get_opt_str, ok_value, require_client, Tool, ToolContext};
use async_trait::async_trait;
use kube::api::Api;
use kube::ResourceExt;
use serde::Serialize;

#[derive(Serialize)]
struct Problem {
    severity: &'static str, // "warning" | "critical"
    resource: String,       // "namespace/name" or just "name"
    kind: &'static str,     // "node" | "pod" | "deployment"
    reason: String,
}

pub struct DiagnoseUnhealthy;

#[async_trait]
impl Tool for DiagnoseUnhealthy {
    fn name(&self) -> &str {
        "diagnose_unhealthy"
    }
    fn description(&self) -> &str {
        "Scan the cluster (optionally scoped to one namespace) for unhealthy \
         resources and return a structured problem list: NotReady nodes, \
         CrashLoopBackOff/ImagePullBackOff pods, deployments with unavailable \
         replicas. Use this when the user asks 'what's wrong / is something \
         broken / diagnose the cluster'. Follow up with describe_resource + \
         get_events + get_pod_logs on any problem to explain root cause."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "namespace": {
                    "type": "string",
                    "description": "Scope the scan to one namespace. Omit/empty for all."
                }
            }
        })
    }
    async fn call(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        let namespace = get_opt_str(&args, "namespace");
        let client = require_client(&ctx.manager).await?;
        let mut problems: Vec<Problem> = Vec::new();

        // Nodes.
        let nodes: kube::api::ObjectList<k8s_openapi::api::core::v1::Node> =
            Api::all(client.clone())
                .list(&Default::default())
                .await
                .map_err(|e| crate::ai::error::AiError::Tool(e.to_string()))?;
        for n in nodes {
            let name = n.name_any();
            if let Some(conds) = n.status.as_ref().and_then(|s| s.conditions.as_ref()) {
                for c in conds {
                    if c.type_ == "Ready" && c.status != "True" {
                        problems.push(Problem {
                            severity: "critical",
                            resource: name.clone(),
                            kind: "node",
                            reason: "NotReady".into(),
                        });
                    }
                    if c.status == "True"
                        && matches!(
                            c.type_.as_str(),
                            "DiskPressure"
                                | "MemoryPressure"
                                | "PIDPressure"
                                | "NetworkUnavailable"
                        )
                    {
                        problems.push(Problem {
                            severity: "warning",
                            resource: name.clone(),
                            kind: "node",
                            reason: c.type_.clone(),
                        });
                    }
                }
            }
        }

        // Pods.
        let pods: kube::api::ObjectList<k8s_openapi::api::core::v1::Pod> = match &namespace {
            Some(ns) => Api::namespaced(client.clone(), ns),
            None => Api::all(client.clone()),
        }
        .list(&Default::default())
        .await
        .map_err(|e| crate::ai::error::AiError::Tool(e.to_string()))?;
        for p in pods {
            let ns = p.metadata.namespace.clone().unwrap_or_default();
            let full = if ns.is_empty() {
                p.name_any()
            } else {
                format!("{}/{}", ns, p.name_any())
            };
            let phase = p
                .status
                .as_ref()
                .and_then(|s| s.phase.as_deref())
                .unwrap_or("");
            if phase == "Failed" {
                problems.push(Problem {
                    severity: "warning",
                    resource: full.clone(),
                    kind: "pod",
                    reason: "Failed".into(),
                });
            }
            if let Some(cs) = p
                .status
                .as_ref()
                .and_then(|s| s.container_statuses.as_ref())
            {
                for c in cs {
                    if let Some(w) = c.state.as_ref().and_then(|s| s.waiting.as_ref()) {
                        let reason = w.reason.as_deref().unwrap_or("Waiting");
                        if matches!(
                            reason,
                            "CrashLoopBackOff"
                                | "ImagePullBackOff"
                                | "ErrImagePull"
                                | "CreateContainerConfigError"
                                | "CreateContainerError"
                                | "InvalidImageName"
                        ) {
                            problems.push(Problem {
                                severity: "critical",
                                resource: full.clone(),
                                kind: "pod",
                                reason: reason.to_string(),
                            });
                        }
                    }
                    if let Some(t) = c.state.as_ref().and_then(|s| s.terminated.as_ref()) {
                        if t.reason.as_deref().unwrap_or("Completed") != "Completed" {
                            problems.push(Problem {
                                severity: "warning",
                                resource: full.clone(),
                                kind: "pod",
                                reason: format!(
                                    "Terminated: {}",
                                    t.reason.as_deref().unwrap_or("?")
                                ),
                            });
                        }
                    }
                }
            }
        }

        // Deployments.
        let deps: kube::api::ObjectList<k8s_openapi::api::apps::v1::Deployment> =
            match &namespace {
                Some(ns) => Api::namespaced(client.clone(), ns),
                None => Api::all(client.clone()),
            }
            .list(&Default::default())
            .await
            .map_err(|e| crate::ai::error::AiError::Tool(e.to_string()))?;
        for d in deps {
            let ns = d.metadata.namespace.clone().unwrap_or_default();
            let full = if ns.is_empty() {
                d.name_any()
            } else {
                format!("{}/{}", ns, d.name_any())
            };
            if let Some(status) = &d.status {
                let unavailable = status.unavailable_replicas.unwrap_or(0);
                let ready = status.ready_replicas.unwrap_or(0);
                let desired = d.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0);
                if unavailable > 0 || ready < desired {
                    problems.push(Problem {
                        severity: "warning",
                        resource: full,
                        kind: "deployment",
                        reason: format!("{ready}/{desired} ready, {unavailable} unavailable"),
                    });
                }
            }
        }

        ok_value(&serde_json::json!({ "problems": problems }))
    }
}

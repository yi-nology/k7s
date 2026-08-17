//! Diagnostic tools — thin wrappers around `impls::*_impl()`.

use crate::ai::error::{AiError, AiResult};
use crate::ai::tools::{get_arg_str, get_opt_str, impls, Tool, ToolContext};
use async_trait::async_trait;

pub struct DiagnoseUnhealthy;
#[async_trait]
impl Tool for DiagnoseUnhealthy {
    fn name(&self) -> &str {
        "diagnose_unhealthy"
    }
    fn description(&self) -> &str {
        "Scan the cluster for unhealthy resources and return a problem list."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({"type":"object","properties":{"namespace":{"type":"string"}}})
    }
    async fn call(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        let ns = get_opt_str(&args, "namespace");
        impls::diagnose_unhealthy_impl(&ctx.manager, ns.as_deref())
            .await
            .map_err(|e| AiError::Tool(e.to_string()))
    }
}

pub struct DiagnosePod;
#[async_trait]
impl Tool for DiagnosePod {
    fn name(&self) -> &str {
        "diagnose_pod"
    }
    fn description(&self) -> &str {
        "Deep diagnosis of a specific pod. Identifies the exact failure pattern: \
         OOMKilled (exit 137), CrashLoopBackOff, ImagePullBackOff, ConfigError, \
         SegFault (exit 139), application crashes, and more. Returns per-container \
         status with exit codes, restart counts, and a human-readable summary. \
         Use this when a specific pod is unhealthy or the user asks why a pod is failing."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "namespace": {
                    "type": "string",
                    "description": "The namespace of the pod"
                },
                "pod": {
                    "type": "string",
                    "description": "The name of the pod"
                }
            },
            "required": ["namespace", "pod"]
        })
    }
    async fn call(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        let namespace = get_arg_str(&args, "namespace")?;
        let pod = get_arg_str(&args, "pod")?;
        impls::diagnose_pod_impl(&ctx.manager, &namespace, &pod)
            .await
            .map_err(|e| AiError::Tool(e.to_string()))
    }
}

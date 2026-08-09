//! Write tools — thin wrappers around `impls::*_impl()`.

use crate::ai::error::{AiError, AiResult};
use crate::ai::tools::{get_arg_i64, get_arg_str, get_opt_str, impls, ok_value, Tool, ToolContext};
use async_trait::async_trait;

pub struct ScaleWorkload;
#[async_trait]
impl Tool for ScaleWorkload {
    fn name(&self) -> &str {
        "scale_workload"
    }
    fn description(&self) -> &str {
        "Scale a Deployment/StatefulSet/ReplicaSet."
    }
    fn is_write(&self) -> bool {
        true
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({"type":"object","properties":{
            "kind":{"type":"string"},"namespace":{"type":"string"},"name":{"type":"string"},"replicas":{"type":"integer"}
        },"required":["kind","namespace","name","replicas"]})
    }
    async fn call(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        let replicas = get_arg_i64(&args, "replicas")?;
        if !(0..=1000).contains(&replicas) {
            return Err(AiError::ToolArgs(format!("replicas must be 0..=1000")));
        }
        impls::scale_resource_impl(
            &ctx.manager,
            &get_arg_str(&args, "kind")?,
            &get_arg_str(&args, "namespace")?,
            &get_arg_str(&args, "name")?,
            replicas as i32,
        )
        .await
        .map_err(|e| AiError::Tool(e.to_string()))
    }
}

pub struct RestartWorkload;
#[async_trait]
impl Tool for RestartWorkload {
    fn name(&self) -> &str {
        "restart_workload"
    }
    fn description(&self) -> &str {
        "Rollout-restart a Deployment/StatefulSet/DaemonSet."
    }
    fn is_write(&self) -> bool {
        true
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({"type":"object","properties":{
            "kind":{"type":"string"},"namespace":{"type":"string"},"name":{"type":"string"}
        },"required":["kind","namespace","name"]})
    }
    async fn call(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        impls::restart_workload_impl(
            &ctx.manager,
            &get_arg_str(&args, "kind")?,
            &get_arg_str(&args, "namespace")?,
            &get_arg_str(&args, "name")?,
        )
        .await
        .map_err(|e| AiError::Tool(e.to_string()))
    }
}

pub struct DeleteResource;
#[async_trait]
impl Tool for DeleteResource {
    fn name(&self) -> &str {
        "delete_resource"
    }
    fn description(&self) -> &str {
        "Delete a single resource. Destructive."
    }
    fn is_write(&self) -> bool {
        true
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({"type":"object","properties":{
            "kind":{"type":"string"},"namespace":{"type":"string"},"name":{"type":"string"}
        },"required":["kind","name"]})
    }
    async fn call(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        impls::delete_resource_impl(
            &ctx.manager,
            &get_arg_str(&args, "kind")?,
            &get_opt_str(&args, "namespace").unwrap_or_default(),
            &get_arg_str(&args, "name")?,
        )
        .await
        .map_err(|e| AiError::Tool(e.to_string()))
    }
}

pub struct ApplyManifest;
#[async_trait]
impl Tool for ApplyManifest {
    fn name(&self) -> &str {
        "apply_manifest"
    }
    fn description(&self) -> &str {
        "Apply a YAML manifest (server-side replace)."
    }
    fn is_write(&self) -> bool {
        true
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({"type":"object","properties":{
            "yaml":{"type":"string"},"namespace":{"type":"string"}
        },"required":["yaml"]})
    }
    async fn call(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        let yaml = get_arg_str(&args, "yaml")?;
        let ns = get_opt_str(&args, "namespace").unwrap_or_default();
        impls::apply_manifest_impl(&ctx.manager, &yaml, &ns)
            .await
            .map_err(|e| AiError::Tool(e.to_string()))
    }
}

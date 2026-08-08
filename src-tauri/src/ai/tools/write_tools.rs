//! Write tools — every one mutates the cluster and so overrides `is_write()`
//! to `true`. The permission gate
//! ([`crate::ai::permission`](super::super::permission)) decides whether a
//! given invocation runs immediately, is held for user approval, or is refused.
//!
//! Each tool reuses the same `shell_common::dynamic_api` the Tauri commands
//! use, so an AI-driven scale and a human-driven scale hit identical code paths.

use crate::ai::error::{AiError, AiResult};
use crate::ai::tools::{
    dynamic_api, get_arg_i64, get_arg_str, get_opt_str, ok_value, Tool, ToolContext,
};
use async_trait::async_trait;
use kube::api::{DeleteParams, Patch, PatchParams, PostParams};

// ---------------------------------------------------------------------------
// scale_workload
// ---------------------------------------------------------------------------

pub struct ScaleWorkload;

#[async_trait]
impl Tool for ScaleWorkload {
    fn name(&self) -> &str {
        "scale_workload"
    }
    fn description(&self) -> &str {
        "Scale a Deployment, StatefulSet, or ReplicaSet to a target replica \
         count by patching spec.replicas. Use when the user wants to \
         'scale up/down', 'add/remove replicas', or handle load changes."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "kind": {"type": "string", "description": "deployments, statefulsets, or replicasets"},
                "namespace": {"type": "string"},
                "name": {"type": "string"},
                "replicas": {"type": "integer", "description": "Target replica count (>= 0)."}
            },
            "required": ["kind", "namespace", "name", "replicas"]
        })
    }
    fn is_write(&self) -> bool {
        true
    }
    async fn call(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        let kind = get_arg_str(&args, "kind")?;
        let namespace = get_arg_str(&args, "namespace")?;
        let name = get_arg_str(&args, "name")?;
        let replicas = get_arg_i64(&args, "replicas")?;
        if !(0..=1000).contains(&replicas) {
            return Err(AiError::ToolArgs(format!(
                "replicas must be 0..=1000, got {replicas}"
            )));
        }
        let (api, _) = dynamic_api(ctx, &kind, &namespace).await?;
        let patch = Patch::Merge(serde_json::json!({
            "spec": { "replicas": replicas as i32 }
        }));
        api.patch(&name, &PatchParams::default(), &patch)
            .await
            .map_err(|e| AiError::Tool(e.to_string()))?;
        ok_value(&serde_json::json!({
            "scaled": true, "kind": kind, "namespace": namespace,
            "name": name, "replicas": replicas
        }))
    }
}

// ---------------------------------------------------------------------------
// restart_workload
// ---------------------------------------------------------------------------

pub struct RestartWorkload;

#[async_trait]
impl Tool for RestartWorkload {
    fn name(&self) -> &str {
        "restart_workload"
    }
    fn description(&self) -> &str {
        "Rollout-restart a Deployment, StatefulSet, or DaemonSet (the \
         `kubectl rollout restart` equivalent): patches the pod template's \
         restartedAt annotation so the controller rolls through its update \
         strategy. Use when the user wants to 'restart' a workload."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "kind": {"type": "string", "description": "deployments, statefulsets, or daemonsets"},
                "namespace": {"type": "string"},
                "name": {"type": "string"}
            },
            "required": ["kind", "namespace", "name"]
        })
    }
    fn is_write(&self) -> bool {
        true
    }
    async fn call(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        let kind = get_arg_str(&args, "kind")?;
        let namespace = get_arg_str(&args, "namespace")?;
        let name = get_arg_str(&args, "name")?;
        if !crate::kube::restart::is_rollout_kind(&kind) {
            return Err(AiError::ToolArgs(format!(
                "{kind} cannot be rollout-restarted"
            )));
        }
        let (api, _) = dynamic_api(ctx, &kind, &namespace).await?;
        let now = chrono::Utc::now().to_rfc3339();
        let patch = Patch::Merge(crate::kube::restart::restart_patch(&now));
        api.patch(&name, &PatchParams::default(), &patch)
            .await
            .map_err(|e| AiError::Tool(e.to_string()))?;
        ok_value(&serde_json::json!({
            "restarted": true, "kind": kind, "namespace": namespace, "name": name
        }))
    }
}

// ---------------------------------------------------------------------------
// delete_resource
// ---------------------------------------------------------------------------

pub struct DeleteResource;

#[async_trait]
impl Tool for DeleteResource {
    fn name(&self) -> &str {
        "delete_resource"
    }
    fn description(&self) -> &str {
        "Delete a single resource. Destructive — confirm with the user first \
         (the permission gate does this in ReadConfirmWrite mode). Use only \
         when the user explicitly asks to delete something."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "kind": {"type": "string"},
                "namespace": {"type": "string"},
                "name": {"type": "string"}
            },
            "required": ["kind", "name"]
        })
    }
    fn is_write(&self) -> bool {
        true
    }
    async fn call(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        let kind = get_arg_str(&args, "kind")?;
        let namespace = get_opt_str(&args, "namespace").unwrap_or_default();
        let name = get_arg_str(&args, "name")?;
        let (api, _) = dynamic_api(ctx, &kind, &namespace).await?;
        api.delete(&name, &DeleteParams::default())
            .await
            .map_err(|e| AiError::Tool(e.to_string()))?;
        ok_value(&serde_json::json!({
            "deleted": true, "kind": kind, "namespace": namespace, "name": name
        }))
    }
}

// ---------------------------------------------------------------------------
// apply_manifest
// ---------------------------------------------------------------------------

pub struct ApplyManifest;

#[async_trait]
impl Tool for ApplyManifest {
    fn name(&self) -> &str {
        "apply_manifest"
    }
    fn description(&self) -> &str {
        "Apply (server-side replace of) a single-resource YAML manifest. The \
         kind/namespace/name are read from the manifest itself. Use when the \
         user wants to create or update a resource from YAML."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "yaml": {"type": "string", "description": "A single Kubernetes YAML manifest."},
                "namespace": {"type": "string", "description": "Namespace override for namespaced kinds; empty for cluster-scoped."}
            },
            "required": ["yaml"]
        })
    }
    fn is_write(&self) -> bool {
        true
    }
    async fn call(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        let yaml = get_arg_str(&args, "yaml")?;
        let namespace = get_opt_str(&args, "namespace").unwrap_or_default();
        let obj: kube::api::DynamicObject = serde_yaml::from_str(&yaml)
            .map_err(|e| AiError::ToolArgs(format!("invalid yaml: {e}")))?;
        let name = obj
            .metadata
            .name
            .clone()
            .ok_or_else(|| AiError::ToolArgs("manifest has no metadata.name".into()))?;
        let kind = obj
            .types
            .as_ref()
            .map(|t| t.kind.clone())
            .ok_or_else(|| AiError::ToolArgs("manifest has no apiVersion/kind".into()))?;
        let kind_id = match kind.as_str() {
            "Pod" => "pods",
            "Deployment" => "deployments",
            "StatefulSet" => "statefulsets",
            "DaemonSet" => "daemonsets",
            "Service" => "services",
            "ConfigMap" => "configmaps",
            "Namespace" => "namespaces",
            "Job" => "jobs",
            "CronJob" => "cronjobs",
            "Ingress" => "ingresses",
            "PersistentVolumeClaim" => "persistentvolumeclaims",
            other => {
                return Err(AiError::ToolArgs(format!(
                    "apply_manifest: kind '{other}' not supported by the AI tool (use the YAML editor for it)"
                )));
            }
        };
        let (api, _) = dynamic_api(ctx, kind_id, &namespace).await?;
        api.replace(&name, &PostParams::default(), &obj)
            .await
            .map_err(|e| AiError::Tool(e.to_string()))?;
        ok_value(&serde_json::json!({
            "applied": true, "kind": kind_id, "namespace": namespace, "name": name
        }))
    }
}

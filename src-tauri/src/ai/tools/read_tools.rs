//! Read-only AI tools. None of these mutate the cluster, so `is_write()`
//! defaults to `false` and they bypass the permission gate entirely.
//!
//! Every tool goes through [`crate::core::shell_common`] + raw `kube` calls.
//! We don't reuse `mcp::kube_api` (it's behind the `mcp`/`web` feature gates
//! and the AI module ships in the plain desktop build). The work here is
//! (a) describing the tool well enough that the LLM picks it correctly, and
//! (b) shaping the result into compact JSON the LLM can reason over.

use crate::ai::error::{AiError, AiResult};
use crate::ai::tools::{dynamic_api, get_arg_str, get_opt_bool, get_opt_i64, get_opt_str};
use crate::ai::tools::{ok_value, require_client, Tool, ToolContext};
use async_trait::async_trait;
use kube::api::{Api, ListParams};
use kube::ResourceExt;
use serde::Serialize;

// ---------------------------------------------------------------------------
// list_resources
// ---------------------------------------------------------------------------

pub struct ListResources;

#[async_trait]
impl Tool for ListResources {
    fn name(&self) -> &str {
        "list_resources"
    }
    fn description(&self) -> &str {
        "List Kubernetes resources of a given kind. Use this first when the user \
         asks 'what's running / show me / list' something. `kind` is the lowercase \
         resource id (pods, deployments, services, nodes, namespaces, configmaps, \
         …) or `group/plural` for a CRD. `namespace` is optional (omit or empty \
         for all namespaces). `label_selector` is optional (e.g. \
         'app=frontend'). Returns a compact list of {name, namespace, summary}."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "kind": {"type": "string", "description": "Lowercase resource id, e.g. 'pods', 'deployments', 'nodes'."},
                "namespace": {"type": "string", "description": "Namespace to scope to. Omit or empty for all namespaces."},
                "label_selector": {"type": "string", "description": "Optional label selector, e.g. 'app=frontend'."}
            },
            "required": ["kind"]
        })
    }
    async fn call(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        let kind = get_arg_str(&args, "kind")?;
        let namespace = get_opt_str(&args, "namespace").unwrap_or_default();
        let label = get_opt_str(&args, "label_selector");
        let (api, _is_helm) = dynamic_api(ctx, &kind, &namespace).await?;
        let mut lp = ListParams::default();
        if let Some(ls) = &label {
            if !ls.trim().is_empty() {
                lp = lp.labels(ls);
            }
        }
        let list = api
            .list(&lp)
            .await
            .map_err(|e| AiError::Tool(e.to_string()))?;
        let rows: Vec<serde_json::Value> = list
            .iter()
            .map(|obj| {
                serde_json::json!({
                    "name": obj.name_any(),
                    "namespace": obj.metadata.namespace.clone(),
                    "kind": kind,
                })
            })
            .collect();
        ok_value(&rows)
    }
}

// ---------------------------------------------------------------------------
// describe_resource
// ---------------------------------------------------------------------------

pub struct DescribeResource;

#[async_trait]
impl Tool for DescribeResource {
    fn name(&self) -> &str {
        "describe_resource"
    }
    fn description(&self) -> &str {
        "Get a structured description of one resource (status, conditions, \
         labels, spec summary). Prefer this over get_resource_yaml when you \
         need to reason about *state* — it returns compact JSON, not raw YAML. \
         Use it to answer 'why is X not ready / what's wrong with X'."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "kind": {"type": "string"},
                "namespace": {"type": "string", "description": "Empty for cluster-scoped kinds like nodes."},
                "name": {"type": "string"}
            },
            "required": ["kind", "name"]
        })
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
        let mut obj = api
            .get(&name)
            .await
            .map_err(|e| AiError::Tool(e.to_string()))?;
        // managedFields is huge and useless to the LLM.
        obj.metadata.managed_fields = None;
        serde_json::to_value(&obj).map_err(|e| AiError::Tool(e.to_string()))
    }
}

// ---------------------------------------------------------------------------
// get_resource_yaml
// ---------------------------------------------------------------------------

pub struct GetResourceYaml;

#[async_trait]
impl Tool for GetResourceYaml {
    fn name(&self) -> &str {
        "get_resource_yaml"
    }
    fn description(&self) -> &str {
        "Get the full YAML manifest of one resource (managedFields stripped). \
         Use only when the user explicitly wants the raw definition or you need \
         a field not present in describe_resource. The result is large — prefer \
         describe_resource for state questions."
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
    async fn call(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        let kind = get_arg_str(&args, "kind")?;
        let namespace = get_opt_str(&args, "namespace").unwrap_or_default();
        let name = get_arg_str(&args, "name")?;
        let (api, _) = dynamic_api(ctx, &kind, &namespace).await?;
        let mut obj = api
            .get(&name)
            .await
            .map_err(|e| AiError::Tool(e.to_string()))?;
        obj.metadata.managed_fields = None;
        let yaml = serde_yaml::to_string(&obj).map_err(|e| AiError::Tool(e.to_string()))?;
        ok_value(&serde_json::json!({ "yaml": yaml }))
    }
}

// ---------------------------------------------------------------------------
// get_events
// ---------------------------------------------------------------------------

pub struct GetEvents;

#[async_trait]
impl Tool for GetEvents {
    fn name(&self) -> &str {
        "get_events"
    }
    fn description(&self) -> &str {
        "Read Kubernetes events for a specific resource (Warning/Normal, reason, \
         message, count, age). Use this to explain failures: CrashLoopBackOff, \
         ImagePullBackOff, FailedScheduling, etc. show up here. Always pair with \
         describe_resource when diagnosing."
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
    async fn call(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        let kind = get_arg_str(&args, "kind")?;
        let namespace = get_opt_str(&args, "namespace").unwrap_or_default();
        let name = get_arg_str(&args, "name")?;
        let client = require_client(&ctx.manager).await?;
        let events: Api<k8s_openapi::api::core::v1::Event> = if namespace.is_empty() {
            Api::all(client)
        } else {
            Api::namespaced(client, &namespace)
        };
        // kind id → the Kubernetes Kind name events carry.
        let involved_kind = match kind.rsplit('/').next().unwrap_or(&kind) {
            "pods" => "Pod",
            "deployments" => "Deployment",
            "replicasets" => "ReplicaSet",
            "statefulsets" => "StatefulSet",
            "daemonsets" => "DaemonSet",
            "jobs" => "Job",
            "cronjobs" => "CronJob",
            "services" => "Service",
            "ingresses" => "Ingress",
            "configmaps" => "ConfigMap",
            "secrets" => "Secret",
            "persistentvolumeclaims" => "PersistentVolumeClaim",
            "nodes" => "Node",
            "namespaces" => "Namespace",
            other => other,
        };
        let list = events
            .list(&ListParams::default().fields(&format!(
                "involvedObject.name={name},involvedObject.kind={involved_kind}"
            )))
            .await
            .map_err(|e| AiError::Tool(e.to_string()))?;
        let rows: Vec<serde_json::Value> = list
            .iter()
            .map(|e| {
                serde_json::json!({
                    "type": e.type_.clone().unwrap_or_default(),
                    "reason": e.reason.clone().unwrap_or_default(),
                    "message": e.message.clone().unwrap_or_default(),
                    "count": e.count.unwrap_or(1),
                })
            })
            .collect();
        ok_value(&rows)
    }
}

// ---------------------------------------------------------------------------
// get_pod_logs
// ---------------------------------------------------------------------------

pub struct GetPodLogs;

#[async_trait]
impl Tool for GetPodLogs {
    fn name(&self) -> &str {
        "get_pod_logs"
    }
    fn description(&self) -> &str {
        "Fetch pod logs. Use when a pod is crashing, erroring, or behaving \
         oddly and describe_resource/events don't explain it. `tail` caps the \
         line count (default 100). Set `previous: true` to read the logs of the \
         *previous* (crashed) container instance — essential for \
         CrashLoopBackOff. `container` is only needed for multi-container pods."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "namespace": {"type": "string"},
                "pod": {"type": "string"},
                "container": {"type": "string", "description": "Optional, for multi-container pods."},
                "tail": {"type": "integer", "description": "Max lines. Default 100."},
                "previous": {"type": "boolean", "description": "Read previous container's logs (CrashLoopBackOff)."}
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
        let container = get_opt_str(&args, "container");
        let tail = get_opt_i64(&args, "tail").unwrap_or(100);
        let previous = get_opt_bool(&args, "previous").unwrap_or(false);
        let client = require_client(&ctx.manager).await?;
        let pods: Api<k8s_openapi::api::core::v1::Pod> = Api::namespaced(client, &namespace);
        let lp = kube::api::LogParams {
            container: container.clone(),
            tail_lines: Some(tail),
            previous,
            ..Default::default()
        };
        let logs = pods
            .logs(&pod, &lp)
            .await
            .map_err(|e| AiError::Tool(e.to_string()))?;
        ok_value(&serde_json::json!({ "logs": logs }))
    }
}

// ---------------------------------------------------------------------------
// get_cluster_health
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ClusterHealthPayload {
    nodes_ready: usize,
    nodes_total: usize,
    pods_running: usize,
    pods_total: usize,
    problems: Vec<String>,
}

pub struct GetClusterHealth;

#[async_trait]
impl Tool for GetClusterHealth {
    fn name(&self) -> &str {
        "get_cluster_health"
    }
    fn description(&self) -> &str {
        "Get an at-a-glance cluster health snapshot: how many nodes are Ready, \
         how many pods are Running vs total, and a list of concrete problems \
         (NotReady nodes, CrashLoopBackOff pods, unavailable replicas). Use \
         this when the user asks 'is the cluster healthy / anything wrong'."
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({ "type": "object", "properties": {} })
    }
    async fn call(
        &self,
        ctx: &ToolContext,
        _args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        let client = require_client(&ctx.manager).await?;
        let nodes: kube::api::ObjectList<k8s_openapi::api::core::v1::Node> =
            Api::all(client.clone())
                .list(&Default::default())
                .await
                .map_err(|e| AiError::Tool(e.to_string()))?;
        let pods: kube::api::ObjectList<k8s_openapi::api::core::v1::Pod> = Api::all(client.clone())
            .list(&Default::default())
            .await
            .map_err(|e| AiError::Tool(e.to_string()))?;
        let mut problems = Vec::new();
        let nodes_ready = nodes
            .iter()
            .filter(|n| {
                let ready = n
                    .status
                    .as_ref()
                    .and_then(|s| s.conditions.as_ref())
                    .map(|cs| cs.iter().any(|c| c.type_ == "Ready" && c.status == "True"))
                    .unwrap_or(false);
                if !ready {
                    problems.push(format!("Node {} is NotReady", n.name_any()));
                }
                ready
            })
            .count();
        let pods_running = pods
            .iter()
            .filter(|p| {
                let phase = p
                    .status
                    .as_ref()
                    .and_then(|s| s.phase.as_deref())
                    .unwrap_or("");
                let name = p.name_any();
                let ns = p.metadata.namespace.clone().unwrap_or_default();
                match phase {
                    "Running" => true,
                    "Failed" => {
                        problems.push(format!("Pod {ns}/{name} is Failed"));
                        false
                    }
                    "Pending" => {
                        if let Some(cs) = p
                            .status
                            .as_ref()
                            .and_then(|s| s.container_statuses.as_ref())
                        {
                            for c in cs {
                                if let Some(w) = c.state.as_ref().and_then(|s| s.waiting.as_ref()) {
                                    problems.push(format!(
                                        "Pod {ns}/{name} waiting: {} ({})",
                                        w.reason.as_deref().unwrap_or("?"),
                                        w.message.as_deref().unwrap_or("")
                                    ));
                                }
                            }
                        }
                        false
                    }
                    _ => false,
                }
            })
            .count();
        ok_value(&ClusterHealthPayload {
            nodes_ready,
            nodes_total: nodes.items.len(),
            pods_running,
            pods_total: pods.items.len(),
            problems,
        })
    }
}

// ---------------------------------------------------------------------------
// top_nodes
// ---------------------------------------------------------------------------

pub struct TopNodes;

#[async_trait]
impl Tool for TopNodes {
    fn name(&self) -> &str {
        "top_nodes"
    }
    fn description(&self) -> &str {
        "Get current node status: which nodes are Ready vs NotReady and their \
         roles/versions. Use when the user asks about node health or capacity. \
         (CPU/memory metrics require metrics-server and are not included.)"
    }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({ "type": "object", "properties": {} })
    }
    async fn call(
        &self,
        ctx: &ToolContext,
        _args: serde_json::Value,
    ) -> AiResult<serde_json::Value> {
        let client = require_client(&ctx.manager).await?;
        let nodes: kube::api::ObjectList<k8s_openapi::api::core::v1::Node> = Api::all(client)
            .list(&Default::default())
            .await
            .map_err(|e| AiError::Tool(e.to_string()))?;
        let rows: Vec<serde_json::Value> = nodes
            .iter()
            .map(|n| {
                let ready = n
                    .status
                    .as_ref()
                    .and_then(|s| s.conditions.as_ref())
                    .map(|cs| cs.iter().any(|c| c.type_ == "Ready" && c.status == "True"))
                    .unwrap_or(false);
                let kubelet = n
                    .status
                    .as_ref()
                    .and_then(|s| s.node_info.as_ref())
                    .map(|i| i.kubelet_version.clone())
                    .unwrap_or_default();
                serde_json::json!({
                    "name": n.name_any(),
                    "ready": ready,
                    "kubelet_version": kubelet,
                })
            })
            .collect();
        ok_value(&rows)
    }
}

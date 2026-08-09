//! Diagnostic tools — thin wrappers around `impls::*_impl()`.

use crate::ai::error::{AiError, AiResult};
use crate::ai::tools::{get_opt_str, impls, Tool, ToolContext};
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

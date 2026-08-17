//! Integration test: drive the AI tool set against a REAL cluster.
//!
//! This is the smoke test that proves the "Plan A reuse" promise — the AI
//! tools, built on the independent `Tool` trait (Plan C), actually reach a
//! live cluster through `core::shell_common` and return sensible data.
//!
//! It connects to whatever cluster `KUBECONFIG` (or the default kubeconfig)
//! points at, then exercises a handful of read-only tools. Skipped if no
//! cluster is reachable, so `cargo test` without a cluster still passes.
//!
//! Run with:
//!   KUBECONFIG=~/.kube/k7s-dev.kubeconfig \
//!     cargo test --test ai_cluster_integration -- --nocapture --ignored

use k7s_ios_lib::ai::config::PermissionMode;
use k7s_ios_lib::ai::tools::{ToolContext, ToolRegistry};
use k7s_ios_lib::core::events::mcp_sink;
use k7s_ios_lib::kube::ClientManager;
use std::sync::Once;

/// Ensure rustls has a crypto provider installed (Tauri's startup does this
/// for the real binary, but the test binary bypasses it).
static CRYPTO_INIT: Once = Once::new();
fn ensure_crypto() {
    CRYPTO_INIT.call_once(|| {
        let _ = k7s_deps::rustls::crypto::aws_lc_rs::default_provider().install_default();
    });
}

/// Build a ToolContext connected to the cluster pointed at by KUBECONFIG.
async fn ctx() -> Option<ToolContext> {
    ensure_crypto();
    let manager = std::sync::Arc::new(ClientManager::new(mcp_sink()));
    // The manager needs to be "connected" — mimic what the `connect` Tauri
    // command does: build a client from the default kubeconfig and hand it to
    // the manager. We reach into the manager's connect path via the public
    // kube client builder.
    let context = std::env::var("K7S_TEST_CONTEXT").ok();
    let (client, ctx_name) =
        match k7s_ios_lib::kube::client::build_client(context.as_deref().unwrap_or("")).await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[ai-integration] no cluster: {e}");
                return None;
            }
        };
    let info = k7s_ios_lib::kube::manager::ConnectionInfo {
        context: ctx_name,
        server: String::new(),
        version: String::new(),
    };
    manager.set_connected(client, info, 0).await;
    Some(ToolContext {
        manager,
        data_dir: std::path::PathBuf::new(),
    })
}

#[tokio::test]
#[ignore = "needs a reachable cluster; run with --ignored"]
async fn list_resources_returns_nodes() {
    let ctx = match ctx().await {
        Some(c) => c,
        None => return,
    };
    let reg = ToolRegistry::new();
    let res = reg
        .dispatch(
            "list_resources",
            &ctx,
            k7s_deps::serde_json::json!({ "kind": "nodes" }),
        )
        .await
        .expect("list_resources on nodes");
    let arr = res.as_array().expect("array of resources");
    assert!(!arr.is_empty(), "cluster has at least one node");
    let first = &arr[0];
    assert!(first.get("name").is_some(), "each row has a name");
    eprintln!("[ai-integration] list_resources nodes: {} found", arr.len());
}

#[tokio::test]
#[ignore = "needs a reachable cluster; run with --ignored"]
async fn get_cluster_health_runs() {
    let ctx = match ctx().await {
        Some(c) => c,
        None => return,
    };
    let reg = ToolRegistry::new();
    let res = reg
        .dispatch("get_cluster_health", &ctx, k7s_deps::serde_json::json!({}))
        .await
        .expect("get_cluster_health");
    assert!(res.get("nodes_ready").is_some(), "res = {res}");
    assert!(res.get("nodes_total").is_some(), "res = {res}");
    assert!(res.get("pods_total").is_some(), "res = {res}");
    eprintln!(
        "[ai-integration] cluster health: {}",
        k7s_deps::serde_json::to_string_pretty(&res).unwrap()
    );
}

#[tokio::test]
#[ignore = "needs a reachable cluster; run with --ignored"]
async fn diagnose_unhealthy_runs() {
    let ctx = match ctx().await {
        Some(c) => c,
        None => return,
    };
    let reg = ToolRegistry::new();
    let res = reg
        .dispatch("diagnose_unhealthy", &ctx, k7s_deps::serde_json::json!({}))
        .await
        .expect("diagnose_unhealthy");
    // Returns a { problems: [...] } envelope even when healthy.
    assert!(res.get("problems").is_some());
    eprintln!(
        "[ai-integration] diagnose: {}",
        k7s_deps::serde_json::to_string_pretty(&res).unwrap()
    );
}

/// Confirm the function defs handed to the LLM are well-formed JSON Schemas —
/// a malformed schema would make the provider reject the whole request.
#[test]
fn function_defs_are_valid_schemas() {
    let reg = ToolRegistry::new();
    for mode in [
        PermissionMode::ReadOnly,
        PermissionMode::ReadConfirmWrite,
        PermissionMode::FullAuto,
    ] {
        for def in reg.function_defs(mode) {
            assert!(!def.name.is_empty(), "tool has a name");
            assert!(
                !def.description.is_empty(),
                "{} has a description",
                def.name
            );
            assert!(
                def.parameters.is_object(),
                "{} parameters is a JSON object",
                def.name
            );
        }
    }
}

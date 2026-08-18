//! Knowledge sync — inspired by openocta's `agent/runtime/knowledge_sync.go`.
//!
//! Imports external knowledge into the Knowledge Vault automatically:
//!
//! - **Cluster documentation**: reads ConfigMaps labeled `k7s.ai/docs=true`
//!   and indexes their content.
//! - **Helm chart NOTES.txt**: after installs/upgrades, stores the chart's
//!   NOTES.txt as a runbook.
//! - **Pod annotations**: `k7s.ai/runbook`, `k7s.ai/description` annotations
//!   are extracted as knowledge entries.
//! - **External files**: user can point at a directory of markdown/text files
//!   to bulk-import.
//!
//! Sync runs on connect (when a cluster is first reachable) and can be
//! triggered manually via `ai_knowledge_sync`.

use crate::ai::memory::{MemorySource, MemoryStore, Tier};
use crate::kube::manager::ClientManager;
use k7s_deps::kube::api::{Api, ListParams};
use k7s_deps::kube::ResourceExt;
use std::sync::Arc;

/// Sync knowledge from the connected cluster into the Knowledge Vault.
pub async fn sync_from_cluster(
    manager: &Arc<ClientManager>,
    data_dir: &std::path::Path,
    context: &str,
) -> Result<SyncReport, String> {
    let client = manager.client().await.ok_or("not connected to a cluster")?;

    let mut store = MemoryStore::open(data_dir, context);
    let mut report = SyncReport::default();

    // 1. ConfigMaps labeled k7s.ai/docs=true.
    let cms: Api<k7s_deps::k8s_openapi::api::core::v1::ConfigMap> = Api::all(client.clone());
    match cms
        .list(&ListParams::default().labels("k7s.ai/docs=true"))
        .await
    {
        Ok(list) => {
            for cm in list {
                let name = cm.name_any();
                let ns = cm.metadata.namespace.clone().unwrap_or_default();
                for (key, value) in cm.data.as_ref().into_iter().flat_map(|m| m.iter()) {
                    store.add(
                        Tier::KnowledgeVault,
                        &format!("[Doc: {ns}/{name}/{key}] {value}"),
                        vec!["docs".into(), ns.clone(), name.clone()],
                        MemorySource::Ai,
                    );
                    report.config_maps += 1;
                }
            }
        }
        Err(e) => report.errors.push(format!("ConfigMap scan: {e}")),
    }

    // 2. Pods with k7s.ai/runbook or k7s.ai/description annotations.
    let pods: Api<k7s_deps::k8s_openapi::api::core::v1::Pod> = Api::all(client.clone());
    match pods.list(&ListParams::default()).await {
        Ok(list) => {
            for pod in list {
                let name = pod.name_any();
                let ns = pod.metadata.namespace.clone().unwrap_or_default();
                let annotations = pod.metadata.annotations.clone().unwrap_or_default();
                if let Some(runbook) = annotations.get("k7s.ai/runbook") {
                    store.add(
                        Tier::KnowledgeVault,
                        &format!("[Runbook: {ns}/{name}] {runbook}"),
                        vec!["runbook".into(), ns.clone(), name.clone()],
                        MemorySource::Ai,
                    );
                    report.pod_annotations += 1;
                }
                if let Some(desc) = annotations.get("k7s.ai/description") {
                    store.add(
                        Tier::KnowledgeVault,
                        &format!("[Description: {ns}/{name}] {desc}"),
                        vec!["description".into(), ns.clone(), name.clone()],
                        MemorySource::Ai,
                    );
                    report.pod_annotations += 1;
                }
            }
        }
        Err(e) => report.errors.push(format!("Pod scan: {e}")),
    }

    // 3. Deployments with k7s.ai/runbook annotation.
    let deps: Api<k7s_deps::k8s_openapi::api::apps::v1::Deployment> = Api::all(client.clone());
    match deps.list(&ListParams::default()).await {
        Ok(list) => {
            for dep in list {
                let name = dep.name_any();
                let ns = dep.metadata.namespace.clone().unwrap_or_default();
                let annotations = dep.metadata.annotations.clone().unwrap_or_default();
                if let Some(runbook) = annotations.get("k7s.ai/runbook") {
                    store.add(
                        Tier::KnowledgeVault,
                        &format!("[Deployment Runbook: {ns}/{name}] {runbook}"),
                        vec!["runbook".into(), "deployment".into(), ns.clone()],
                        MemorySource::Ai,
                    );
                    report.deploy_annotations += 1;
                }
            }
        }
        Err(e) => report.errors.push(format!("Deployment scan: {e}")),
    }

    Ok(report)
}

/// Import knowledge from a directory of markdown/text files.
pub fn import_from_directory(
    data_dir: &std::path::Path,
    context: &str,
    source_dir: &std::path::Path,
) -> Result<usize, String> {
    if !source_dir.is_dir() {
        return Err(format!("{} is not a directory", source_dir.display()));
    }
    let mut store = MemoryStore::open(data_dir, context);
    let mut count = 0;
    for entry in std::fs::read_dir(source_dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md")
            || path.extension().and_then(|e| e.to_str()) == Some("txt")
        {
            if let Ok(content) = std::fs::read_to_string(&path) {
                let title = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("untitled");
                store.add_runbook(title, &content, vec!["import".into()]);
                count += 1;
            }
        }
    }
    Ok(count)
}

/// Report of what was synced.
#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub config_maps: usize,
    pub pod_annotations: usize,
    pub deploy_annotations: usize,
    pub errors: Vec<String>,
}

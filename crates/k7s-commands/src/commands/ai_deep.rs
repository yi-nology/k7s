// Tauri commands for deep AI capabilities: evolution, sandbox, knowledge sync.

use k7s_core::ai::evolution::{EvolutionStore, RunOutcome, Strategy};
use k7s_core::ai::knowledge_sync::{self, SyncReport};
use k7s_core::ai::sandbox::{self, SandboxConfig};
use k7s_core::core::CoreState;
use k7s_core::error::AppResult;
use std::sync::Arc;
use tauri::State;

// -- Evolution --

pub async fn ai_evolution_strategies_impl(
    state: std::sync::Arc<CoreState>,
) -> AppResult<Vec<Strategy>> {
    let store = EvolutionStore::open(&state.data_dir);
    Ok(store.list_strategies().to_vec())
}

#[tauri::command]
pub async fn ai_evolution_strategies(state: State<'_, Arc<CoreState>>) -> AppResult<Vec<Strategy>> {
    ai_evolution_strategies_impl(state.inner().clone()).await
}

/// Wire arguments for [`ai_evolution_record_run`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiEvolutionRecordRunArgs {
    pub outcome: RunOutcome,
}

pub async fn ai_evolution_record_run_impl(
    state: std::sync::Arc<CoreState>,
    outcome: RunOutcome,
) -> AppResult<()> {
    let mut store = EvolutionStore::open(&state.data_dir);
    store.record_run(outcome);
    store.scan_and_update();
    Ok(())
}

#[tauri::command]
pub async fn ai_evolution_record_run(
    outcome: RunOutcome,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    ai_evolution_record_run_impl(state.inner().clone(), outcome).await
}

/// Wire arguments for [`ai_evolution_delete_strategy`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiEvolutionDeleteStrategyArgs {
    pub id: String,
}

pub async fn ai_evolution_delete_strategy_impl(
    state: std::sync::Arc<CoreState>,
    id: String,
) -> AppResult<bool> {
    let mut store = EvolutionStore::open(&state.data_dir);
    Ok(store.delete_strategy(&id))
}

#[tauri::command]
pub async fn ai_evolution_delete_strategy(
    id: String,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<bool> {
    ai_evolution_delete_strategy_impl(state.inner().clone(), id).await
}

// -- Sandbox --

pub async fn ai_sandbox_presets_impl() -> Vec<(String, SandboxConfig)> {
    sandbox::presets()
        .into_iter()
        .map(|(name, cfg)| (name.to_string(), cfg))
        .collect()
}

#[tauri::command]
pub async fn ai_sandbox_presets() -> Vec<(String, SandboxConfig)> {
    ai_sandbox_presets_impl().await
}

// -- Knowledge Sync --

pub async fn ai_knowledge_sync_impl(state: std::sync::Arc<CoreState>) -> AppResult<SyncReport> {
    let context = state
        .manager
        .connection_info()
        .await
        .map(|i| i.context)
        .unwrap_or_else(|| "default".to_string());
    Ok(knowledge_sync::sync_from_cluster(&state.manager, &state.data_dir, &context).await?)
}

#[tauri::command]
pub async fn ai_knowledge_sync(state: State<'_, Arc<CoreState>>) -> AppResult<SyncReport> {
    ai_knowledge_sync_impl(state.inner().clone()).await
}

/// Wire arguments for [`ai_knowledge_import`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiKnowledgeImportArgs {
    pub source_dir: String,
}

pub async fn ai_knowledge_import_impl(
    state: std::sync::Arc<CoreState>,
    source_dir: String,
) -> AppResult<usize> {
    let context = state
        .manager
        .connection_info()
        .await
        .map(|i| i.context)
        .unwrap_or_else(|| "default".to_string());
    Ok(knowledge_sync::import_from_directory(
        &state.data_dir,
        &context,
        std::path::Path::new(&source_dir),
    )?)
}

#[tauri::command]
pub async fn ai_knowledge_import(
    source_dir: String,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<usize> {
    ai_knowledge_import_impl(state.inner().clone(), source_dir).await
}

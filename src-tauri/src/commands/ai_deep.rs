//! Tauri commands for deep AI capabilities: evolution, sandbox, knowledge sync.

use crate::ai::evolution::{EvolutionStore, RunOutcome, Strategy};
use crate::ai::knowledge_sync::{self, SyncReport};
use crate::ai::sandbox::{self, SandboxConfig};
use crate::core::CoreState;
use crate::error::AppResult;
use std::sync::Arc;
use tauri::State;

// -- Evolution --

#[tauri::command]
pub async fn ai_evolution_strategies(state: State<'_, Arc<CoreState>>) -> AppResult<Vec<Strategy>> {
    let store = EvolutionStore::open(&state.data_dir);
    Ok(store.list_strategies().to_vec())
}

#[tauri::command]
pub async fn ai_evolution_record_run(
    outcome: RunOutcome,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    let mut store = EvolutionStore::open(&state.data_dir);
    store.record_run(outcome);
    store.scan_and_update();
    Ok(())
}

#[tauri::command]
pub async fn ai_evolution_delete_strategy(
    id: String,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<bool> {
    let mut store = EvolutionStore::open(&state.data_dir);
    Ok(store.delete_strategy(&id))
}

// -- Sandbox --

#[tauri::command]
pub async fn ai_sandbox_presets() -> Vec<(String, SandboxConfig)> {
    sandbox::presets()
        .into_iter()
        .map(|(name, cfg)| (name.to_string(), cfg))
        .collect()
}

// -- Knowledge Sync --

#[tauri::command]
pub async fn ai_knowledge_sync(state: State<'_, Arc<CoreState>>) -> AppResult<SyncReport> {
    let context = state
        .manager
        .connection_info()
        .await
        .map(|i| i.context)
        .unwrap_or_else(|| "default".to_string());
    Ok(knowledge_sync::sync_from_cluster(&state.manager, &state.data_dir, &context).await?)
}

#[tauri::command]
pub async fn ai_knowledge_import(
    source_dir: String,
    state: State<'_, Arc<CoreState>>,
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

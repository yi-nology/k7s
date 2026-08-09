//! Tauri commands for the cluster memory / knowledge base.

use crate::ai::memory::{MemoryEntry, MemorySource, MemoryStore};
use crate::core::CoreState;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn ai_memory_list(
    kube_context: String,
    state: State<'_, Arc<CoreState>>,
) -> Result<Vec<MemoryEntry>, String> {
    let store = MemoryStore::open(&state.data_dir, &kube_context);
    Ok(store.list().into_iter().cloned().collect())
}

#[tauri::command]
pub async fn ai_memory_search(
    kube_context: String,
    query: String,
    state: State<'_, Arc<CoreState>>,
) -> Result<Vec<MemoryEntry>, String> {
    let store = MemoryStore::open(&state.data_dir, &kube_context);
    Ok(store.search(&query).into_iter().cloned().collect())
}

#[tauri::command]
pub async fn ai_memory_add(
    kube_context: String,
    content: String,
    tags: Vec<String>,
    state: State<'_, Arc<CoreState>>,
) -> Result<(), String> {
    let mut store = MemoryStore::open(&state.data_dir, &kube_context);
    store.add(&content, tags, MemorySource::User);
    Ok(())
}

#[tauri::command]
pub async fn ai_memory_delete(
    kube_context: String,
    id: String,
    state: State<'_, Arc<CoreState>>,
) -> Result<bool, String> {
    let mut store = MemoryStore::open(&state.data_dir, &kube_context);
    Ok(store.delete(&id))
}

#[tauri::command]
pub async fn ai_memory_clear(
    kube_context: String,
    state: State<'_, Arc<CoreState>>,
) -> Result<(), String> {
    let mut store = MemoryStore::open(&state.data_dir, &kube_context);
    store.clear();
    Ok(())
}

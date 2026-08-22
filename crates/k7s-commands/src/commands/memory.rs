// Tauri commands for the four-tier cluster memory / knowledge base.

use k7s_core::ai::memory::{MemoryEntry, MemorySource, MemoryStore, Tier, UserPreference};
use k7s_core::core::CoreState;
use k7s_core::error::AppResult;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn ai_memory_list(
    kube_context: String,
    tier: Option<String>,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<MemoryEntry>> {
    let store = MemoryStore::open(&state.data_dir, &kube_context);
    let tier_filter = tier.and_then(|t| match t.as_str() {
        "short_term" | "shortTerm" => Some(Tier::ShortTerm),
        "long_term" | "longTerm" => Some(Tier::LongTerm),
        "knowledge_vault" | "knowledgeVault" => Some(Tier::KnowledgeVault),
        _ => None,
    });
    Ok(store.list(tier_filter).into_iter().cloned().collect())
}

#[tauri::command]
pub async fn ai_memory_search(
    kube_context: String,
    query: String,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<MemoryEntry>> {
    let mut store = MemoryStore::open(&state.data_dir, &kube_context);
    Ok(store.search(&query))
}

#[tauri::command]
pub async fn ai_memory_search_vault(
    kube_context: String,
    query: String,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<MemoryEntry>> {
    let mut store = MemoryStore::open(&state.data_dir, &kube_context);
    Ok(store.search_vault(&query))
}

#[tauri::command]
pub async fn ai_memory_add(
    kube_context: String,
    content: String,
    tags: Vec<String>,
    tier: Option<String>,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    let mut store = MemoryStore::open(&state.data_dir, &kube_context);
    let t = match tier.as_deref() {
        Some("short_term" | "shortTerm") => Tier::ShortTerm,
        Some("long_term" | "longTerm") => Tier::LongTerm,
        Some("knowledge_vault" | "knowledgeVault") => Tier::KnowledgeVault,
        _ => Tier::LongTerm, // default to long-term for user-added notes
    };
    store.add(t, &content, tags, MemorySource::User);
    Ok(())
}

#[tauri::command]
pub async fn ai_memory_delete(
    kube_context: String,
    id: String,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<bool> {
    let mut store = MemoryStore::open(&state.data_dir, &kube_context);
    Ok(store.delete(&id))
}

#[tauri::command]
pub async fn ai_memory_clear(
    kube_context: String,
    tier: Option<String>,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    let mut store = MemoryStore::open(&state.data_dir, &kube_context);
    let tier_filter = tier.and_then(|t| match t.as_str() {
        "short_term" | "shortTerm" => Some(Tier::ShortTerm),
        "long_term" | "longTerm" => Some(Tier::LongTerm),
        "knowledge_vault" | "knowledgeVault" => Some(Tier::KnowledgeVault),
        _ => None,
    });
    store.clear(tier_filter);
    Ok(())
}

#[tauri::command]
pub async fn ai_memory_add_runbook(
    kube_context: String,
    title: String,
    content: String,
    tags: Vec<String>,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    let mut store = MemoryStore::open(&state.data_dir, &kube_context);
    store.add_runbook(&title, &content, tags);
    Ok(())
}

#[tauri::command]
pub async fn ai_memory_preferences(
    kube_context: String,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<UserPreference>> {
    let store = MemoryStore::open(&state.data_dir, &kube_context);
    Ok(store.preferences().to_vec())
}

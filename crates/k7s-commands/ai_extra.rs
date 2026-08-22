// Tauri commands for the additional AI capabilities: embedded models,
// browser tools, sessions, hooks, and swarm.

use crate::ai::embedded_models::{self, LocalModel, LocalPreset};
use crate::ai::session::{Session, SessionManager};
use crate::core::CoreState;
use crate::error::AppResult;
use std::sync::Arc;
use tauri::State;

// -- Embedded Models --

#[tauri::command]
pub async fn ai_discover_local_models(base_url: Option<String>) -> AppResult<Vec<LocalModel>> {
    Ok(embedded_models::discover_ollama(base_url.as_deref())
        .await
        .unwrap_or_default())
}

#[tauri::command]
pub async fn ai_local_model_presets() -> Vec<LocalPreset> {
    embedded_models::local_presets()
}

#[tauri::command]
pub async fn ai_check_local_model(base_url: String, model: String) -> AppResult<String> {
    Ok(embedded_models::check_model_health(&base_url, &model).await?)
}

// -- Browser Tools --

#[tauri::command]
pub async fn ai_fetch_url(
    url: String,
    max_chars: Option<usize>,
) -> AppResult<crate::ai::browser::UrlContent> {
    Ok(crate::ai::browser::fetch_url(&url, max_chars.unwrap_or(5000)).await?)
}

#[tauri::command]
pub async fn ai_web_search(query: String) -> AppResult<crate::ai::browser::SearchResult> {
    Ok(crate::ai::browser::web_search(&query).await?)
}

// -- Sessions --

fn session_mgr(state: &CoreState) -> SessionManager {
    SessionManager::new(state.data_dir.clone())
}

#[tauri::command]
pub async fn ai_session_list(state: State<'_, Arc<CoreState>>) -> AppResult<Vec<Session>> {
    Ok(session_mgr(&state).list().await)
}

#[tauri::command]
pub async fn ai_session_create(
    name: String,
    kube_context: Option<String>,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<Session> {
    Ok(session_mgr(&state).create(&name, kube_context).await)
}

#[tauri::command]
pub async fn ai_session_delete(id: String, state: State<'_, Arc<CoreState>>) -> AppResult<bool> {
    Ok(session_mgr(&state).delete(&id).await)
}

#[tauri::command]
pub async fn ai_session_queue_size(state: State<'_, Arc<CoreState>>) -> AppResult<usize> {
    Ok(session_mgr(&state).queue_size().await)
}

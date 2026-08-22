// Tauri commands for the additional AI capabilities: embedded models,
// browser tools, sessions, hooks, and swarm.

use k7s_core::ai::embedded_models::{self, LocalModel, LocalPreset};
use k7s_core::ai::session::{Session, SessionManager};
use k7s_core::core::CoreState;
use k7s_core::error::AppResult;
use std::sync::Arc;
use tauri::State;

// -- Embedded Models --

/// Wire arguments for [`ai_discover_local_models`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiDiscoverLocalModelsArgs {
    pub base_url: Option<String>,
}

pub async fn ai_discover_local_models_impl(base_url: Option<String>) -> AppResult<Vec<LocalModel>> {
    Ok(embedded_models::discover_ollama(base_url.as_deref())
        .await
        .unwrap_or_default())
}

#[tauri::command]
pub async fn ai_discover_local_models(base_url: Option<String>) -> AppResult<Vec<LocalModel>> {
    ai_discover_local_models_impl(base_url).await
}

pub async fn ai_local_model_presets_impl() -> Vec<LocalPreset> {
    embedded_models::local_presets()
}

#[tauri::command]
pub async fn ai_local_model_presets() -> Vec<LocalPreset> {
    ai_local_model_presets_impl().await
}

/// Wire arguments for [`ai_check_local_model`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiCheckLocalModelArgs {
    pub base_url: String,
    pub model: String,
}

pub async fn ai_check_local_model_impl(base_url: String, model: String) -> AppResult<String> {
    Ok(embedded_models::check_model_health(&base_url, &model).await?)
}

#[tauri::command]
pub async fn ai_check_local_model(base_url: String, model: String) -> AppResult<String> {
    ai_check_local_model_impl(base_url, model).await
}

// -- Browser Tools --

/// Wire arguments for [`ai_fetch_url`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiFetchUrlArgs {
    pub url: String,
    pub max_chars: Option<usize>,
}

pub async fn ai_fetch_url_impl(url: String, max_chars: Option<usize>) -> AppResult<k7s_core::ai::browser::UrlContent> {
    Ok(k7s_core::ai::browser::fetch_url(&url, max_chars.unwrap_or(5000)).await?)
}

#[tauri::command]
pub async fn ai_fetch_url(url: String, max_chars: Option<usize>) -> AppResult<k7s_core::ai::browser::UrlContent> {
    ai_fetch_url_impl(url, max_chars).await
}

/// Wire arguments for [`ai_web_search`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiWebSearchArgs {
    pub query: String,
}

pub async fn ai_web_search_impl(query: String) -> AppResult<k7s_core::ai::browser::SearchResult> {
    Ok(k7s_core::ai::browser::web_search(&query).await?)
}

#[tauri::command]
pub async fn ai_web_search(query: String) -> AppResult<k7s_core::ai::browser::SearchResult> {
    ai_web_search_impl(query).await
}

// -- Sessions --

fn session_mgr(state: &CoreState) -> SessionManager {
    SessionManager::new(state.data_dir.clone())
}

pub async fn ai_session_list_impl(state: std::sync::Arc<CoreState>) -> AppResult<Vec<Session>> {
    Ok(session_mgr(&state).list().await)
}

#[tauri::command]
pub async fn ai_session_list(state: State<'_, Arc<CoreState>>) -> AppResult<Vec<Session>> {
    ai_session_list_impl(state.inner().clone()).await
}

/// Wire arguments for [`ai_session_create`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiSessionCreateArgs {
    pub name: String,
    pub kube_context: Option<String>,
}

pub async fn ai_session_create_impl(state: std::sync::Arc<CoreState>, name: String, kube_context: Option<String>) -> AppResult<Session> {
    Ok(session_mgr(&state).create(&name, kube_context).await)
}

#[tauri::command]
pub async fn ai_session_create(name: String, kube_context: Option<String>, state: State<'_, Arc<CoreState>>) -> AppResult<Session> {
    ai_session_create_impl(state.inner().clone(), name, kube_context).await
}

/// Wire arguments for [`ai_session_delete`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiSessionDeleteArgs {
    pub id: String,
}

pub async fn ai_session_delete_impl(state: std::sync::Arc<CoreState>, id: String) -> AppResult<bool> {
    Ok(session_mgr(&state).delete(&id).await)
}

#[tauri::command]
pub async fn ai_session_delete(id: String, state: State<'_, Arc<CoreState>>) -> AppResult<bool> {
    ai_session_delete_impl(state.inner().clone(), id).await
}

pub async fn ai_session_queue_size_impl(state: std::sync::Arc<CoreState>) -> AppResult<usize> {
    Ok(session_mgr(&state).queue_size().await)
}

#[tauri::command]
pub async fn ai_session_queue_size(state: State<'_, Arc<CoreState>>) -> AppResult<usize> {
    ai_session_queue_size_impl(state.inner().clone()).await
}

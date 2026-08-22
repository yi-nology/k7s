// Tauri commands for the AI cron scheduler.

use k7s_core::ai::cron::{CronScheduler, CronTask};
use k7s_core::core::CoreState;
use k7s_core::error::AppResult;
use std::sync::Arc;
use tauri::State;

/// Shared cron scheduler — created lazily and stored in CoreState.
/// For now, we create a new one per call (cheap: just loads JSON).
/// A production version would store it in CoreState.
fn scheduler(state: &CoreState) -> CronScheduler {
    CronScheduler::new(state.data_dir.clone())
}

pub async fn ai_cron_list_impl(state: std::sync::Arc<CoreState>) -> AppResult<Vec<CronTask>> {
    Ok(scheduler(&state).list().await)
}

#[tauri::command]
pub async fn ai_cron_list(state: State<'_, Arc<CoreState>>) -> AppResult<Vec<CronTask>> {
    ai_cron_list_impl(state.inner().clone()).await
}

pub async fn ai_cron_presets_impl() -> AppResult<Vec<CronTask>> {
    Ok(k7s_core::ai::cron::builtin_presets())
}

#[tauri::command]
pub async fn ai_cron_presets() -> AppResult<Vec<CronTask>> {
    ai_cron_presets_impl().await
}

/// Wire arguments for [`ai_cron_add`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiCronAddArgs {
    pub task: CronTask,
}

pub async fn ai_cron_add_impl(state: std::sync::Arc<CoreState>, task: CronTask) -> AppResult<()> {
    scheduler(&state).add(task).await;
    Ok(())
}

#[tauri::command]
pub async fn ai_cron_add(task: CronTask, state: State<'_, Arc<CoreState>>) -> AppResult<()> {
    ai_cron_add_impl(state.inner().clone(), task).await
}

/// Wire arguments for [`ai_cron_update`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiCronUpdateArgs {
    pub task: CronTask,
}

pub async fn ai_cron_update_impl(
    state: std::sync::Arc<CoreState>,
    task: CronTask,
) -> AppResult<bool> {
    Ok(scheduler(&state).update(&task).await)
}

#[tauri::command]
pub async fn ai_cron_update(task: CronTask, state: State<'_, Arc<CoreState>>) -> AppResult<bool> {
    ai_cron_update_impl(state.inner().clone(), task).await
}

/// Wire arguments for [`ai_cron_delete`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiCronDeleteArgs {
    pub id: String,
}

pub async fn ai_cron_delete_impl(state: std::sync::Arc<CoreState>, id: String) -> AppResult<bool> {
    Ok(scheduler(&state).delete(&id).await)
}

#[tauri::command]
pub async fn ai_cron_delete(id: String, state: State<'_, Arc<CoreState>>) -> AppResult<bool> {
    ai_cron_delete_impl(state.inner().clone(), id).await
}

/// Wire arguments for [`ai_cron_toggle`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiCronToggleArgs {
    pub id: String,
}

pub async fn ai_cron_toggle_impl(state: std::sync::Arc<CoreState>, id: String) -> AppResult<bool> {
    Ok(scheduler(&state).toggle(&id).await)
}

#[tauri::command]
pub async fn ai_cron_toggle(id: String, state: State<'_, Arc<CoreState>>) -> AppResult<bool> {
    ai_cron_toggle_impl(state.inner().clone(), id).await
}

/// Wire arguments for [`ai_cron_history`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // AI commands are not registry-routed; the web shell keeps bespoke handlers
pub(crate) struct AiCronHistoryArgs {
    pub task_id: Option<String>,
}

pub async fn ai_cron_history_impl(
    state: std::sync::Arc<CoreState>,
    task_id: Option<String>,
) -> AppResult<Vec<k7s_core::ai::cron::CronRunResult>> {
    Ok(scheduler(&state).history(task_id.as_deref()).await)
}

#[tauri::command]
pub async fn ai_cron_history(
    task_id: Option<String>,
    state: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<k7s_core::ai::cron::CronRunResult>> {
    ai_cron_history_impl(state.inner().clone(), task_id).await
}

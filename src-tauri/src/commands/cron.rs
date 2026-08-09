//! Tauri commands for the AI cron scheduler.

use crate::ai::cron::{CronScheduler, CronTask};
use crate::core::CoreState;
use std::sync::Arc;
use tauri::State;

/// Shared cron scheduler — created lazily and stored in CoreState.
/// For now, we create a new one per call (cheap: just loads JSON).
/// A production version would store it in CoreState.
fn scheduler(state: &CoreState) -> CronScheduler {
    CronScheduler::new(state.data_dir.clone())
}

#[tauri::command]
pub async fn ai_cron_list(state: State<'_, Arc<CoreState>>) -> Result<Vec<CronTask>, String> {
    Ok(scheduler(&state).list().await)
}

#[tauri::command]
pub async fn ai_cron_presets() -> Result<Vec<CronTask>, String> {
    Ok(crate::ai::cron::builtin_presets())
}

#[tauri::command]
pub async fn ai_cron_add(task: CronTask, state: State<'_, Arc<CoreState>>) -> Result<(), String> {
    scheduler(&state).add(task).await;
    Ok(())
}

#[tauri::command]
pub async fn ai_cron_update(
    task: CronTask,
    state: State<'_, Arc<CoreState>>,
) -> Result<bool, String> {
    Ok(scheduler(&state).update(&task).await)
}

#[tauri::command]
pub async fn ai_cron_delete(id: String, state: State<'_, Arc<CoreState>>) -> Result<bool, String> {
    Ok(scheduler(&state).delete(&id).await)
}

#[tauri::command]
pub async fn ai_cron_toggle(id: String, state: State<'_, Arc<CoreState>>) -> Result<bool, String> {
    Ok(scheduler(&state).toggle(&id).await)
}

#[tauri::command]
pub async fn ai_cron_history(
    task_id: Option<String>,
    state: State<'_, Arc<CoreState>>,
) -> Result<Vec<crate::ai::cron::CronRunResult>, String> {
    Ok(scheduler(&state).history(task_id.as_deref()).await)
}

// Tauri commands for the k8s skill market.

use k7s_core::ai::skills::{Skill, SkillRegistry};
use k7s_core::core::CoreState;
use k7s_core::error::AppResult;
#[cfg(feature = "ipc")]
use std::sync::Arc;
#[cfg(feature = "ipc")]
use tauri::State;

pub async fn ai_list_skills_impl(state: std::sync::Arc<CoreState>) -> AppResult<Vec<Skill>> {
    let reg = SkillRegistry::load(Some(&state.data_dir));
    Ok(reg.list().into_iter().cloned().collect())
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn ai_list_skills(state: State<'_, Arc<CoreState>>) -> AppResult<Vec<Skill>> {
    ai_list_skills_impl(state.inner().clone()).await
}

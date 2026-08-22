// Tauri commands for the k8s skill market.

use k7s_core::ai::skills::{Skill, SkillRegistry};
use k7s_core::core::CoreState;
use k7s_core::error::AppResult;
use std::sync::Arc;
use tauri::State;

pub async fn ai_list_skills_impl(state: std::sync::Arc<CoreState>) -> AppResult<Vec<Skill>> {
    let reg = SkillRegistry::load(Some(&state.data_dir));
    Ok(reg.list().into_iter().cloned().collect())
}

#[tauri::command]
pub async fn ai_list_skills(state: State<'_, Arc<CoreState>>) -> AppResult<Vec<Skill>> {
    ai_list_skills_impl(state.inner().clone()).await
}

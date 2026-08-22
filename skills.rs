// Tauri commands for the k8s skill market.

use crate::ai::skills::{Skill, SkillRegistry};
use crate::core::CoreState;
use crate::error::AppResult;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn ai_list_skills(state: State<'_, Arc<CoreState>>) -> AppResult<Vec<Skill>> {
    let reg = SkillRegistry::load(Some(&state.data_dir));
    Ok(reg.list().into_iter().cloned().collect())
}

//! k7s - Kubernetes cluster manager (Tauri + Rust backend)
//!
//! This crate holds the Tauri runtime, the Kubernetes client, and the
//! command handlers exposed to the React frontend.

mod commands;
mod kube;

use std::sync::Mutex;

/// Application-wide state held by the Tauri runtime.
///
/// `current_context` is the name of the kubeconfig context the user picked
/// in the UI. It is `None` when we should fall back to whatever
/// `kube::Client::try_default` resolves to.
pub struct AppState {
    pub current_context: Mutex<Option<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            current_context: Mutex::new(None),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_contexts,
            commands::get_current_context,
            commands::set_current_context,
            commands::list_namespaces,
            commands::list_pods,
            commands::list_nodes,
            commands::list_deployments,
            commands::list_statefulsets,
            commands::list_daemonsets,
            commands::list_replicasets,
            commands::list_jobs,
            commands::list_cronjobs,
            commands::list_services,
            commands::list_configmaps,
            commands::list_secrets,
            commands::list_pvc,
            commands::list_hpa,
            commands::list_events,
            commands::get_yaml,
            commands::delete_resource,
        ])
        .run(tauri::generate_context!())
        .expect("error while running k7s");
}

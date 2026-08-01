//! k7s - Kubernetes cluster manager (Tauri + Rust backend)
//!
//! This crate holds the Tauri runtime, the Kubernetes client, and the
//! command handlers exposed to the React frontend.

mod commands;
mod kube;

use std::collections::HashMap;
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use tokio::sync::oneshot;

/// One live port-forward (kept in `AppState::port_forwards`).
///
/// `cancel` is taken on `stop_port_forward` to signal the background task
/// to drop the TCP listener and exit. It is `None` once consumed.
pub struct PortForward {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub namespace: String,
    pub local_port: u16,
    pub remote_port: u16,
    pub started_at: DateTime<Utc>,
    pub cancel: Option<oneshot::Sender<()>>,
}

/// Application-wide state held by the Tauri runtime.
///
/// `current_context` is the name of the kubeconfig context the user picked
/// in the UI. It is `None` when we should fall back to whatever
/// `kube::Client::try_default` resolves to.
pub struct AppState {
    pub current_context: Mutex<Option<String>>,
    pub port_forwards: Mutex<HashMap<String, PortForward>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            current_context: Mutex::new(None),
            port_forwards: Mutex::new(HashMap::new()),
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
            commands::get_pod_logs,
            commands::exec_pod,
            commands::start_port_forward,
            commands::stop_port_forward,
            commands::list_port_forwards,
        ])
        .run(tauri::generate_context!())
        .expect("error while running k7s");
}

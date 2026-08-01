//! k7s - Kubernetes cluster manager (Tauri + Rust backend)
//!
//! ## Module map
//!
//! - `commands::*` — Tauri command handlers, split by domain
//!   (context, connect, resources, actions, logs, shell, portforward,
//!   events).
//! - `error`       — unified `AppError` for every command return type.
//! - `kube::*`     — the Kubernetes client layer, split by concern
//!   (client, manager, dto, mappers, watchers, logs, exec, portforward,
//!   properties, metrics, discovery).
//!
//! ## State
//!
//! The Tauri runtime holds exactly one `Arc<ClientManager>`. Commands
//! take `State<'_, Arc<ClientManager>>` and call methods on it. The
//! manager owns the active `kube::Client`, the current context, and
//! the cancellation handles for every live task (log streams, shells,
//! port-forwards). On context switch / disconnect, every task is
//! cancelled before the client is dropped.

mod commands;
mod error;
mod kube;

use std::sync::Arc;

use crate::kube::manager::ClientManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(ClientManager::new()))
        .invoke_handler(tauri::generate_handler![
            // ---- context ----
            commands::context::list_contexts,
            commands::context::import_kubeconfig,
            commands::context::current_context,
            // ---- connect ----
            commands::connect::connect,
            commands::connect::disconnect,
            // ---- resources (list) ----
            commands::resources::list_namespaces,
            commands::resources::list_nodes,
            commands::resources::list_pods,
            commands::resources::list_deployments,
            commands::resources::list_statefulsets,
            commands::resources::list_daemonsets,
            commands::resources::list_replicasets,
            commands::resources::list_jobs,
            commands::resources::list_cronjobs,
            commands::resources::list_services,
            commands::resources::list_ingresses,
            commands::resources::list_ingressclasses,
            commands::resources::list_configmaps,
            commands::resources::list_secrets,
            commands::resources::list_serviceaccounts,
            commands::resources::list_pvc,
            commands::resources::list_storageclasses,
            commands::resources::list_poddisruptionbudgets,
            commands::resources::list_rolebindings,
            commands::resources::list_hpa,
            // ---- events ----
            commands::events::list_events,
            // ---- resources (yaml / delete) ----
            commands::resources::get_yaml,
            commands::resources::apply_yaml,
            commands::resources::delete_resource,
            // ---- actions (P3) ----
            commands::actions::scale_resource,
            commands::actions::restart_pod,
            commands::actions::restart_rollout,
            commands::actions::set_cordon,
            commands::actions::drain_node,
            // ---- logs (P2) ----
            commands::logs::start_log_stream,
            commands::logs::stop_log_stream,
            commands::logs::export_logs,
            // ---- shell (P4) ----
            commands::shell::exec_pod,
            commands::shell::start_shell,
            commands::shell::stop_shell,
            commands::shell::shell_input,
            commands::shell::shell_resize,
            // ---- port-forward ----
            commands::portforward::start_port_forward,
            commands::portforward::stop_port_forward,
            commands::portforward::list_port_forwards,
        ])
        .run(tauri::generate_context!())
        .expect("error while running k7s");
}

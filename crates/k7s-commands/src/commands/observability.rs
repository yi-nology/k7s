// Observability commands: metrics, Grafana, AlertManager, Loki/Audit,
// Endpoints, CronJob trigger, and saved PromQL queries.

use crate::commands::core::require_client;
use k7s_core::core::CoreState;
use k7s_core::error::{AppError, AppResult};
use k7s_core::kube::{alerting, audit, endpoints, metrics_config, saved_queries};
#[cfg(not(target_os = "ios"))]
use k7s_core::kube::grafana;
use k7s_deps::kube::api::Api;
use std::sync::Arc;
use tauri::State;

// ---------------------------------------------------------------------------
// Endpoints (Phase 1 Tier-2 of KubePi parity) — drilling into "Service has
// no endpoints" is the canonical 503 debugging path, and the Endpoints
// object is the thing to look at.
// ---------------------------------------------------------------------------

/// List EndpointSlices cluster-wide. One row per slice, with the
/// ready/total address count so 503s are obvious at a glance.
#[tauri::command]
pub async fn list_endpoints(
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<endpoints::EndpointRow>> {
    let client = require_client(&mgr.manager).await?;
    endpoints::list_all(&client).await
}

/// EndpointSlices for a single Service — the row context menu's
/// "View endpoints" action.
#[tauri::command]
pub async fn list_endpoints_for_service(
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<endpoints::EndpointRow>> {
    let client = require_client(&mgr.manager).await?;
    endpoints::list_for_service(&client, &namespace, &name).await
}

/// Per-address detail for one EndpointSlice.
#[tauri::command]
pub async fn list_endpoint_addresses(
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<endpoints::EndpointAddress>> {
    let client = require_client(&mgr.manager).await?;
    endpoints::addresses_for(&client, &namespace, &name).await
}

// ---------------------------------------------------------------------------
// CronJob manual trigger (Phase 2 Tier-2 of KubePi parity) — KubePi has a
// "Run now" action for jobs whose schedule doesn't align with the moment
// you need them.
// ---------------------------------------------------------------------------

/// Manually create a Job from a CronJob. Mirrors what
/// `kubectl create job --from=cronjob/<name>` does, and returns the new
/// Job's name so the UI can navigate to it.
#[tauri::command]
pub async fn trigger_cronjob(
    namespace: String,
    name: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<String> {
    use k7s_deps::k8s_openapi::api::batch::v1::{CronJob, Job};
    use k7s_deps::k8s_openapi::apimachinery::pkg::apis::meta::v1::{ObjectMeta, OwnerReference};
    use k7s_deps::kube::api::PostParams;

    let client = require_client(&mgr.manager).await?;
    let cj_api: Api<CronJob> = Api::namespaced(client.clone(), &namespace);
    let cj = cj_api.get(&name).await?;
    let job_name = format!("{name}-manual-{}", k7s_deps::chrono::Utc::now().timestamp());
    let job = Job {
        metadata: ObjectMeta {
            name: Some(job_name.clone()),
            namespace: Some(namespace.clone()),
            annotations: Some({
                let mut m = std::collections::BTreeMap::new();
                m.insert(
                    "cronjob.kubernetes.io/instantiate".to_string(),
                    "manual".to_string(),
                );
                m
            }),
            owner_references: Some(vec![OwnerReference {
                api_version: "batch/v1".to_string(),
                kind: "CronJob".to_string(),
                name,
                uid: cj.metadata.uid.unwrap_or_default(),
                controller: Some(true),
                ..Default::default()
            }]),
            ..Default::default()
        },
        spec: cj.spec.job_template.spec,
        ..Default::default()
    };
    let job_api: Api<Job> = Api::namespaced(client, &namespace);
    job_api
        .create(&PostParams::default(), &job)
        .await
        .map_err(|e| AppError::Kube(format!("create job: {e}")))?;
    Ok(job_name)
}

// ---------------------------------------------------------------------------
// Metrics / Prometheus multi-instance (Phase 1 Tier-2 of KubePi parity).
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn metrics_list() -> AppResult<Vec<metrics_config::MetricsConfig>> {
    metrics_config::list()
}

#[tauri::command]
pub fn metrics_upsert(
    name: String,
    url: String,
    username: String,
    password: String,
    description: String,
) -> AppResult<metrics_config::MetricsConfig> {
    metrics_config::upsert(&name, &url, &username, &password, &description)
}

#[tauri::command]
pub fn metrics_remove(name: String) -> AppResult<()> {
    metrics_config::remove(&name)
}

#[tauri::command]
pub async fn metrics_test(name: String) -> AppResult<()> {
    metrics_config::test_connect(&name).await
}

#[tauri::command]
pub async fn metrics_query(name: String, promql: String) -> AppResult<metrics_config::QueryResult> {
    metrics_config::query(&name, &promql).await
}

#[tauri::command]
pub async fn metrics_query_range(
    name: String,
    promql: String,
    start_ms: i64,
    end_ms: i64,
    step_seconds: i64,
) -> AppResult<metrics_config::QueryResult> {
    metrics_config::query_range(&name, &promql, start_ms, end_ms, step_seconds).await
}

// ---------------------------------------------------------------------------
// Grafana — excluded from iPadOS build (poor touch ergonomics for embedded
// iframe dashboards).
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "ios"))]
mod grafana_cmds {
    use super::*;

    #[tauri::command]
    pub fn grafana_list() -> AppResult<Vec<grafana::GrafanaConfig>> {
        grafana::list()
    }

    #[tauri::command]
    pub fn grafana_upsert(
        name: String,
        url: String,
        username: String,
        password: String,
        api_token: String,
        default_datasource: String,
        description: String,
    ) -> AppResult<grafana::GrafanaConfig> {
        grafana::upsert(
            &name,
            &url,
            &username,
            &password,
            &api_token,
            &default_datasource,
            &description,
        )
    }

    #[tauri::command]
    pub fn grafana_remove(name: String) -> AppResult<()> {
        grafana::remove(&name)
    }

    #[tauri::command]
    pub async fn grafana_test(name: String) -> AppResult<()> {
        grafana::test_connect(&name).await
    }

    #[tauri::command]
    pub fn grafana_presets() -> Vec<grafana::DashboardPreset> {
        grafana::preset_dashboards()
    }

    #[tauri::command]
    pub fn grafana_dashboard_url(
        name: String,
        uid: String,
        from_ms: i64,
        to_ms: i64,
    ) -> AppResult<String> {
        grafana::dashboard_url(&name, &uid, from_ms, to_ms)
    }

    #[tauri::command]
    pub async fn grafana_search_dashboards(
        name: String,
        query: String,
    ) -> AppResult<Vec<grafana::DashboardSearchResult>> {
        grafana::search_dashboards(&name, &query).await
    }
}
#[cfg(not(target_os = "ios"))]
pub use grafana_cmds::*;

// ---------------------------------------------------------------------------
// AlertManager (Phase 1 Tier-2 of KubePi parity).
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn alertmanager_list() -> AppResult<Vec<alerting::AlertManager>> {
    alerting::list()
}

#[tauri::command]
pub fn alertmanager_upsert(
    name: String,
    url: String,
    bearer_token: String,
    description: String,
) -> AppResult<alerting::AlertManager> {
    alerting::upsert(&name, &url, &bearer_token, &description)
}

#[tauri::command]
pub fn alertmanager_remove(name: String) -> AppResult<()> {
    alerting::remove(&name)
}

#[tauri::command]
pub async fn alertmanager_test(name: String) -> AppResult<()> {
    alerting::test_connect(&name).await
}

#[tauri::command]
pub async fn alertmanager_alerts(name: String) -> AppResult<Vec<alerting::Alert>> {
    alerting::list_alerts(&name).await
}

#[tauri::command]
pub async fn alertmanager_silences(name: String) -> AppResult<Vec<alerting::Silence>> {
    alerting::list_silences(&name).await
}

#[tauri::command]
pub async fn alertmanager_create_silence(
    instance: String,
    request: alerting::CreateSilenceRequest,
) -> AppResult<String> {
    alerting::create_silence(&instance, &request).await
}

#[tauri::command]
pub async fn alertmanager_delete_silence(instance: String, silence_id: String) -> AppResult<()> {
    alerting::delete_silence(&instance, &silence_id).await
}

#[tauri::command]
pub async fn prometheus_rules(instance: String) -> AppResult<Vec<alerting::RuleGroup>> {
    alerting::prometheus_rules(&instance).await
}

// ---------------------------------------------------------------------------
// Loki / K8s Audit log (Phase 3 — KubePi parity).
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn loki_list() -> AppResult<Vec<audit::LokiConfig>> {
    audit::list()
}

#[tauri::command]
pub fn loki_upsert(
    name: String,
    url: String,
    username: String,
    password: String,
    description: String,
) -> AppResult<audit::LokiConfig> {
    audit::upsert(&name, &url, &username, &password, &description)
}

#[tauri::command]
pub fn loki_remove(name: String) -> AppResult<()> {
    audit::remove(&name)
}

#[tauri::command]
pub async fn loki_test(name: String) -> AppResult<()> {
    audit::test_connect(&name).await
}

#[tauri::command]
pub async fn audit_events(query: audit::AuditQuery) -> AppResult<Vec<audit::AuditEvent>> {
    audit::query_audit_events(&query).await
}

// ---------------------------------------------------------------------------
// Saved PromQL queries (Phase 2 — named queries + in-memory cache).
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn saved_queries_list() -> AppResult<Vec<saved_queries::SavedQuery>> {
    saved_queries::list()
}

#[tauri::command]
pub fn saved_queries_upsert(
    query: saved_queries::SavedQuery,
) -> AppResult<saved_queries::SavedQuery> {
    saved_queries::upsert(query)
}

#[tauri::command]
pub fn saved_queries_remove(name: String) -> AppResult<()> {
    saved_queries::remove(&name)
}

#[tauri::command]
pub fn saved_queries_clear_cache() {
    saved_queries::clear_cache();
}

#[tauri::command]
pub async fn saved_queries_run(
    query: saved_queries::SavedQuery,
    instance: String,
    force_refresh: bool,
) -> AppResult<metrics_config::QueryResult> {
    saved_queries::run_saved(&query, &instance, force_refresh).await
}

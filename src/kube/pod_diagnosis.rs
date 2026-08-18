//! Pod termination diagnosis: explains why a Pod is unhealthy.
//!
//! Given a Pod name, inspects container statuses and produces a structured
//! diagnosis with exit codes, reasons, and a human-readable summary.

use crate::error::AppResult;
use k7s_deps::k8s_openapi::api::core::v1::Pod;
use k7s_deps::kube::api::Api;
use k7s_deps::kube::Client;
use serde::Serialize;

/// Diagnosis for a single container.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContainerDiagnosis {
    pub name: String,
    /// "container" or "initContainer".
    pub container_type: String,
    pub ready: bool,
    pub restart_count: i32,
    /// "running", "waiting", "terminated", or "unknown".
    pub current_state: String,
    pub current_reason: Option<String>,
    pub current_message: Option<String>,
    pub current_exit_code: Option<i32>,
    pub last_termination_reason: Option<String>,
    pub last_termination_exit_code: Option<i32>,
}

/// Overall Pod diagnosis.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PodDiagnosis {
    pub pod: String,
    pub namespace: String,
    pub phase: String,
    pub containers: Vec<ContainerDiagnosis>,
    /// Human-readable one-line summary.
    pub summary: String,
    /// Severity: "ok", "warn", or "critical".
    pub severity: String,
    /// Common diagnosis pattern, if detected (e.g. "oomkilled", "crashloop").
    pub pattern: Option<String>,
}

/// Analyze a Pod's termination state and return a structured diagnosis.
pub async fn diagnose_pod(
    client: Client,
    namespace: &str,
    pod_name: &str,
) -> AppResult<PodDiagnosis> {
    let api: Api<Pod> = Api::namespaced(client, namespace);
    let pod = api.get(pod_name).await?;

    let phase = pod
        .status
        .as_ref()
        .and_then(|s| s.phase.clone())
        .unwrap_or_else(|| "Unknown".into());

    let mut containers = Vec::new();

    if let Some(status) = &pod.status {
        // Regular containers
        if let Some(list) = &status.container_statuses {
            for cs in list {
                containers.push(analyze_container_status(cs, "container"));
            }
        }
        // Init containers
        if let Some(list) = &status.init_container_statuses {
            for cs in list {
                containers.push(analyze_container_status(cs, "initContainer"));
            }
        }
    }

    let (summary, severity, pattern) = build_diagnosis(&phase, &containers);

    Ok(PodDiagnosis {
        pod: pod_name.to_string(),
        namespace: namespace.to_string(),
        phase,
        containers,
        summary,
        severity,
        pattern,
    })
}

/// Extract state information from a single `ContainerStatus`.
fn analyze_container_status(
    cs: &k7s_deps::k8s_openapi::api::core::v1::ContainerStatus,
    container_type: &str,
) -> ContainerDiagnosis {
    let (current_state, current_reason, current_message, current_exit_code) =
        if let Some(running) = &cs.state.as_ref().and_then(|s| s.running.as_ref()) {
            let _ = running; // suppress unused warning
            ("running".into(), None, None, None)
        } else if let Some(waiting) = &cs.state.as_ref().and_then(|s| s.waiting.as_ref()) {
            (
                "waiting".into(),
                waiting.reason.clone(),
                waiting.message.clone(),
                None,
            )
        } else if let Some(terminated) = &cs.state.as_ref().and_then(|s| s.terminated.as_ref()) {
            (
                "terminated".into(),
                terminated.reason.clone(),
                terminated.message.clone(),
                Some(terminated.exit_code),
            )
        } else {
            ("unknown".into(), None, None, None)
        };

    let (last_termination_reason, last_termination_exit_code) = cs
        .last_state
        .as_ref()
        .and_then(|s| s.terminated.as_ref())
        .map(|t| (t.reason.clone(), Some(t.exit_code)))
        .unwrap_or((None, None));

    ContainerDiagnosis {
        name: cs.name.clone(),
        container_type: container_type.into(),
        ready: cs.ready,
        restart_count: cs.restart_count,
        current_state,
        current_reason,
        current_message,
        current_exit_code,
        last_termination_reason,
        last_termination_exit_code,
    }
}

/// Pattern-match against well-known failure modes and produce a summary.
fn build_diagnosis(
    phase: &str,
    containers: &[ContainerDiagnosis],
) -> (String, String, Option<String>) {
    // Check for common container-level patterns
    for c in containers {
        // OOMKilled: exit code 137 (128 + SIGKILL)
        if c.current_exit_code == Some(137) || c.last_termination_exit_code == Some(137) {
            return (
                format!(
                    "OOMKilled: container '{}' exceeded memory limit (exit 137)",
                    c.name
                ),
                "critical".into(),
                Some("oomkilled".into()),
            );
        }

        // CrashLoopBackOff
        if c.current_reason.as_deref() == Some("CrashLoopBackOff") {
            let exit = c.last_termination_exit_code.unwrap_or(-1);
            return (
                format!(
                    "CrashLoopBackOff: container '{}' crashing repeatedly (last exit {})",
                    c.name, exit
                ),
                "critical".into(),
                Some("crashloop".into()),
            );
        }

        // Image pull failure
        if c.current_reason.as_deref() == Some("ImagePullBackOff")
            || c.current_reason.as_deref() == Some("ErrImagePull")
        {
            return (
                format!("ImagePullFailed: container '{}' cannot pull image", c.name),
                "critical".into(),
                Some("imagepull".into()),
            );
        }

        // Missing ConfigMap/Secret
        if c.current_reason.as_deref() == Some("CreateContainerConfigError") {
            return (
                format!(
                    "ConfigError: container '{}' has missing ConfigMap or Secret",
                    c.name
                ),
                "critical".into(),
                Some("configerror".into()),
            );
        }

        // Segfault: exit code 139 (128 + SIGSEGV)
        if c.current_exit_code == Some(139) || c.last_termination_exit_code == Some(139) {
            return (
                format!(
                    "SegFault: container '{}' crashed with SIGSEGV (exit 139)",
                    c.name
                ),
                "critical".into(),
                Some("segfault".into()),
            );
        }

        // Clean exit but unexpected (exit 0 with restarts)
        if (c.current_exit_code == Some(0) || c.last_termination_exit_code == Some(0))
            && c.restart_count > 0
        {
            return (
                format!(
                    "UnexpectedRestart: container '{}' exited cleanly but was restarted {} time(s)",
                    c.name, c.restart_count
                ),
                "warn".into(),
                Some("unexpected_restart".into()),
            );
        }

        // Application error: exit code 1
        if c.current_exit_code == Some(1) || c.last_termination_exit_code == Some(1) {
            return (
                format!(
                    "ApplicationError: container '{}' exited with code 1",
                    c.name
                ),
                "critical".into(),
                Some("apperror".into()),
            );
        }

        // Not ready with restarts (generic instability)
        if !c.ready && c.restart_count > 0 {
            return (
                format!(
                    "Unstable: container '{}' not ready ({} restarts)",
                    c.name, c.restart_count
                ),
                "warn".into(),
                Some("unstable".into()),
            );
        }
    }

    // Pod-level checks
    match phase {
        "Failed" => (
            "Pod has failed".into(),
            "critical".into(),
            Some("podfailed".into()),
        ),
        "Pending" => (
            "Pod is pending (scheduling or image pull in progress)".into(),
            "warn".into(),
            Some("pending".into()),
        ),
        _ => {
            let not_ready: Vec<_> = containers.iter().filter(|c| !c.ready).collect();
            if not_ready.is_empty() {
                ("All containers healthy".into(), "ok".into(), None)
            } else {
                (
                    format!("{} container(s) not ready", not_ready.len()),
                    "warn".into(),
                    Some("notready".into()),
                )
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_container(
        name: &str,
        ready: bool,
        restarts: i32,
        state: &str,
        exit_code: Option<i32>,
        reason: Option<&str>,
    ) -> ContainerDiagnosis {
        ContainerDiagnosis {
            name: name.into(),
            container_type: "container".into(),
            ready,
            restart_count: restarts,
            current_state: state.into(),
            current_reason: reason.map(|s| s.into()),
            current_message: None,
            current_exit_code: exit_code,
            last_termination_reason: None,
            last_termination_exit_code: None,
        }
    }

    #[test]
    fn oom_killed() {
        let c = make_container("app", false, 3, "terminated", Some(137), Some("OOMKilled"));
        let (summary, severity, pattern) = build_diagnosis("Running", &[c]);
        assert_eq!(severity, "critical");
        assert_eq!(pattern.as_deref(), Some("oomkilled"));
        assert!(summary.contains("OOMKilled"));
    }

    #[test]
    fn oom_killed_from_last_state() {
        let mut c = make_container("app", true, 5, "running", None, None);
        c.last_termination_exit_code = Some(137);
        c.last_termination_reason = Some("OOMKilled".into());
        let (summary, severity, pattern) = build_diagnosis("Running", &[c]);
        assert_eq!(severity, "critical");
        assert_eq!(pattern.as_deref(), Some("oomkilled"));
        assert!(summary.contains("OOMKilled"));
    }

    #[test]
    fn crash_loop() {
        let c = ContainerDiagnosis {
            name: "app".into(),
            container_type: "container".into(),
            ready: false,
            restart_count: 10,
            current_state: "waiting".into(),
            current_reason: Some("CrashLoopBackOff".into()),
            current_message: None,
            current_exit_code: None,
            last_termination_reason: None,
            last_termination_exit_code: Some(1),
        };
        let (summary, severity, pattern) = build_diagnosis("Running", &[c]);
        assert_eq!(severity, "critical");
        assert_eq!(pattern.as_deref(), Some("crashloop"));
        assert!(summary.contains("CrashLoopBackOff"));
    }

    #[test]
    fn image_pull_back_off() {
        let c = make_container("app", false, 0, "waiting", None, Some("ImagePullBackOff"));
        let (summary, severity, pattern) = build_diagnosis("Pending", &[c]);
        assert_eq!(severity, "critical");
        assert_eq!(pattern.as_deref(), Some("imagepull"));
        assert!(summary.contains("ImagePullFailed"));
    }

    #[test]
    fn config_error() {
        let c = make_container(
            "app",
            false,
            0,
            "waiting",
            None,
            Some("CreateContainerConfigError"),
        );
        let (summary, severity, pattern) = build_diagnosis("Pending", &[c]);
        assert_eq!(severity, "critical");
        assert_eq!(pattern.as_deref(), Some("configerror"));
        assert!(summary.contains("ConfigError"));
    }

    #[test]
    fn segfault() {
        let c = make_container("app", false, 1, "terminated", Some(139), None);
        let (summary, severity, pattern) = build_diagnosis("Running", &[c]);
        assert_eq!(severity, "critical");
        assert_eq!(pattern.as_deref(), Some("segfault"));
        assert!(summary.contains("SIGSEGV"));
    }

    #[test]
    fn app_error_exit_1() {
        let c = make_container("app", false, 1, "terminated", Some(1), None);
        let (summary, severity, pattern) = build_diagnosis("Running", &[c]);
        assert_eq!(severity, "critical");
        assert_eq!(pattern.as_deref(), Some("apperror"));
        assert!(summary.contains("code 1"));
    }

    #[test]
    fn unexpected_restart_exit_0() {
        let c = make_container("app", true, 3, "running", None, None);
        // Also set last termination exit code to 0
        let mut c = c;
        c.last_termination_exit_code = Some(0);
        let (summary, severity, pattern) = build_diagnosis("Running", &[c]);
        assert_eq!(severity, "warn");
        assert_eq!(pattern.as_deref(), Some("unexpected_restart"));
        assert!(summary.contains("UnexpectedRestart"));
    }

    #[test]
    fn pod_failed() {
        let containers: Vec<ContainerDiagnosis> = vec![];
        let (_summary, severity, pattern) = build_diagnosis("Failed", &containers);
        assert_eq!(severity, "critical");
        assert_eq!(pattern.as_deref(), Some("podfailed"));
    }

    #[test]
    fn all_healthy() {
        let c = make_container("app", true, 0, "running", None, None);
        let (summary, severity, pattern) = build_diagnosis("Running", &[c]);
        assert_eq!(severity, "ok");
        assert!(pattern.is_none());
        assert!(summary.contains("healthy"));
    }

    #[test]
    fn not_ready_generic() {
        let c = make_container("app", false, 0, "waiting", None, None);
        let (_summary, severity, pattern) = build_diagnosis("Running", &[c]);
        assert_eq!(severity, "warn");
        assert_eq!(pattern.as_deref(), Some("notready"));
    }
}

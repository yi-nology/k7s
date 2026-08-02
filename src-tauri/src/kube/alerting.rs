//! AlertManager integration (Phase 1 Tier-2 of KubePi parity).
//!
//! Two roles, mirroring the metrics_config module:
//!
//!   1. **AlertManager registry** — a JSON file under the user config dir
//!      listing one or more AlertManager endpoints the user wants to talk
//!      to. Each entry has a name, base URL, and bearer-token auth, the
//!      common AlertManager-on-cluster setup.
//!   2. **Alert read-only views** — list active alerts, list silences,
//!      and (later) the UI can show a per-alert drill-down. We don't try
//!      to *create* silences or modify alert rules from k7s: the canonical
//!      tool for that is `amtool` or the AlertManager web UI, and an
//!      editor that can break pages of silence at the wrong keypress is
//!      a worse experience than just opening a browser tab.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AlertManager {
    pub name: String,
    /// `https://alertmanager.example.com` — no trailing slash.
    pub url: String,
    #[serde(default, skip_serializing)]
    pub bearer_token: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub last_refreshed: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct AlertManagerFile {
    managers: Vec<AlertManagerMeta>,
    /// Side-channel for tokens; the main file is safe to log/print,
    /// tokens are not.
    #[serde(default)]
    tokens: HashMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct AlertManagerMeta {
    name: String,
    url: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    last_error: Option<String>,
    #[serde(default)]
    last_refreshed: Option<String>,
}

fn config_path() -> AppResult<PathBuf> {
    let dir = match std::env::var_os("HOME") {
        Some(h) => std::path::PathBuf::from(h).join(if cfg!(target_os = "macos") {
            "Library/Application Support/k7s"
        } else {
            ".config/k7s"
        }),
        None => return Err(AppError::Other("no HOME".into())),
    };
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Other(format!("mkdir {}: {e}", dir.display())))?;
    Ok(dir.join("alertmanagers.json"))
}

fn load_file() -> AppResult<AlertManagerFile> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AlertManagerFile::default());
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Other(format!("read {}: {e}", path.display())))?;
    if text.trim().is_empty() {
        return Ok(AlertManagerFile::default());
    }
    serde_json::from_str(&text).map_err(|e| AppError::Other(format!("parse: {e}")))
}

fn save_file(f: &AlertManagerFile) -> AppResult<()> {
    let path = config_path()?;
    let text = serde_json::to_string_pretty(f)
        .map_err(|e| AppError::Other(format!("serialise: {e}")))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text)
        .map_err(|e| AppError::Other(format!("write tmp: {e}")))?;
    std::fs::rename(&tmp, &path)
        .map_err(|e| AppError::Other(format!("rename: {e}")))?;
    Ok(())
}

pub fn list() -> AppResult<Vec<AlertManager>> {
    let f = load_file()?;
    Ok(f.managers
        .into_iter()
        .map(|m| {
            let bearer_token = f.tokens.get(&m.name).cloned().unwrap_or_default();
            AlertManager {
                name: m.name,
                url: m.url,
                bearer_token,
                description: m.description,
                last_error: m.last_error,
                last_refreshed: m.last_refreshed,
            }
        })
        .collect())
}

pub fn upsert(
    name: &str,
    url: &str,
    bearer_token: &str,
    description: &str,
) -> AppResult<AlertManager> {
    let name = name.trim();
    let url = url.trim().trim_end_matches('/');
    if name.is_empty() {
        return Err(AppError::Other("name cannot be empty".into()));
    }
    if url.is_empty() {
        return Err(AppError::Other("url cannot be empty".into()));
    }
    let mut f = load_file()?;
    if let Some(idx) = f.managers.iter().position(|m| m.name == name) {
        f.managers[idx] = AlertManagerMeta {
            name: name.to_string(),
            url: url.to_string(),
            description: description.to_string(),
            last_error: None,
            last_refreshed: None,
        };
    } else {
        f.managers.push(AlertManagerMeta {
            name: name.to_string(),
            url: url.to_string(),
            description: description.to_string(),
            last_error: None,
            last_refreshed: None,
        });
    }
    if bearer_token.is_empty() {
        f.tokens.remove(name);
    } else {
        f.tokens.insert(name.to_string(), bearer_token.to_string());
    }
    save_file(&f)?;
    Ok(AlertManager {
        name: name.to_string(),
        url: url.to_string(),
        bearer_token: bearer_token.to_string(),
        description: description.to_string(),
        last_error: None,
        last_refreshed: None,
    })
}

pub fn remove(name: &str) -> AppResult<()> {
    let mut f = load_file()?;
    let before = f.managers.len();
    f.managers.retain(|m| m.name != name);
    f.tokens.remove(name);
    if f.managers.len() != before {
        save_file(&f)?;
    }
    Ok(())
}

pub async fn test_connect(name: &str) -> AppResult<()> {
    let cfg = find(name)?;
    let client = build_client()?;
    let url = format!("{}/-/healthy", cfg.url);
    let mut req = client.get(&url);
    if !cfg.bearer_token.is_empty() {
        req = req.bearer_auth(&cfg.bearer_token);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Other(format!("GET {url}: {e}")))?;
    let status = resp.status();
    if status.is_success() || status.as_u16() == 401 {
        Ok(())
    } else {
        Err(AppError::Other(format!("{url}: HTTP {status}")))
    }
}

/// One alert returned by AlertManager's `/api/v2/alerts` endpoint.
/// Only the fields we render in the UI are decoded; the rest of the
/// AM shape is dropped on the floor.
#[derive(Clone, Debug, Serialize)]
pub struct Alert {
    pub fingerprint: String,
    pub name: String,
    pub state: String,
    pub severity: String,
    pub summary: String,
    pub description: String,
    pub active_at: String,
    pub labels: HashMap<String, String>,
}

pub async fn list_alerts(name: &str) -> AppResult<Vec<Alert>> {
    let cfg = find(name)?;
    let client = build_client()?;
    let url = format!("{}/api/v2/alerts", cfg.url);
    let mut req = client.get(&url);
    if !cfg.bearer_token.is_empty() {
        req = req.bearer_auth(&cfg.bearer_token);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Other(format!("GET {url}: {e}")))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(AppError::Other(format!("{url}: HTTP {status}")));
    }
    let raw: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("decode: {e}")))?;
    Ok(raw.into_iter().map(map_alert).collect())
}

fn map_alert(v: serde_json::Value) -> Alert {
    let labels: HashMap<String, String> = v
        .get("labels")
        .and_then(|l| l.as_object())
        .map(|m| {
            m.iter()
                .map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_string()))
                .collect()
        })
        .unwrap_or_default();
    let annotations = v.get("annotations");
    Alert {
        fingerprint: v
            .get("fingerprint")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string(),
        name: labels.get("alertname").cloned().unwrap_or_default(),
        state: v
            .get("status")
            .and_then(|s| s.get("state"))
            .and_then(|s| s.as_str())
            .unwrap_or("unknown")
            .to_string(),
        severity: labels.get("severity").cloned().unwrap_or_default(),
        summary: annotations
            .and_then(|a| a.get("summary"))
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        description: annotations
            .and_then(|a| a.get("description"))
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        active_at: v
            .get("startsAt")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        labels,
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Silence {
    pub id: String,
    pub matchers: Vec<String>,
    pub created_by: String,
    pub comment: String,
    pub starts_at: String,
    pub ends_at: String,
    pub status: String,
}

pub async fn list_silences(name: &str) -> AppResult<Vec<Silence>> {
    let cfg = find(name)?;
    let client = build_client()?;
    let url = format!("{}/api/v2/silences", cfg.url);
    let mut req = client.get(&url);
    if !cfg.bearer_token.is_empty() {
        req = req.bearer_auth(&cfg.bearer_token);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Other(format!("GET {url}: {e}")))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(AppError::Other(format!("{url}: HTTP {status}")));
    }
    let raw: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("decode: {e}")))?;
    Ok(raw.into_iter().map(map_silence).collect())
}

fn map_silence(v: serde_json::Value) -> Silence {
    let matchers: Vec<String> = v
        .get("matchers")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let name = m.get("name").and_then(|n| n.as_str())?;
                    let value = m.get("value").and_then(|v| v.as_str())?;
                    let is_regex = m
                        .get("isRegex")
                        .and_then(|r| r.as_bool())
                        .unwrap_or(false);
                    Some(if is_regex {
                        format!("{name}=~{value}")
                    } else {
                        format!("{name}={value}")
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Silence {
        id: v
            .get("id")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string(),
        matchers,
        created_by: v
            .get("createdBy")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        comment: v
            .get("comment")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        starts_at: v
            .get("startsAt")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        ends_at: v
            .get("endsAt")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        status: v
            .get("status")
            .and_then(|s| s.get("state"))
            .and_then(|s| s.as_str())
            .unwrap_or("unknown")
            .to_string(),
    }
}

fn find(name: &str) -> AppResult<AlertManager> {
    list()?
        .into_iter()
        .find(|c| c.name == name)
        .ok_or_else(|| AppError::NotFound(format!("alertmanager '{name}' not found")))
}

fn build_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("k7s/alertmanager")
        .build()
        .map_err(|e| AppError::Other(format!("build client: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_alert_json() -> serde_json::Value {
        serde_json::json!({
            "fingerprint": "abc123",
            "status": { "state": "active" },
            "labels": {
                "alertname": "HighCpu",
                "severity": "warning",
                "instance": "node-1",
            },
            "annotations": {
                "summary": "CPU > 80%",
                "description": "node-1 CPU is at 95% for 10m",
            },
            "startsAt": "2024-01-01T00:00:00Z"
        })
    }

    #[test]
    fn map_alert_extracts_top_level_fields() {
        let a = map_alert(sample_alert_json());
        assert_eq!(a.fingerprint, "abc123");
        assert_eq!(a.name, "HighCpu");
        assert_eq!(a.severity, "warning");
        assert_eq!(a.state, "active");
        assert_eq!(a.summary, "CPU > 80%");
        assert_eq!(a.active_at, "2024-01-01T00:00:00Z");
    }

    #[test]
    fn map_alert_tolerates_missing_annotations() {
        let mut v = sample_alert_json();
        v.as_object_mut()
            .unwrap()
            .remove("annotations");
        let a = map_alert(v);
        assert_eq!(a.summary, "");
        assert_eq!(a.description, "");
    }

    #[test]
    fn map_alert_tolerates_missing_status_state() {
        let mut v = sample_alert_json();
        v.as_object_mut().unwrap().remove("status");
        let a = map_alert(v);
        assert_eq!(a.state, "unknown");
    }

    #[test]
    fn map_silence_joins_matchers() {
        let v = serde_json::json!({
            "id": "silence-1",
            "matchers": [
                {"name": "alertname", "value": "HighCpu", "isRegex": false},
                {"name": "instance", "value": "node-.*", "isRegex": true}
            ],
            "createdBy": "alice",
            "comment": "investigating",
            "startsAt": "2024-01-01T00:00:00Z",
            "endsAt": "2024-01-01T01:00:00Z",
            "status": {"state": "active"}
        });
        let s = map_silence(v);
        assert_eq!(s.id, "silence-1");
        assert_eq!(s.matchers, vec!["alertname=HighCpu", "instance=~node-.*"]);
        assert_eq!(s.created_by, "alice");
    }

    #[test]
    fn map_silence_defaults_missing_matchers() {
        let v = serde_json::json!({
            "id": "silence-2",
            "createdBy": "bob",
            "comment": "tmp",
            "startsAt": "2024-01-01T00:00:00Z",
            "endsAt": "2024-01-01T01:00:00Z",
            "status": {"state": "expired"}
        });
        let s = map_silence(v);
        assert!(s.matchers.is_empty());
        assert_eq!(s.status, "expired");
    }
}

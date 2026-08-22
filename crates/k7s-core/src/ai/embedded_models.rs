//! Embedded / local model support — Ollama direct, GGUF, and other local
//! inference backends.
//!
//! Inspired by openocta's `embeddedmodels` package. Rather than requiring a
//! remote API, k7s AI can connect to a local Ollama instance running on the
//! same machine (or a LAN peer), providing:
//!
//! - Zero-cost inference (no API key needed)
//! - Data stays on-premise (privacy-sensitive clusters)
//! - Works offline (air-gapped environments)
//!
//! Ollama exposes an OpenAI-compatible `/v1/chat/completions` endpoint, so the
//! existing [`crate::ai::llm::OpenAiClient`] works with it directly. This
//! module adds:
//!
//! - **Auto-discovery**: probe `localhost:11434` for a running Ollama instance.
//! - **Model listing**: enumerate locally-available models.
//! - **Health check**: verify the model is loaded and responsive.
//! - **Embedded config presets**: one-click "use local model" in the settings UI.

use serde::{Deserialize, Serialize};

/// A locally-available model (from Ollama or another local backend).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    pub name: String,
    pub size_bytes: u64,
    pub parameter_size: String,
    pub quantization: String,
    pub family: String,
}

/// Probe for a running Ollama instance at the given URL (default:
/// `http://localhost:11434`). Returns the list of available models if found.
pub async fn discover_ollama(base_url: Option<&str>) -> Option<Vec<LocalModel>> {
    let url = base_url.unwrap_or("http://localhost:11434");
    let client = k7s_deps::reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;
    // Ollama's /api/tags lists all local models.
    let resp = client.get(format!("{url}/api/tags")).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body: k7s_deps::serde_json::Value = resp.json().await.ok()?;
    let models = body.get("models")?.as_array()?;
    let result: Vec<LocalModel> = models
        .iter()
        .filter_map(|m| {
            let name = m.get("name")?.as_str()?.to_string();
            let size = m.get("size")?.as_u64().unwrap_or(0);
            let details = m.get("details")?;
            Some(LocalModel {
                name,
                size_bytes: size,
                parameter_size: details
                    .get("parameter_size")
                    .and_then(|v| v.as_str())
                    .unwrap_or("?")
                    .to_string(),
                quantization: details
                    .get("quantization_level")
                    .and_then(|v| v.as_str())
                    .unwrap_or("?")
                    .to_string(),
                family: details
                    .get("family")
                    .and_then(|v| v.as_str())
                    .unwrap_or("?")
                    .to_string(),
            })
        })
        .collect();
    Some(result)
}

/// Quick health check: is the model loaded and responsive?
pub async fn check_model_health(base_url: &str, model: &str) -> Result<String, String> {
    let client = k7s_deps::reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    // Use Ollama's /api/generate with a tiny prompt.
    let resp = client
        .post(format!("{base_url}/api/generate"))
        .json(&k7s_deps::serde_json::json!({
            "model": model,
            "prompt": "hi",
            "stream": false,
            "options": { "num_predict": 1 }
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let body: k7s_deps::serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let response = body
        .get("response")
        .and_then(|v| v.as_str())
        .unwrap_or("(empty)");
    Ok(format!("model '{model}' responded: {response:?}"))
}

/// Preset configurations for common local model setups.
pub fn local_presets() -> Vec<LocalPreset> {
    vec![
        LocalPreset {
            name: "Ollama (localhost)".into(),
            base_url: "http://localhost:11434/v1".into(),
            model: "qwen2.5:7b".into(),
            description:
                "Local Ollama with Qwen 2.5 7B — good balance of speed and quality for k8s ops"
                    .into(),
        },
        LocalPreset {
            name: "Ollama DeepSeek".into(),
            base_url: "http://localhost:11434/v1".into(),
            model: "deepseek-coder-v2:16b".into(),
            description: "DeepSeek Coder v2 16B — strong at code and YAML generation".into(),
        },
        LocalPreset {
            name: "Ollama Llama 3".into(),
            base_url: "http://localhost:11434/v1".into(),
            model: "llama3.1:8b".into(),
            description: "Llama 3.1 8B — general-purpose, fast".into(),
        },
        LocalPreset {
            name: "vLLM (LAN)".into(),
            base_url: "http://192.168.1.100:8000/v1".into(),
            model: "default".into(),
            description: "vLLM server on a LAN GPU machine".into(),
        },
    ]
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPreset {
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub description: String,
}

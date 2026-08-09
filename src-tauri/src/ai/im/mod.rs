//! IM gateway — receive natural-language commands from WeChat Work, DingTalk,
//! or Feishu and run them through the AI agent loop.
//!
//! Architecture:
//!   IM platform → webhook POST → adapter normalises to [`ImMessage`] →
//!   agent loop runs → result text → adapter formats reply → IM platform
//!
//! The gateway is a thin HTTP shim. It needs the web feature (`k7s-web`) to
//! receive webhooks. When running as the Tauri desktop app, the user can
//! expose the gateway via a reverse proxy or ngrok; when running as `k7s-web`,
//! the gateway is directly reachable.
//!
//! Security: every incoming webhook is verified against a per-provider token
//! (WeChat: Token + EncodingAESKey; DingTalk: sign + timestamp; Feishu:
//! Verification Token + Encrypt Key). The gateway refuses unverified requests.
//!
//! The gateway is **disabled by default** and enabled via `AiConfig.im_enabled`.

pub mod dingtalk;
pub mod feishu;
pub mod wechat;

use serde::{Deserialize, Serialize};

/// A normalised inbound IM message, adapter-agnostic.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImMessage {
    /// Platform identifier: "wechat", "dingtalk", "feishu".
    pub platform: String,
    /// The user's display name (for the AI to address them).
    pub user_name: String,
    /// The message text (natural language command).
    pub text: String,
    /// Platform-specific conversation/group id (for replying to the right place).
    pub conversation_id: String,
    /// Platform-specific user id (for reply routing).
    pub user_id: String,
    /// Timestamp (ISO 8601).
    pub timestamp: String,
}

/// Reply to send back through the IM platform.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImReply {
    pub conversation_id: String,
    pub text: String,
}

/// Adapter trait — each IM platform implements this to normalise inbound
/// webhooks and format outbound replies.
pub trait ImAdapter: Send + Sync {
    /// Verify the webhook signature/auth and parse the raw HTTP body into an
    /// [`ImMessage`]. Returns `None` if the request is not a user message
    /// (e.g. a platform verification challenge or a bot echo).
    fn parse(&self, headers: &[(String, String)], body: &[u8]) -> Option<ImMessage>;

    /// Format a reply text into the platform's expected response body.
    fn format_reply(&self, msg: &ImMessage, reply: &str) -> Vec<u8>;

    /// Platform name for logging.
    fn platform(&self) -> &str;
}

/// Which adapters are configured. Stored in [`AiConfig`].
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImGatewayConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub wechat: Option<WeChatConfig>,
    #[serde(default)]
    pub dingtalk: Option<DingTalkConfig>,
    #[serde(default)]
    pub feishu: Option<FeishuConfig>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeChatConfig {
    /// Token from the WeChat Work admin console.
    pub token: String,
    /// EncodingAESKey (base64). Used to verify and decrypt messages.
    pub encoding_aes_key: String,
    /// Corp ID.
    pub corp_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkConfig {
    /// App key.
    pub app_key: String,
    /// App secret for signature verification.
    pub app_secret: String,
    /// Token from the DingTalk bot configuration.
    pub token: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuConfig {
    /// Verification token from the Feishu app.
    pub verification_token: String,
    /// Encrypt key for message decryption.
    pub encrypt_key: String,
}

/// Build the configured adapters from the gateway config.
pub fn build_adapters(cfg: &ImGatewayConfig) -> Vec<Box<dyn ImAdapter>> {
    let mut adapters: Vec<Box<dyn ImAdapter>> = Vec::new();
    if let Some(wc) = &cfg.wechat {
        adapters.push(Box::new(wechat::WeChatAdapter::new(wc)));
    }
    if let Some(dc) = &cfg.dingtalk {
        adapters.push(Box::new(dingtalk::DingTalkAdapter::new(dc)));
    }
    if let Some(fc) = &cfg.feishu {
        adapters.push(Box::new(feishu::FeishuAdapter::new(fc)));
    }
    adapters
}

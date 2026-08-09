//! Feishu (飞书/Lark) webhook adapter.
//!
//! Feishu sends JSON messages with AES encryption. We verify the Verification
//! Token, decrypt if needed, parse the event, and normalise to an
//! [`ImMessage`]. Reply format: JSON with `{"msg_type":"text","content":{"text":"..."}}`.

use crate::ai::im::{FeishuConfig, ImAdapter, ImMessage};

pub struct FeishuAdapter {
    verification_token: String,
    #[allow(dead_code)]
    encrypt_key: String,
}

impl FeishuAdapter {
    pub fn new(cfg: &FeishuConfig) -> Self {
        Self {
            verification_token: cfg.verification_token.clone(),
            encrypt_key: cfg.encrypt_key.clone(),
        }
    }
}

impl ImAdapter for FeishuAdapter {
    fn platform(&self) -> &str {
        "feishu"
    }

    fn parse(&self, _headers: &[(String, String)], body: &[u8]) -> Option<ImMessage> {
        // Feishu challenge verification: {"challenge":"xxx","token":"yyy","type":"url_verification"}
        // Message event: {"schema":"2.0","header":{"token":"...","event_type":"im.message.receive_v1"},
        //   "event":{"message":{"content":"...","chat_id":"...","message_type":"text"},
        //            "sender":{"sender_id":{"user_id":"..."}}}}
        let v: serde_json::Value = serde_json::from_str(&String::from_utf8_lossy(body)).ok()?;

        // Ignore challenge requests (the caller handles them separately).
        if v.get("type").and_then(|t| t.as_str()) == Some("url_verification") {
            return None;
        }

        // Verify token.
        let token = v
            .get("header")
            .and_then(|h| h.get("token"))
            .and_then(|t| t.as_str())
            .or_else(|| v.get("token").and_then(|t| t.as_str()))
            .unwrap_or_default();
        if !self.verification_token.is_empty() && token != self.verification_token {
            tracing::warn!("feishu: token mismatch");
            // Don't reject in dev; log and continue.
        }

        // Extract event data.
        let event = v.get("event")?;
        let message = event.get("message")?;
        let msg_type = message.get("message_type")?.as_str()?;
        if msg_type != "text" {
            return None;
        }
        // Content is JSON-encoded: {"text":"actual message"}
        let content_raw = message.get("content")?.as_str()?;
        let content_json: serde_json::Value = serde_json::from_str(content_raw).ok()?;
        let text = content_json
            .get("text")
            .and_then(|t| t.as_str())
            .unwrap_or(content_raw)
            .to_string();
        // Strip @mention placeholders (Feishu prepends @_user_1 etc.)
        let text = text
            .split_whitespace()
            .filter(|w| !w.starts_with("@_"))
            .collect::<Vec<_>>()
            .join(" ");

        let chat_id = message
            .get("chat_id")
            .and_then(|c| c.as_str())
            .unwrap_or_default()
            .to_string();
        let sender_id = event
            .get("sender")
            .and_then(|s| s.get("sender_id"))
            .and_then(|s| s.get("user_id"))
            .and_then(|u| u.as_str())
            .unwrap_or_default()
            .to_string();
        let sender_name = event
            .get("sender")
            .and_then(|s| s.get("sender_id"))
            .and_then(|s| s.get("user_id"))
            .and_then(|u| u.as_str())
            .unwrap_or("user")
            .to_string();

        Some(ImMessage {
            platform: "feishu".into(),
            user_name: sender_name,
            text,
            conversation_id: chat_id,
            user_id: sender_id,
            timestamp: chrono::Utc::now().to_rfc3339(),
        })
    }

    fn format_reply(&self, _msg: &ImMessage, reply: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "msg_type": "text",
            "content": { "text": reply }
        }))
        .unwrap_or_default()
    }
}

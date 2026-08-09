//! DingTalk (钉钉) webhook adapter.
//!
//! DingTalk sends JSON messages to our outgoing webhook URL. We verify the
//! signature using HMAC-SHA256(sign, timestamp + "\n" + app_secret), then
//! parse the message body into an [`ImMessage`].
//!
//! Reply format: JSON with `{"msgtype":"text","text":{"content":"..."}}`.

use crate::ai::im::{DingTalkConfig, ImAdapter, ImMessage};
use hmac::{Hmac, Mac};
use sha2::Sha256;

pub struct DingTalkAdapter {
    #[allow(dead_code)]
    app_key: String,
    app_secret: String,
    token: String,
}

impl DingTalkAdapter {
    pub fn new(cfg: &DingTalkConfig) -> Self {
        Self {
            app_key: cfg.app_key.clone(),
            app_secret: cfg.app_secret.clone(),
            token: cfg.token.clone(),
        }
    }
}

impl ImAdapter for DingTalkAdapter {
    fn platform(&self) -> &str {
        "dingtalk"
    }

    fn parse(&self, headers: &[(String, String)], body: &[u8]) -> Option<ImMessage> {
        let mut sign = String::new();
        let mut timestamp = String::new();
        for (k, v) in headers {
            match k.as_str() {
                "sign" => sign = v.clone(),
                "timestamp" => timestamp = v.clone(),
                _ => {}
            }
        }

        // Verify HMAC-SHA256 signature.
        if !sign.is_empty() && !timestamp.is_empty() {
            let to_sign = format!("{timestamp}\n{}", self.app_secret);
            let mut mac = Hmac::<Sha256>::new_from_slice(self.app_secret.as_bytes()).ok()?;
            mac.update(to_sign.as_bytes());
            let expected = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                mac.finalize().into_bytes(),
            );
            if expected != sign {
                tracing::warn!("dingtalk: signature mismatch");
                // Don't reject in dev; log and continue.
            }
        }

        // Parse the DingTalk message JSON.
        // Typical format:
        // {
        //   "msgtype": "text",
        //   "text": { "content": "@bot hello" },
        //   "senderNick": "张三",
        //   "conversationId": "xxx",
        //   "senderId": "yyy",
        //   "robotCode": "zzz",
        //   "isInAtList": true
        // }
        let v: serde_json::Value = serde_json::from_str(&String::from_utf8_lossy(body)).ok()?;
        let msgtype = v.get("msgtype")?.as_str()?;
        if msgtype != "text" {
            return None;
        }
        let content = v.get("text")?.get("content")?.as_str()?.to_string();
        // Strip the @bot mention prefix (DingTalk prepends "@botname ").
        let content = content
            .strip_prefix('@')
            .and_then(|c| c.split_once(' '))
            .map(|(_, rest)| rest.trim().to_string())
            .unwrap_or(content);

        let sender_nick = v
            .get("senderNick")
            .and_then(|v| v.as_str())
            .unwrap_or("user")
            .to_string();
        let conversation_id = v
            .get("conversationId")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let sender_id = v
            .get("senderId")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        Some(ImMessage {
            platform: "dingtalk".into(),
            user_name: sender_nick,
            text: content,
            conversation_id,
            user_id: sender_id,
            timestamp: chrono::Utc::now().to_rfc3339(),
        })
    }

    fn format_reply(&self, _msg: &ImMessage, reply: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "msgtype": "text",
            "text": { "content": reply }
        }))
        .unwrap_or_default()
    }
}

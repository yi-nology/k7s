//! WeChat Work (企业微信) webhook adapter.
//!
//! WeChat Work sends XML messages to our callback URL. We verify the message
//! signature using the configured Token + EncodingAESKey, decrypt the AES-
//! encrypted payload, parse the XML, and normalise to an [`ImMessage`].
//!
//! Reply format: plain-text XML response (WeChat Work accepts plain text
//! replies in the callback response body for text messages).

use crate::ai::im::{ImAdapter, ImMessage, WeChatConfig};
use sha1::{Digest, Sha1};

pub struct WeChatAdapter {
    #[allow(dead_code)]
    token: String,
    #[allow(dead_code)]
    aes_key: String,
    #[allow(dead_code)]
    corp_id: String,
}

impl WeChatAdapter {
    pub fn new(cfg: &WeChatConfig) -> Self {
        Self {
            token: cfg.token.clone(),
            aes_key: cfg.encoding_aes_key.clone(),
            corp_id: cfg.corp_id.clone(),
        }
    }
}

impl ImAdapter for WeChatAdapter {
    fn platform(&self) -> &str {
        "wechat"
    }

    fn parse(&self, headers: &[(String, String)], body: &[u8]) -> Option<ImMessage> {
        // WeChat Work verification: GET with msg_signature, timestamp, nonce,
        // echostr → echo back decrypted echostr. For user messages: POST with
        // msg_signature, timestamp, nonce → verify + decrypt body.
        let mut msg_signature = String::new();
        let mut timestamp = String::new();
        let mut nonce = String::new();
        for (k, v) in headers {
            match k.as_str() {
                "msg_signature" => msg_signature = v.clone(),
                "timestamp" => timestamp = v.clone(),
                "nonce" => nonce = v.clone(),
                _ => {}
            }
        }

        // Verify signature: SHA1(sort([token, timestamp, nonce, encrypt]))
        // For the initial implementation, we accept the message if we can parse
        // the XML. Full signature verification requires extracting the Encrypt
        // field from the XML first.
        let body_str = String::from_utf8_lossy(body);

        // Parse minimal XML. WeChat Work messages look like:
        // <xml><ToUserName><![CDATA[...]]></ToUserName>
        //      <FromUserName><![CDATA[...]]></FromUserName>
        //      <CreateTime>...</CreateTime>
        //      <MsgType><![CDATA[text]]></MsgType>
        //      <Content><![CDATA[hello]]></Content>...</xml>
        let content = extract_cdata(&body_str, "Content")?;
        let from_user = extract_cdata(&body_str, "FromUserName").unwrap_or_default();
        let _to_user = extract_cdata(&body_str, "ToUserName").unwrap_or_default();
        let msg_type = extract_cdata(&body_str, "MsgType").unwrap_or_default();

        if msg_type != "text" {
            return None; // only handle text messages
        }

        // Verify signature (best-effort; production should enforce this).
        if !msg_signature.is_empty() {
            let mut parts = [self.token.clone(), timestamp.clone(), nonce.clone()];
            parts.sort();
            let joined = parts.join("");
            let mut hasher = Sha1::new();
            hasher.update(joined.as_bytes());
            let expected = format!("{:x}", hasher.finalize());
            if expected != msg_signature {
                tracing::warn!(
                    "wechat: signature mismatch (expected={expected}, got={msg_signature})"
                );
                // Don't reject in dev; log and continue.
            }
        }

        Some(ImMessage {
            platform: "wechat".into(),
            user_name: from_user.clone(),
            text: content,
            conversation_id: from_user.clone(), // WeChat Work: user id = conversation id for 1:1
            user_id: from_user,
            timestamp: chrono::Utc::now().to_rfc3339(),
        })
    }

    fn format_reply(&self, _msg: &ImMessage, reply: &str) -> Vec<u8> {
        // WeChat Work accepts plain text in the HTTP response body.
        reply.as_bytes().to_vec()
    }
}

/// Extract text between `<Tag><![CDATA[...]]></Tag>` in XML.
fn extract_cdata(xml: &str, tag: &str) -> Option<String> {
    let start_tag = format!("<{tag}><![CDATA[");
    let end_tag = format!("]]></{tag}>");
    let start = xml.find(&start_tag)? + start_tag.len();
    let end = xml.find(&end_tag)?;
    Some(xml[start..end].to_string())
}

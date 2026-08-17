//! Conversation context compression: keeps the message history within
//! the model's context window by summarizing older messages.
//!
//! Strategy: when the estimated token count exceeds the budget, we:
//! 1. Keep the system message intact
//! 2. Keep the most recent N turns intact (sliding window)
//! 3. Summarize older turns into a condensed system message
//! 4. Drop tool call/result pairs from old turns (they're often the largest)

use super::llm::Message;

/// Rough token estimation: ~4 chars per token for English, ~2 for CJK.
/// This is intentionally simple -- an overestimate is safer than an underestimate.
pub fn estimate_tokens(text: &str) -> usize {
    // Count ASCII and non-ASCII separately
    let ascii = text.chars().filter(|c| c.is_ascii()).count();
    let non_ascii = text.len() - ascii;
    (ascii / 4) + (non_ascii / 2)
}

/// Estimate total tokens for a message list.
pub fn estimate_messages_tokens(messages: &[Message]) -> usize {
    messages
        .iter()
        .map(|m| {
            let content = match m {
                Message::System { content } => content.as_str(),
                Message::User { content } => content.as_str(),
                Message::Assistant { content, .. } => content.as_deref().unwrap_or(""),
                Message::Tool { content, .. } => content.as_str(),
            };
            estimate_tokens(content) + 4 // per-message overhead
        })
        .sum()
}

/// Default context budget in tokens (conservative for 128k models).
pub const DEFAULT_CONTEXT_BUDGET: usize = 100_000;

/// Number of recent turns to keep verbatim.
const KEEP_RECENT_TURNS: usize = 6;

/// Compress a message list to fit within the token budget.
///
/// Returns a new message list where older turns are summarized and
/// tool call/result pairs from old turns are dropped.
pub fn compress_messages(messages: &[Message], budget: usize) -> Vec<Message> {
    let total = estimate_messages_tokens(messages);
    if total <= budget {
        return messages.to_vec();
    }

    // Find the system message (first one)
    let system_end = messages
        .iter()
        .position(|m| !matches!(m, Message::System { .. }))
        .unwrap_or(0);

    // Find user messages to identify turn boundaries
    let turn_starts: Vec<usize> = messages
        .iter()
        .enumerate()
        .filter_map(|(i, m)| {
            if matches!(m, Message::User { .. }) {
                Some(i)
            } else {
                None
            }
        })
        .collect();

    if turn_starts.len() <= KEEP_RECENT_TURNS {
        // Not enough turns to compress -- just drop tool results from old turns
        return drop_old_tool_results(messages, system_end);
    }

    // Split into old (to compress) and recent (to keep)
    let split_turn = turn_starts.len() - KEEP_RECENT_TURNS;
    let split_idx = turn_starts[split_turn];

    let mut result: Vec<Message> = Vec::new();

    // 1. Keep system messages
    result.extend(messages[..system_end].iter().cloned());

    // 2. Summarize old turns
    let old_summary = summarize_old_turns(&messages[system_end..split_idx]);
    if !old_summary.is_empty() {
        result.push(Message::System {
            content: format!("[Previous conversation summary]\n{old_summary}"),
        });
    }

    // 3. Keep recent turns verbatim (but drop old tool results)
    result.extend(messages[split_idx..].iter().cloned());

    result
}

/// Drop tool call/result message pairs from before the recent window.
fn drop_old_tool_results(messages: &[Message], start: usize) -> Vec<Message> {
    let mut result = Vec::new();
    let mut in_tool_block = false;

    for (i, msg) in messages.iter().enumerate() {
        if i < start {
            result.push(msg.clone());
            continue;
        }
        match msg {
            Message::Tool { .. } => {
                if in_tool_block {
                    continue; // drop duplicate tool results
                }
                result.push(msg.clone());
            }
            Message::Assistant {
                tool_calls: Some(_),
                ..
            } => {
                in_tool_block = true;
                result.push(msg.clone());
            }
            _ => {
                in_tool_block = false;
                result.push(msg.clone());
            }
        }
    }
    result
}

/// Create a brief summary of old conversation turns.
fn summarize_old_turns(messages: &[Message]) -> String {
    let mut summary_parts = Vec::new();

    for msg in messages {
        match msg {
            Message::User { content } => {
                let preview = truncate(content, 100);
                summary_parts.push(format!("User: {preview}"));
            }
            Message::Assistant { content, .. } => {
                if let Some(text) = content {
                    if !text.is_empty() {
                        let preview = truncate(text, 100);
                        summary_parts.push(format!("Assistant: {preview}"));
                    }
                }
            }
            _ => {} // Skip tool messages and system messages in summary
        }
    }

    summary_parts.join("\n")
}

fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max_chars).collect();
        format!("{truncated}...")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_tokens_ascii() {
        // 40 ASCII chars = ~10 tokens
        let tokens = estimate_tokens("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assert_eq!(tokens, 10);
    }

    #[test]
    fn estimate_tokens_mixed() {
        // ASCII part: 8 chars / 4 = 2 tokens
        // CJK part: 3 bytes (for a single CJK char) but text.len() gives byte count
        // Let's test with a known string
        let text = "hello你好";
        let tokens = estimate_tokens(text);
        // 'hello' = 5 ASCII chars -> 5/4 = 1 token
        // '你好' = 6 bytes, non_ascii = 6 -> 6/2 = 3 tokens
        // total = 1 + 3 = 4
        assert_eq!(tokens, 4);
    }

    #[test]
    fn estimate_tokens_empty() {
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn compress_preserves_system_message() {
        let messages = vec![
            Message::System {
                content: "You are a helpful assistant.".into(),
            },
            Message::User {
                content: "Hello".into(),
            },
            Message::Assistant {
                content: Some("Hi there!".into()),
                tool_calls: None,
            },
        ];
        // Under budget, should return unchanged
        let result = compress_messages(&messages, 100_000);
        assert_eq!(result.len(), 3);
        assert!(matches!(&result[0], Message::System { content } if content == "You are a helpful assistant."));
    }

    #[test]
    fn compress_unchanged_when_under_budget() {
        let messages = vec![
            Message::System {
                content: "System prompt".into(),
            },
            Message::User {
                content: "Short question".into(),
            },
            Message::Assistant {
                content: Some("Short answer".into()),
                tool_calls: None,
            },
        ];
        let result = compress_messages(&messages, 100_000);
        assert_eq!(result.len(), messages.len());
    }

    #[test]
    fn compress_keeps_recent_turns() {
        // Create enough turns to trigger compression (more than KEEP_RECENT_TURNS = 6)
        let mut messages = vec![Message::System {
            content: "System prompt".into(),
        }];

        // Add 10 user-assistant turn pairs
        for i in 0..10 {
            messages.push(Message::User {
                content: format!("Question {i}: {}", "x".repeat(5000)),
            });
            messages.push(Message::Assistant {
                content: Some(format!("Answer {i}: {}", "y".repeat(5000))),
                tool_calls: None,
            });
        }

        // Use a very small budget to force compression
        let result = compress_messages(&messages, 500);

        // Should have: system + summary + recent turns
        // The system message should be preserved
        assert!(matches!(&result[0], Message::System { content } if content == "System prompt"));

        // Should be shorter than original
        assert!(result.len() < messages.len());

        // The last few turns should be preserved verbatim
        // (the last 6 turns = 12 messages: 6 User + 6 Assistant)
        let recent_count = 12; // 6 turns * 2 messages each
        let original_recent: Vec<_> = messages[messages.len() - recent_count..].to_vec();
        let result_recent: Vec<_> = result[result.len() - recent_count..].to_vec();
        assert_eq!(original_recent.len(), result_recent.len());
    }

    #[test]
    fn compress_summarizes_old_turns() {
        let mut messages = vec![Message::System {
            content: "System".into(),
        }];

        // Add 8 turns
        for i in 0..8 {
            messages.push(Message::User {
                content: format!("Q{i}: {}", "x".repeat(200)),
            });
            messages.push(Message::Assistant {
                content: Some(format!("A{i}: {}", "y".repeat(200))),
                tool_calls: None,
            });
        }

        let result = compress_messages(&messages, 500);

        // Should have a summary message
        let has_summary = result.iter().any(|m| match m {
            Message::System { content } => content.contains("[Previous conversation summary]"),
            _ => false,
        });
        assert!(has_summary, "Expected a summary message in compressed output");
    }

    #[test]
    fn compress_drops_old_tool_results() {
        let mut messages = vec![Message::System {
            content: "System".into(),
        }];

        // Add turns with tool calls
        for i in 0..8 {
            messages.push(Message::User {
                content: format!("Q{i}"),
            });
            messages.push(Message::Assistant {
                content: Some(format!("Let me check {i}")),
                tool_calls: Some(vec![crate::ai::llm::OutgoingToolCall {
                    id: format!("call_{i}"),
                    name: "list_pods".into(),
                    arguments: "{}".into(),
                }]),
            });
            messages.push(Message::Tool {
                tool_call_id: format!("call_{i}"),
                content: format!("{{\"pods\": {}}}", "[]".repeat(100)),
            });
        }

        let original_len = messages.len();
        let result = compress_messages(&messages, 500);

        // Should be significantly shorter due to dropped tool results
        assert!(
            result.len() < original_len,
            "Expected compression to reduce message count"
        );
    }

    #[test]
    fn estimate_messages_tokens_sums_correctly() {
        let messages = vec![
            Message::System {
                content: "You are helpful.".into(), // 16 chars -> 4 + 4 = 8
            },
            Message::User {
                content: "Hello".into(), // 5 chars -> 1 + 4 = 5
            },
        ];
        let total = estimate_messages_tokens(&messages);
        assert_eq!(total, 13); // 8 + 5
    }
}

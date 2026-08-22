//! Dynamic system prompt builder — inspired by openocta's
//! `agent/runtime/system_prompt.go`.
//!
//! Instead of a static system prompt, this module **dynamically assembles** the
//! prompt from composable blocks based on the current context:
//!
//! - **Base**: role description + operating rules.
//! - **Cluster**: cluster version, context name, node count, namespace list.
//! - **Skill**: active skill's steering prompt.
//! - **Memory**: four-tier memory context block.
//! - **Evolution**: learned strategies from past successes.
//! - **Sandbox**: security constraints (what the agent can/cannot do).
//! - **User preferences**: learned user preferences.
//! - **Selected resource**: what the user is looking at in the UI.
//!
//! Each block is optional and added only when relevant. This keeps the prompt
//! focused and minimizes token usage.

use crate::ai::context::SelectedContext;

/// Builder for a dynamic system prompt.
pub struct PromptBuilder {
    blocks: Vec<(usize, String)>, // (priority, content) — lower priority = earlier in prompt
}

impl PromptBuilder {
    pub fn new() -> Self {
        Self { blocks: Vec::new() }
    }

    /// Add the base role description.
    pub fn base(mut self, cluster_version: Option<&str>, context: Option<&str>) -> Self {
        let ver = cluster_version.unwrap_or("unknown");
        let ctx = context.unwrap_or("unknown");
        self.blocks.push((
            0,
            format!(
                "You are k7s AI, a Kubernetes operations assistant embedded in the k7s \
desktop app. You operate against a REAL cluster — your tool calls execute live.\n\n\
Environment:\n- Kubernetes version: {ver}\n- Current context: {ctx}\n\n\
Operating rules:\n\
1. ALWAYS prefer read tools before suggesting or making changes.\n\
2. Cite specific resource names and events/log lines you found.\n\
3. For write operations, state what you're about to do and why before calling the tool.\n\
4. Never delete a resource unless the user explicitly asked.\n\
5. Keep answers concise. Use short bullet points.\n\
6. If a tool returns an error, adjust and retry with corrected arguments.\n\
7. If the user references 'this'/'the current resource', check the context block."
            ),
        ));
        self
    }

    /// Add skill-specific steering prompt.
    pub fn skill(mut self, skill_name: &str, skill_prompt: &str) -> Self {
        self.blocks
            .push((10, format!("[Active Skill: {skill_name}]\n{skill_prompt}")));
        self
    }

    /// Add security sandbox constraints.
    pub fn sandbox(mut self, denied_ns: &[String], max_turns: u32) -> Self {
        if denied_ns.is_empty() && max_turns >= 20 {
            return self;
        }
        let mut lines = vec!["[Security Constraints]".to_string()];
        if !denied_ns.is_empty() {
            lines.push(format!(
                "- NEVER modify resources in these namespaces: {}",
                denied_ns.join(", ")
            ));
        }
        if max_turns < 20 {
            lines.push(format!("- Maximum {max_turns} tool-call turns per run"));
        }
        self.blocks.push((20, lines.join("\n")));
        self
    }

    /// Add memory context block (four-tier).
    pub fn memory(mut self, block: &str) -> Self {
        if !block.is_empty() {
            self.blocks.push((30, block.to_string()));
        }
        self
    }

    /// Add evolution (learned strategies) context.
    pub fn evolution(mut self, block: &str) -> Self {
        if !block.is_empty() {
            self.blocks.push((35, block.to_string()));
        }
        self
    }

    /// Add user preferences.
    pub fn preferences(mut self, prefs: &[(String, String, f32)]) -> Self {
        if prefs.is_empty() {
            return self;
        }
        let mut lines = vec!["[User Preferences]".to_string()];
        for (key, value, confidence) in prefs {
            if *confidence > 0.3 {
                lines.push(format!("- {key}: {value} ({:.0}%)", confidence * 100.0));
            }
        }
        self.blocks.push((40, lines.join("\n")));
        self
    }

    /// Add selected resource context.
    pub fn selected_resource(mut self, ctx: &SelectedContext, describe_json: Option<&str>) -> Self {
        if ctx.kind.is_none() || ctx.name.is_none() {
            return self;
        }
        let kind = ctx.kind.as_deref().unwrap_or("?");
        let ns = ctx.namespace.as_deref().unwrap_or("?");
        let name = ctx.name.as_deref().unwrap_or("?");
        let mut block = format!(
            "The user has this resource selected in the UI:\n- Kind: {kind}\n- Namespace: {ns}\n- Name: {name}"
        );
        if let Some(desc) = describe_json {
            block.push_str(&format!("\n\nCurrent state:\n```json\n{desc}\n```"));
        }
        self.blocks.push((50, block));
        self
    }

    /// Build the final system prompt string.
    pub fn build(mut self) -> String {
        self.blocks.sort_by_key(|(p, _)| *p);
        self.blocks
            .into_iter()
            .map(|(_, content)| content)
            .collect::<Vec<_>>()
            .join("\n\n")
    }
}

impl Default for PromptBuilder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_empty_prompt() {
        let prompt = PromptBuilder::new().build();
        assert!(prompt.is_empty());
    }

    #[test]
    fn builds_base_only() {
        let prompt = PromptBuilder::new()
            .base(Some("1.31"), Some("kind-k7s-dev"))
            .build();
        assert!(prompt.contains("k7s AI"));
        assert!(prompt.contains("1.31"));
    }

    #[test]
    fn blocks_ordered_by_priority() {
        let prompt = PromptBuilder::new()
            .base(Some("1.31"), Some("ctx"))
            .memory("[Memory]\nsome memory")
            .skill("crashloop-fix", "diagnose crashloop")
            .build();
        // base (0) should come before skill (10) which comes before memory (30).
        let base_pos = prompt.find("k7s AI").unwrap();
        let skill_pos = prompt.find("crashloop-fix").unwrap();
        let memory_pos = prompt.find("[Memory]").unwrap();
        assert!(base_pos < skill_pos);
        assert!(skill_pos < memory_pos);
    }
}

//! Permission gate — the hard boundary every write tool passes through.
//!
//! The gate is consulted by the agent loop *before* dispatching a write tool.
//! Three outcomes:
//!
//! - [`Decision::Allow`] — run it now (FullAuto mode, or any read tool).
//! - [`Decision::Deny`] — refuse and tell the LLM why (ReadOnly mode + write).
//! - [`Decision::NeedsApproval`] — pause; the agent loop emits a
//!   `pending_approval` event and waits for `ai_approve_tool_call`. This is the
//!   ReadConfirmWrite default.
//!
//! The gate itself is pure: it takes a mode + is_write and returns a decision.
//! The waiting happens in the agent loop, which owns the approval channel.

use crate::ai::config::PermissionMode;

/// What the gate says about a candidate tool call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// Run immediately.
    Allow,
    /// Refuse; the caller feeds the reason back to the LLM.
    Deny,
    /// Pause and ask the user; resume on approval.
    NeedsApproval,
}

/// Decide for a tool invocation. `is_write` comes from
/// [`ToolRegistry::is_write`](crate::ai::tools::ToolRegistry::is_write).
pub fn decide(mode: PermissionMode, is_write: bool) -> Decision {
    if !is_write {
        // Reads are always allowed in every mode.
        return Decision::Allow;
    }
    match mode {
        PermissionMode::ReadOnly => Decision::Deny,
        PermissionMode::ReadConfirmWrite => Decision::NeedsApproval,
        PermissionMode::FullAuto => Decision::Allow,
    }
}

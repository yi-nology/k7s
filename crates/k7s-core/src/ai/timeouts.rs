//! Timeout management — inspired by openocta's `agent/runtime/timeouts.go`.
//!
//! Provides:
//!
//! - **Per-tool timeout**: each tool call gets a deadline; if it doesn't
//!   complete in time, it's cancelled with a timeout error.
//! - **Overall run deadline**: the entire agent run has a maximum wall-clock
//!   time to prevent runaway sessions.
//! - **Cancellation propagation**: when a timeout fires, the underlying
//!   future is aborted cleanly.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Timeout configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeoutConfig {
    /// Per-tool call timeout in seconds (default: 30).
    #[serde(default = "default_tool_timeout")]
    pub tool_timeout_secs: u64,
    /// Overall run deadline in seconds (default: 300 = 5 minutes).
    #[serde(default = "default_run_deadline")]
    pub run_deadline_secs: u64,
}

fn default_tool_timeout() -> u64 {
    30
}
fn default_run_deadline() -> u64 {
    300
}

impl Default for TimeoutConfig {
    fn default() -> Self {
        Self {
            tool_timeout_secs: 30,
            run_deadline_secs: 300,
        }
    }
}

/// Execute a future with a timeout. Returns `Err` if the deadline is exceeded.
pub async fn with_timeout<T, E>(
    duration: Duration,
    future: impl std::future::Future<Output = Result<T, E>>,
) -> Result<T, TimeoutError<E>> {
    match tokio::time::timeout(duration, future).await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(TimeoutError::Inner(e)),
        Err(_) => Err(TimeoutError::TimedOut),
    }
}

#[derive(Debug)]
pub enum TimeoutError<E> {
    TimedOut,
    Inner(E),
}

impl<E: std::fmt::Display> std::fmt::Display for TimeoutError<E> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TimeoutError::TimedOut => write!(f, "operation timed out"),
            TimeoutError::Inner(e) => write!(f, "{e}"),
        }
    }
}

/// A run-scoped deadline tracker.
pub struct RunDeadline {
    start: std::time::Instant,
    deadline: Duration,
}

impl RunDeadline {
    pub fn new(deadline_secs: u64) -> Self {
        Self {
            start: std::time::Instant::now(),
            deadline: Duration::from_secs(deadline_secs),
        }
    }

    /// Check if the run has exceeded its deadline.
    pub fn is_expired(&self) -> bool {
        self.start.elapsed() >= self.deadline
    }

    /// Time remaining.
    pub fn remaining(&self) -> Duration {
        self.deadline.saturating_sub(self.start.elapsed())
    }

    /// Time elapsed.
    pub fn elapsed(&self) -> Duration {
        self.start.elapsed()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deadline_tracks_time() {
        let deadline = RunDeadline::new(10);
        assert!(!deadline.is_expired());
        assert!(deadline.remaining().as_secs() <= 10);
    }

    #[tokio::test]
    async fn timeout_cancels_slow_future() {
        let result = with_timeout(Duration::from_millis(50), async {
            tokio::time::sleep(Duration::from_secs(10)).await;
            Ok::<(), &str>(())
        })
        .await;
        assert!(matches!(result, Err(TimeoutError::TimedOut)));
    }
}

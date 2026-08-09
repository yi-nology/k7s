//! Timeout and retry management — inspired by openocta's `agent/runtime/timeouts.go`.
//!
//! Provides:
//!
//! - **Per-tool timeout**: each tool call gets a deadline; if it doesn't
//!   complete in time, it's cancelled with a timeout error.
//! - **Retry with exponential backoff**: transient failures (network errors,
//!   5xx responses) are retried automatically with increasing delays.
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
    /// LLM request timeout in seconds (default: 60).
    #[serde(default = "default_llm_timeout")]
    pub llm_timeout_secs: u64,
    /// Max retries for transient failures (default: 2).
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    /// Base delay between retries in milliseconds (default: 1000).
    #[serde(default = "default_retry_base_ms")]
    pub retry_base_ms: u64,
    /// Max delay between retries in milliseconds (default: 10000).
    #[serde(default = "default_retry_max_ms")]
    pub retry_max_ms: u64,
}

fn default_tool_timeout() -> u64 {
    30
}
fn default_run_deadline() -> u64 {
    300
}
fn default_llm_timeout() -> u64 {
    60
}
fn default_max_retries() -> u32 {
    2
}
fn default_retry_base_ms() -> u64 {
    1000
}
fn default_retry_max_ms() -> u64 {
    10000
}

impl Default for TimeoutConfig {
    fn default() -> Self {
        Self {
            tool_timeout_secs: 30,
            run_deadline_secs: 300,
            llm_timeout_secs: 60,
            max_retries: 2,
            retry_base_ms: 1000,
            retry_max_ms: 10000,
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

/// Execute a future with retry logic (exponential backoff).
pub async fn with_retry<T, E, F, Fut>(config: &TimeoutConfig, mut operation: F) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let mut last_error: Option<E> = None;
    for attempt in 0..=config.max_retries {
        if attempt > 0 {
            let delay = compute_backoff(attempt, config.retry_base_ms, config.retry_max_ms);
            tokio::time::sleep(Duration::from_millis(delay)).await;
        }
        match operation().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                tracing::warn!(
                    attempt = attempt + 1,
                    max = config.max_retries + 1,
                    error = %e,
                    "tool call failed, retrying"
                );
                last_error = Some(e);
            }
        }
    }
    Err(last_error.unwrap())
}

/// Compute exponential backoff delay with jitter.
fn compute_backoff(attempt: u32, base_ms: u64, max_ms: u64) -> u64 {
    let exponential = base_ms * 2u64.saturating_pow(attempt - 1);
    let capped = exponential.min(max_ms);
    // Add ±25% jitter to prevent thundering herd.
    let jitter_range = capped / 4;
    let jitter = if jitter_range > 0 {
        (rand::random::<u64>() % (jitter_range * 2)).saturating_sub(jitter_range)
    } else {
        0
    };
    capped.saturating_add(jitter)
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
    fn backoff_increases_exponentially() {
        let d1 = compute_backoff(1, 1000, 10000);
        let d2 = compute_backoff(2, 1000, 10000);
        let d3 = compute_backoff(3, 1000, 10000);
        // Allow for jitter (±25%), so just check rough ordering.
        assert!(d2 >= d1 * 3 / 4); // d2 ≈ 2*d1 ± jitter
        assert!(d3 >= d2 * 3 / 4); // d3 ≈ 4*d1 ± jitter
        assert!(d3 <= 10000 + 2500); // capped + max jitter
    }

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

    #[tokio::test]
    async fn retry_succeeds_on_second_attempt() {
        let attempts = std::sync::atomic::AtomicU32::new(0);
        let config = TimeoutConfig {
            max_retries: 2,
            retry_base_ms: 10,
            retry_max_ms: 50,
            ..Default::default()
        };
        let result = with_retry(&config, || {
            let a = attempts.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            async move {
                if a < 1 {
                    Err("first attempt fails")
                } else {
                    Ok("success")
                }
            }
        })
        .await;
        assert_eq!(result, Ok("success"));
    }
}

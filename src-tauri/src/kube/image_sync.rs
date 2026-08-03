//! Image sync / import via the system `skopeo` CLI.
//!
//! Air-gapped clusters can't pull images from the public internet. This module
//! is the MCP-side answer to "how do I get an image into my internal registry?"
//! — it shells out to `skopeo copy`, which is the de-facto tool for copying
//! images between locations without a running Docker daemon.
//!
//! Why a CLI shim rather than a pure-Rust OCI push:
//!
//! - `helm_ops.rs` already established the project's pattern for shelling out
//!   (detect → spawn → pump stdout/stderr to the event sink → collect result),
//!   so this mirrors a reviewed, working design.
//! - skopeo speaks every transport that matters for an air-gapped workflow —
//!   `docker://` (registries), `docker-archive:` (local `docker save` tars),
//!   `oci:` (OCI layouts), `dir:` (unpacked), `containers-storage:` (runtime
//!   store). A hand-rolled push would only cover `docker://` and still need
//!   `sha2` + a TLS-enabled reqwest + chunked-upload bookkeeping.
//! - skopeo resolves cross-architecture images, signatures, and layer reuse
//!   (already-present layers are skipped) for free.
//!
//! The trade-off mirrors `helm_ops`: the host running the MCP server needs
//! `skopeo` on its PATH. `which_skopeo()` detects it up front and the caller
//! surfaces a clear "install skopeo" message when it's missing.

use crate::error::{AppError, AppResult};
use crate::core::events::EventSink;
use crate::kube::imagerepo;
use serde::Serialize;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Tauri event name carrying one stdout/stderr line from a running skopeo call.
pub const IMAGE_SYNC_LOG_EVENT: &str = "image-sync-log";
/// Tauri event name signalling the end of an image sync (with success/failure).
pub const IMAGE_SYNC_DONE_EVENT: &str = "image-sync-done";

/// The result of a completed `skopeo copy`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSyncResult {
    /// The original source transport string (e.g. `docker://nginx:1.25`).
    pub source: String,
    /// The final destination (`docker://harbor.internal/library/nginx:1.25`).
    pub destination: String,
    /// True if the skopeo process exited 0.
    pub success: bool,
    /// Number of stdout+stderr lines produced (a rough "how chatty was it" gauge).
    pub lines: usize,
    /// Human-readable summary, e.g. "copied nginx:1.25 → harbor/library/nginx:1.25".
    pub summary: String,
}

/// One row from `image_sync_status` — whether skopeo is usable on this host.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkopeoAvailability {
    pub available: bool,
    /// Resolved binary path, or None when not found.
    pub path: Option<String>,
    /// `skopeo --version` output, or an install hint when missing.
    pub version: Option<String>,
}

/// Detect the skopeo binary. Checks the conventional install locations first
/// (so a Homebrew/macOS host doesn't pay a `which` spawn), then falls back to
/// `$PATH`. Returns None when skopeo isn't installed.
pub fn which_skopeo() -> Option<String> {
    for path in [
        "/usr/local/bin/skopeo",
        "/opt/homebrew/bin/skopeo",
        "/usr/bin/skopeo",
    ] {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    // Last resort: ask the shell. `which` is ubiquitous and cheap.
    if let Ok(out) = std::process::Command::new("which").arg("skopeo").output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    None
}

/// Probe skopeo availability + version. Cheap (`skopeo --version` exits
/// instantly), so the MCP `image_sync_status` tool can call it on every
/// invocation without slowing the conversation down.
pub async fn check_skopeo() -> SkopeoAvailability {
    let Some(path) = which_skopeo() else {
        return SkopeoAvailability {
            available: false,
            path: None,
            version: Some(
                "skopeo not found on PATH — install it (brew install skopeo / apt install skopeo) \
                 and retry"
                    .into(),
            ),
        };
    };
    // `--version` prints "skopeo version 1.x.y" and exits 0.
    let version = match Command::new(&path).arg("--version").output().await {
        Ok(out) => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        Err(e) => format!("could not run skopeo --version: {e}"),
    };
    SkopeoAvailability {
        available: true,
        path: Some(path),
        version: Some(version),
    }
}

/// Strip the `https://` / `http://` scheme and any trailing slash from a
/// registry URL, leaving the bare `host[:port]` that a docker transport needs.
///
/// `imagerepo::ImageRegistry.url` is stored as `https://registry.example.com`
/// (the UI's convention — it's what the catalog API wants). skopeo's
/// `docker://` transport takes a bare host, so we canonicalise here.
pub fn registry_host(url: &str) -> String {
    let trimmed = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);
    trimmed.trim_end_matches('/').to_string()
}

/// Build the destination docker-transport reference for a copy.
///
/// Joins the registry host, the repo path, and the tag into the canonical
/// `docker://host/repo:tag` form skopeo expects. We don't lowercase the host
/// here — registries are case-sensitive on the host part only in pathological
/// setups, and the repo path is case-sensitive by spec.
pub fn dest_reference(host: &str, repo: &str, tag: &str) -> String {
    // Avoid a double slash when the user passes a repo that already starts
    // with one (some UIs store `library/nginx`, others `/library/nginx`).
    let repo = repo.trim_start_matches('/');
    if tag.is_empty() {
        format!("docker://{host}/{repo}")
    } else {
        format!("docker://{host}/{repo}:{tag}")
    }
}

/// Copy an image from `source` into the configured destination registry.
///
/// `source` is any skopeo transport string:
///   - `docker://nginx:1.25`           — a public registry image
///   - `docker://registry-a/foo:v1`     — another private registry
///   - `docker-archive:/tmp/image.tar`  — a local `docker save` tarball
///   - `oci:/path/to/layout:tag`        — an OCI image layout
///   - `dir:/path/to/unpacked`          — an unpacked image directory
///
/// The destination is resolved from the user's configured registries
/// (`imagerepo::list_registries`) by `dest_registry` name — this reuses the
/// stored URL + credentials so the caller never handles secrets directly.
///
/// Streams each stdout/stderr line to the event sink (so a UI can show live
/// "Copying blob sha256:…" progress) and returns the final result.
pub async fn copy_image(
    source: &str,
    dest_registry: &str,
    dest_repo: &str,
    dest_tag: &str,
    src_creds: Option<&str>,
    insecure_src: bool,
    insecure_dest: bool,
    sink: EventSink,
) -> AppResult<ImageSyncResult> {
    let skopeo = which_skopeo().ok_or_else(|| {
        AppError::Other(
            "skopeo CLI not found in PATH — install skopeo \
             (brew install skopeo / apt install skopeo) and retry"
                .into(),
        )
    })?;

    // Resolve the destination registry from the stored configuration. We need
    // the full ImageRegistry (with the decrypted password) to build creds.
    let reg = imagerepo::list_registries()
        .map_err(|e| AppError::Other(format!("load registries: {e}")))?
        .into_iter()
        .find(|r| r.name == dest_registry)
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "destination registry '{dest_registry}' is not configured — add it via the \
                 registries UI (or image_registry_upsert) first"
            ))
        })?;

    let host = registry_host(&reg.url);
    let dest_ref = dest_reference(&host, dest_repo, dest_tag);

    let argv = build_argv(
        &skopeo,
        source,
        &dest_ref,
        src_creds,
        reg.username.as_str(),
        reg.password.as_str(),
        insecure_src,
        insecure_dest,
    );

    let mut cmd = Command::new(&skopeo);
    cmd.args(&argv)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // skopeo reads its config from $HOME/.local/share/containers; pass
        // HOME through so auth files resolve the same way as a manual run.
        .envs(std::env::vars().filter(|(k, _)| k == "HOME" || k == "PATH"));

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("spawn skopeo: {e}")))?;

    // Pump stdout and stderr concurrently into the sink, exactly like helm_ops.
    // skopeo writes layer-by-layer progress to stderr ("Copying blob … done")
    // and a final summary to stdout; interleaving them with a stream prefix
    // gives the UI enough context to render a live log.
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Other("no stdout from skopeo".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Other("no stderr from skopeo".into()))?;

    let line_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let sink_out = sink.clone();
    let count_out = line_count.clone();
    let out_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            count_out.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let _ = sink_out.emit(IMAGE_SYNC_LOG_EVENT, &LogLine { stream: "stdout", line });
        }
    });
    let sink_err = sink.clone();
    let count_err = line_count.clone();
    let err_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            count_err.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let _ = sink_err.emit(IMAGE_SYNC_LOG_EVENT, &LogLine { stream: "stderr", line });
        }
    });

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Other(format!("wait skopeo: {e}")))?;
    // Drain both pumps before we read the count / build the summary.
    let _ = tokio::join!(out_task, err_task);

    let success = status.success();
    let lines = line_count.load(std::sync::atomic::Ordering::Relaxed);
    let summary = if success {
        format!("copied {source} → {dest_registry}/{dest_repo}:{dest_tag}")
    } else {
        format!("skopeo copy failed: {status}")
    };

    let result = ImageSyncResult {
        source: source.to_string(),
        destination: dest_ref,
        success,
        lines,
        summary,
    };
    let _ = sink.emit(IMAGE_SYNC_DONE_EVENT, &result);
    if success {
        Ok(result)
    } else {
        Err(AppError::Other(result.summary))
    }
}

/// Construct the `skopeo copy` argv. Kept separate from `copy_image` so a unit
/// test can assert the flag ordering without spinning up skopeo.
#[allow(clippy::too_many_arguments)]
fn build_argv(
    skopeo: &str,
    source: &str,
    dest: &str,
    src_creds: Option<&str>,
    dest_user: &str,
    dest_pass: &str,
    insecure_src: bool,
    insecure_dest: bool,
) -> Vec<String> {
    let _ = skopeo; // the caller already resolved the path; argv is skopeo-agnostic
    let mut argv: Vec<String> = vec![
        "copy".into(),
        // Retry transient network failures (a flaky registry mid-copy shouldn't
        // abort a 2 GB image push). skopeo's default is 0 retries.
        "--retry-times".into(),
        "3".into(),
        // Always target linux/amd64 unless the source is arch-specific. Without
        // this, skopeo on a macOS/arm64 host would select the arm64 variant of
        // a multi-arch image — almost never what a linux cluster wants.
        "--override-os".into(),
        "linux".into(),
        "--override-arch".into(),
        "amd64".into(),
    ];

    if let Some(creds) = src_creds {
        argv.push("--src-creds".into());
        argv.push(creds.into());
    }
    if insecure_src {
        argv.push("--src-tls-verify=false".into());
    }
    if !dest_user.is_empty() {
        // Only attach dest creds when there's a username; an empty user:pass
        // would make skopeo prompt and hang the tool call.
        argv.push("--dest-creds".into());
        argv.push(format!("{dest_user}:{dest_pass}"));
    }
    if insecure_dest {
        argv.push("--dest-tls-verify=false".into());
    }

    argv.push(source.into());
    argv.push(dest.into());
    argv
}

#[derive(Serialize, Clone)]
struct LogLine<'a> {
    stream: &'a str,
    line: String,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_host_strips_scheme_and_trailing_slash() {
        assert_eq!(registry_host("https://harbor.example.com"), "harbor.example.com");
        assert_eq!(registry_host("http://reg.local:5000"), "reg.local:5000");
        assert_eq!(registry_host("https://reg.local/"), "reg.local");
        // No scheme: pass through (only trailing slash stripped).
        assert_eq!(registry_host("reg.local:5000/"), "reg.local:5000");
    }

    #[test]
    fn dest_reference_joins_host_repo_tag() {
        assert_eq!(
            dest_reference("harbor.local", "library/nginx", "1.25"),
            "docker://harbor.local/library/nginx:1.25"
        );
    }

    #[test]
    fn dest_reference_omits_colon_when_tag_empty() {
        // An empty tag copies by digest (skopeo resolves it from the source).
        assert_eq!(
            dest_reference("reg.local", "app", ""),
            "docker://reg.local/app"
        );
    }

    #[test]
    fn dest_reference_dedupes_leading_slash_in_repo() {
        // Some callers pass "/library/nginx"; avoid "docker://host//library/nginx".
        assert_eq!(
            dest_reference("reg.local", "/library/nginx", "v1"),
            "docker://reg.local/library/nginx:v1"
        );
    }

    #[test]
    fn build_argv_attaches_dest_creds_only_when_user_present() {
        let with_creds = build_argv(
            "skopeo", "docker://nginx:1", "docker://h/app:1", None, "admin", "s3cret", false, false,
        );
        assert!(with_creds.contains(&"--dest-creds".into()));
        assert!(with_creds.contains(&"admin:s3cret".into()));
        // No src creds when src_creds is None.
        assert!(!with_creds.contains(&"--src-creds".into()));
    }

    #[test]
    fn build_argv_skips_dest_creds_when_user_empty() {
        // An empty username means anonymous access — don't send "user:pass".
        let no_creds = build_argv(
            "skopeo", "docker://nginx:1", "docker://h/app:1", None, "", "", false, false,
        );
        assert!(!no_creds.contains(&"--dest-creds".into()));
    }

    #[test]
    fn build_argv_adds_src_creds_when_provided() {
        let argv = build_argv(
            "skopeo",
            "docker://reg-a/foo:v1",
            "docker://h/foo:v1",
            Some("user:pass"),
            "",
            "",
            false,
            false,
        );
        assert!(argv.contains(&"--src-creds".into()));
        assert!(argv.contains(&"user:pass".into()));
    }

    #[test]
    fn build_argv_respects_insecure_flags() {
        let argv = build_argv(
            "skopeo", "docker://nginx:1", "docker://h/app:1", None, "", "", true, true,
        );
        assert!(argv.contains(&"--src-tls-verify=false".into()));
        assert!(argv.contains(&"--dest-tls-verify=false".into()));
    }

    #[test]
    fn build_argv_forces_linux_amd64() {
        // Regression guard: the override flags must always be present so a
        // macOS host doesn't silently copy a darwin/arm64 image.
        let argv = build_argv(
            "skopeo", "docker://nginx:1", "docker://h/app:1", None, "", "", false, false,
        );
        assert!(argv.contains(&"--override-os".into()));
        assert!(argv.contains(&"linux".into()));
        assert!(argv.contains(&"--override-arch".into()));
        assert!(argv.contains(&"amd64".into()));
    }

    #[test]
    fn build_argv_puts_source_and_dest_last() {
        // skopeo parses positionally: flags first, then <source> <destination>.
        let argv = build_argv(
            "skopeo", "docker://nginx:1", "docker://h/app:1", None, "", "", false, false,
        );
        assert_eq!(argv[argv.len() - 2], "docker://nginx:1");
        assert_eq!(argv[argv.len() - 1], "docker://h/app:1");
    }
}

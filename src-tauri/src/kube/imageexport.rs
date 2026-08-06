//! Export a container image from a cluster node's container runtime to a local
//! `.tar` file. This is the reverse of [`imageimport`] — instead of piping a tar
//! into the runtime's load command, we run the runtime's export command and
//! stream the tar bytes back through exec stdout.
//!
//! ## Mechanism
//!
//! Same privileged debug pod trick as `imageimport`: create a pod pinned to the
//! node, `nsenter` into PID 1's namespaces, run the export command. The tar
//! bytes come back over exec stdout and are written directly to a local file.
//!
//! Runtime-specific commands:
//!   - containerd → `ctr --address /run/containerd/containerd.sock images export --output - <image-ref>`
//!   - docker     → `docker save <image-ref>`

use crate::error::{AppError, AppResult};
use k8s_openapi::api::core::v1::{Node, Pod};
use kube::api::{Api, AttachParams, PostParams};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::AsyncReadExt;

use crate::kube::{imageimport, nodeshell};

/// Result of exporting an image from a node.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    /// Detected runtime: "containerd" | "docker".
    pub runtime: String,
    /// Raw stdout from the export command (usually empty on success — tar goes to file).
    pub output: String,
    /// Exported image refs (echoed from the input).
    pub images: Vec<String>,
    /// Local file path the tar was saved to.
    pub saved_path: String,
    /// None on success; failure reason on error.
    pub error: Option<String>,
}

static EXPORT_SEQ: AtomicU64 = AtomicU64::new(0);

/// Build the `nsenter … /bin/sh -c "<export-cmd>"` argv that writes the tar to
/// stdout. The caller reads stdout and writes it to a local file.
pub fn export_command(runtime: &str, image_ref: &str) -> AppResult<Vec<String>> {
    let inner = match runtime {
        "containerd" => format!(
            "ctr --address /run/containerd/containerd.sock images export --output - {image_ref}"
        ),
        "docker" => format!("docker save {image_ref}"),
        other => return Err(AppError::Other(format!("unsupported runtime '{other}'"))),
    };
    Ok(vec![
        "nsenter".into(),
        "--target".into(),
        "1".into(),
        "--mount".into(),
        "--uts".into(),
        "--ipc".into(),
        "--net".into(),
        "--pid".into(),
        "--".into(),
        "/bin/sh".into(),
        "-c".into(),
        inner,
    ])
}

/// Build the argv to list images on a node.
fn list_command(runtime: &str) -> Vec<String> {
    let inner = match runtime {
        "containerd" => "ctr --address /run/containerd/containerd.sock images list -q",
        "docker" => "docker images --format json",
        _ => "",
    };
    vec![
        "nsenter".into(),
        "--target".into(),
        "1".into(),
        "--mount".into(),
        "--uts".into(),
        "--ipc".into(),
        "--net".into(),
        "--pid".into(),
        "--".into(),
        "/bin/sh".into(),
        "-c".into(),
        inner.into(),
    ]
}

/// Parse image refs from `docker images --format json` or `ctr images list -q` output.
pub fn parse_listed_images(output: &str, runtime: &str) -> Vec<String> {
    match runtime {
        "docker" => {
            // `docker images --format json` outputs one JSON object per line.
            output
                .lines()
                .filter_map(|line| {
                    let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
                    let repo = v.get("Repository")?.as_str()?;
                    let tag = v.get("Tag")?.as_str()?;
                    if repo == "<none>" || tag == "<none>" {
                        return None;
                    }
                    Some(format!("{repo}:{tag}"))
                })
                .collect()
        }
        "containerd" => {
            // `ctr images list -q` outputs one ref per line.
            output
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect()
        }
        _ => Vec::new(),
    }
}

/// List container images present on a node.
pub async fn list_node_images(client: kube::Client, node: &str) -> AppResult<Vec<String>> {
    let node_api: Api<Node> = Api::all(client.clone());
    let node_obj = node_api.get(node).await?;
    let version = node_obj
        .status
        .as_ref()
        .and_then(|s| s.node_info.as_ref())
        .map(|i| i.container_runtime_version.clone())
        .unwrap_or_default();
    let runtime = imageimport::detect_runtime(&version)?;
    let argv = list_command(&runtime);

    let image = std::env::var("K7S_NODE_SHELL_IMAGE")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| nodeshell::DEFAULT_IMAGE.to_string());
    let pod_name = format!("k7s-imgls-{}-0", sanitize_for_name(node));
    let pod_spec = nodeshell::debug_pod_spec(node, &image, &pod_name);

    let pod_api: Api<Pod> = Api::namespaced(client.clone(), nodeshell::DEBUG_NAMESPACE);
    if let Err(e) = pod_api.create(&PostParams::default(), &pod_spec).await {
        return Err(AppError::Other(format!("create debug pod: {e}")));
    }

    let res: AppResult<Vec<String>> = async {
        nodeshell::await_debug_pod(&pod_api, &pod_name).await?;
        let mut ap = AttachParams::default()
            .stdin(false)
            .stdout(true)
            .stderr(false)
            .tty(false);
        ap = ap.container(&pod_name);
        let mut proc = pod_api.exec(&pod_name, argv, &ap).await?;
        let mut out = Vec::new();
        if let Some(mut stdout) = proc.stdout() {
            stdout.read_to_end(&mut out).await.ok();
        }
        let status_opt = proc
            .take_status()
            .ok_or_else(|| AppError::Other("no status channel".into()))?
            .await;
        let succeeded = status_opt
            .as_ref()
            .and_then(|s| s.status.as_deref())
            .map(|s| s == "Success")
            .unwrap_or(true);
        let output = String::from_utf8_lossy(&out).to_string();
        if !succeeded {
            return Err(AppError::Other(format!(
                "list images failed: {:?} (output: {})",
                status_opt.and_then(|s| s.message),
                output,
            )));
        }
        Ok(parse_listed_images(&output, &runtime))
    }
    .await;

    nodeshell::delete_debug_pod(&pod_api, &pod_name).await;
    res
}

/// Export an image from a node to a local .tar file.
pub async fn export_from_node(
    client: kube::Client,
    node: &str,
    image_ref: &str,
    save_path: &str,
) -> AppResult<ExportResult> {
    let node_api: Api<Node> = Api::all(client.clone());
    let node_obj = node_api.get(node).await?;
    let version = node_obj
        .status
        .as_ref()
        .and_then(|s| s.node_info.as_ref())
        .map(|i| i.container_runtime_version.clone())
        .unwrap_or_default();
    let runtime = match imageimport::detect_runtime(&version) {
        Ok(r) => r,
        Err(e) => {
            return Ok(ExportResult {
                runtime: String::new(),
                output: String::new(),
                images: Vec::new(),
                saved_path: save_path.to_string(),
                error: Some(e.to_string()),
            });
        }
    };
    let argv = export_command(&runtime, image_ref)?;

    let pod_api: Api<Pod> = Api::namespaced(client.clone(), nodeshell::DEBUG_NAMESPACE);
    let seq = EXPORT_SEQ.fetch_add(1, Ordering::Relaxed);
    let pod_name = format!("k7s-imgexp-{}-{}", sanitize_for_name(node), seq);
    let image = std::env::var("K7S_NODE_SHELL_IMAGE")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| nodeshell::DEFAULT_IMAGE.to_string());
    let pod_spec = nodeshell::debug_pod_spec(node, &image, &pod_name);

    if let Err(e) = pod_api.create(&PostParams::default(), &pod_spec).await {
        return Err(AppError::Other(format!("create debug pod: {e}")));
    }

    let res: AppResult<(String, Vec<String>)> = async {
        nodeshell::await_debug_pod(&pod_api, &pod_name).await?;

        let mut ap = AttachParams::default()
            .stdin(false)
            .stdout(true)
            .stderr(false)
            .tty(false);
        ap = ap.container(&pod_name);
        let mut proc = pod_api.exec(&pod_name, argv, &ap).await?;

        // Stream stdout to the local file.
        let mut file = tokio::fs::File::create(save_path)
            .await
            .map_err(|e| AppError::Other(format!("create file '{save_path}': {e}")))?;
        let mut total_bytes: u64 = 0;
        if let Some(mut stdout) = proc.stdout() {
            let mut buf = vec![0u8; 256 * 1024]; // 256 KB chunks
            loop {
                let n = stdout.read(&mut buf).await.unwrap_or(0);
                if n == 0 {
                    break;
                }
                tokio::io::AsyncWriteExt::write_all(&mut file, &buf[..n])
                    .await
                    .map_err(|e| AppError::Other(format!("write file: {e}")))?;
                total_bytes += n as u64;
            }
        }
        tokio::io::AsyncWriteExt::flush(&mut file)
            .await
            .map_err(|e| AppError::Other(format!("flush file: {e}")))?;

        let status_opt = proc
            .take_status()
            .ok_or_else(|| AppError::Other("no status channel".into()))?
            .await;
        let succeeded = status_opt
            .as_ref()
            .and_then(|s| s.status.as_deref())
            .map(|s| s == "Success")
            .unwrap_or(true);
        let output = format!("exported {total_bytes} bytes to {save_path}");
        if !succeeded {
            // Clean up the partial file.
            tokio::fs::remove_file(save_path).await.ok();
            return Err(AppError::Other(format!(
                "image export failed: {:?}",
                status_opt.and_then(|s| s.message),
            )));
        }
        Ok((output, vec![image_ref.to_string()]))
    }
    .await;

    nodeshell::delete_debug_pod(&pod_api, &pod_name).await;

    match res {
        Ok((output, images)) => Ok(ExportResult {
            runtime,
            output,
            images,
            saved_path: save_path.to_string(),
            error: None,
        }),
        Err(e) => Ok(ExportResult {
            runtime,
            output: String::new(),
            images: Vec::new(),
            saved_path: save_path.to_string(),
            error: Some(e.to_string()),
        }),
    }
}

fn sanitize_for_name(node: &str) -> String {
    node.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_command_containerd() {
        let argv = export_command("containerd", "nginx:1.25").unwrap();
        let cmd = argv.join(" ");
        assert!(cmd.contains("ctr --address /run/containerd/containerd.sock"));
        assert!(cmd.contains("images export"));
        assert!(cmd.contains("nginx:1.25"));
        assert!(argv[0] == "nsenter");
    }

    #[test]
    fn export_command_docker() {
        let argv = export_command("docker", "nginx:1.25").unwrap();
        let cmd = argv.join(" ");
        assert!(cmd.contains("docker save"));
        assert!(cmd.contains("nginx:1.25"));
        assert!(argv[0] == "nsenter");
    }

    #[test]
    fn export_command_unknown_runtime_errors() {
        assert!(export_command("cri-o", "nginx:1.25").is_err());
    }

    #[test]
    fn parse_docker_images_list() {
        let output = r#"{"Repository":"nginx","Tag":"1.25","ID":"sha256:abc123","Size":"12345678"}
{"Repository":"busybox","Tag":"latest","ID":"sha256:def456","Size":"1234567"}"#;
        let images = parse_listed_images(output, "docker");
        assert_eq!(images, vec!["nginx:1.25", "busybox:latest"]);
    }

    #[test]
    fn parse_containerd_images_list() {
        let output = "REF\tTYPE\tDIGEST\tSIZE\tPLATFORMS\tLABELS\tSTATUS\ndocker.io/library/nginx:1.25\tapplication/vnd.oci.image.manifest.v1+json\tsha256:abc\t12MB\triscv64\t\ttruetrue";
        let images = parse_listed_images(output, "containerd");
        assert!(images.iter().any(|i| i.contains("nginx:1.25")));
    }
}

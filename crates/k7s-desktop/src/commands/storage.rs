//! Storage and image management commands: pod file browser, image registry,
//! image import/sync, and multi-document YAML apply (templates).

use crate::commands::core::require_client;
use crate::core::CoreState;
use crate::error::{AppError, AppResult};
use crate::kube::{
    image_archive, image_sync, imageexport, imageimport, imagerepo, pod_files, templates,
};
use std::sync::Arc;
use tauri::State;

// ---------------------------------------------------------------------------
// Pod file management (Phase 2 of KubePi parity) — browse / read / write /
// download / upload inside a running pod's container.
// ---------------------------------------------------------------------------

/// List a directory inside a pod's container. Returns file / dir / symlink
/// entries with sizes, mtimes, and POSIX modes.
#[tauri::command]
pub async fn pod_files_list(
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<pod_files::FileEntry>> {
    let client = require_client(&mgr.manager).await?;
    pod_files::list_dir(client, &namespace, &pod, container.as_deref(), &path).await
}

/// Read a file's text contents. Returns UTF-8 lossy so logs/configs work
/// even if the bytes aren't valid UTF-8 (e.g. UTF-16 BOM'd files).
#[tauri::command]
pub async fn pod_files_read(
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<String> {
    let client = require_client(&mgr.manager).await?;
    pod_files::read_file(client, &namespace, &pod, container.as_deref(), &path).await
}

/// Write a file's contents inside a container. Creates parent directories
/// as needed.
#[tauri::command]
pub async fn pod_files_write(
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
    content: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    let client = require_client(&mgr.manager).await?;
    pod_files::write_file(
        client,
        &namespace,
        &pod,
        container.as_deref(),
        &path,
        &content,
    )
    .await
}

/// Download a path as a tar archive. The frontend turns the bytes into a
/// user-saved file.
#[tauri::command]
pub async fn pod_files_download(
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<u8>> {
    let client = require_client(&mgr.manager).await?;
    pod_files::download_path(client, &namespace, &pod, container.as_deref(), &path).await
}

/// Upload a tar archive (bytes) into a directory inside a container.
#[tauri::command]
pub async fn pod_files_upload(
    namespace: String,
    pod: String,
    container: Option<String>,
    dest_dir: String,
    tar_b64: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    use k7s_deps::base64::Engine;
    let bytes = k7s_deps::base64::engine::general_purpose::STANDARD
        .decode(&tar_b64)
        .map_err(|e| AppError::Other(format!("base64 decode: {e}")))?;
    let client = require_client(&mgr.manager).await?;
    pod_files::upload_path(
        client,
        &namespace,
        &pod,
        container.as_deref(),
        &dest_dir,
        &bytes,
    )
    .await
}

// ---------------------------------------------------------------------------
// Image registry management (Phase 5 of KubePi parity).
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn image_registry_list() -> AppResult<Vec<imagerepo::ImageRegistry>> {
    imagerepo::list_registries()
}

#[tauri::command]
pub fn image_registry_upsert(
    name: String,
    url: String,
    username: String,
    password: String,
    insecure: bool,
    description: String,
) -> AppResult<imagerepo::ImageRegistry> {
    imagerepo::upsert_registry(&name, &url, &username, &password, insecure, &description)
}

#[tauri::command]
pub fn image_registry_remove(name: String) -> AppResult<()> {
    imagerepo::remove_registry(&name)
}

#[tauri::command]
pub async fn image_registry_test(name: String) -> AppResult<()> {
    let reg = imagerepo::list_registries()?
        .into_iter()
        .find(|r| r.name == name)
        .ok_or_else(|| AppError::NotFound(format!("registry '{name}' not found")))?;
    imagerepo::test_connect(&reg).await
}

#[tauri::command]
pub async fn image_registry_repos(name: String) -> AppResult<Vec<imagerepo::RepoEntry>> {
    let reg = imagerepo::list_registries()?
        .into_iter()
        .find(|r| r.name == name)
        .ok_or_else(|| AppError::NotFound(format!("registry '{name}' not found")))?;
    imagerepo::list_repositories(&reg).await
}

#[tauri::command]
pub async fn image_registry_tags(
    name: String,
    repo: String,
) -> AppResult<Vec<imagerepo::TagEntry>> {
    let reg = imagerepo::list_registries()?
        .into_iter()
        .find(|r| r.name == name)
        .ok_or_else(|| AppError::NotFound(format!("registry '{name}' not found")))?;
    imagerepo::list_tags(&reg, &repo).await
}

// ---------------------------------------------------------------------------
// Multi-document YAML apply (Phase 4 — used by the templates feature).
// ---------------------------------------------------------------------------

/// Apply a multi-document YAML bundle. Returns one `ApplyResult` per doc,
/// with `action` set to "created", "updated", or "failed" and a per-doc
/// error message on failure.
#[tauri::command]
pub async fn apply_yaml_bundle(
    yaml: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<templates::ApplyResult>> {
    let client = require_client(&mgr.manager).await?;
    templates::multi_apply(&yaml, client, &mgr.manager).await
}

/// Dry-run a multi-document YAML bundle without writing (YAML-import create
/// mode's Preview step). The single-doc `dry_run_yaml` can't handle a
/// multi-kind create bundle, so this reuses `templates::multi_dry_run`.
#[tauri::command]
pub async fn dry_run_yaml_bundle(
    yaml: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<templates::DocDryRun>> {
    let client = require_client(&mgr.manager).await?;
    templates::multi_dry_run(&yaml, client).await
}

// ---------------------------------------------------------------------------
// Image import (air-gapped clusters) — load a local .tar into a node's
// container runtime via a temporary privileged pod. Desktop only (the file
// path comes from the native picker); the web shell has no local-disk access.
// ---------------------------------------------------------------------------

/// Soft cap on a single import's tar size. Real images rarely exceed a few GB;
/// this guards against a typo'd path to a disk image OOMing the app. Tunable
/// later via prefs if real-world images are larger.
const IMAGE_IMPORT_MAX_BYTES: u64 = 8 * 1024 * 1024 * 1024; // 8 GiB

/// Import a local `.tar` image archive into a node's container runtime.
///
/// `path` is an absolute filesystem path from `tauri-plugin-dialog`'s native
/// picker. The file is read server-side (not base64 over IPC) because a tar
/// can be gigabytes; streaming one through the frontend would balloon memory.
#[tauri::command]
pub async fn import_image_to_node(
    node: String,
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<imageimport::ImportResult> {
    let client = require_client(&mgr.manager).await?;
    // Stat first so a path to a huge file fails fast with a clear message
    // rather than reading 8 GiB into RAM before refusing.
    let meta = std::fs::metadata(&path)
        .map_err(|e| AppError::Other(format!("read file '{}': {e}", path)))?;
    if meta.len() > IMAGE_IMPORT_MAX_BYTES {
        return Err(AppError::Other(format!(
            "file is {} bytes, exceeds the {} byte import cap",
            meta.len(),
            IMAGE_IMPORT_MAX_BYTES
        )));
    }
    let tar_bytes =
        std::fs::read(&path).map_err(|e| AppError::Other(format!("read file '{}': {e}", path)))?;
    imageimport::import_to_node(client, &node, &tar_bytes).await
}

// ---------------------------------------------------------------------------
// Image sync (skopeo) — copy an image into a configured private registry.
// Air-gapped clusters with an internal registry use this; the per-node
// `import_image_to_node` above is for clusters with no registry at all. These
// bridge the MCP-only `image_sync` module to the Tauri UI. Progress streams
// over the shared event sink as `image-sync-log` / `image-sync-done` events.
// ---------------------------------------------------------------------------

/// Whether skopeo is installed and usable on this host. Cheap (`skopeo
/// --version`), so the UI can call it on panel open to gate the To-Registry
/// tab.
#[tauri::command]
pub async fn image_sync_status() -> AppResult<image_sync::SkopeoAvailability> {
    Ok(image_sync::check_skopeo().await)
}

/// Copy an image into a configured destination registry via `skopeo copy`.
/// `source` is any skopeo transport (`docker://nginx:1.25`,
/// `docker-archive:/tmp/img.tar`, `oci:…`); the destination registry is
/// resolved by name from the stored image-registries config (its credentials
/// are used automatically). Streams each stdout/stderr line as an
/// `image-sync-log` event so the UI can render a live progress log.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn image_copy(
    source: String,
    dest_registry: String,
    dest_repo: String,
    dest_tag: String,
    src_creds: Option<String>,
    insecure_src: bool,
    insecure_dest: bool,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<image_sync::ImageSyncResult> {
    let sink = mgr.manager.sink();
    image_sync::copy_image(
        &source,
        &dest_registry,
        &dest_repo,
        &dest_tag,
        src_creds.as_deref(),
        insecure_src,
        insecure_dest,
        sink,
    )
    .await
}

/// Inspect a local `docker save` tarball before copying it: returns the image
/// name, tags, digest, architecture, os, and total size. Lets the user confirm
/// a tar's contents (and that it's linux/amd64) before pushing.
#[tauri::command]
pub async fn image_inspect_archive(tar_path: String) -> AppResult<image_archive::ArchiveInfo> {
    image_archive::inspect_archive(&tar_path).await
}

// ---------------------------------------------------------------------------
// Image export — get images out of a cluster node or registry to a local .tar.
// ---------------------------------------------------------------------------

/// Export a container image from a K8s node to a local .tar file.
#[tauri::command]
pub async fn export_from_node(
    node: String,
    image_ref: String,
    save_path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<imageexport::ExportResult> {
    let client = require_client(&mgr.manager).await?;
    imageexport::export_from_node(client, &node, &image_ref, &save_path).await
}

/// List container images present on a K8s node.
#[tauri::command]
pub async fn list_node_images(
    node: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<String>> {
    let client = require_client(&mgr.manager).await?;
    imageexport::list_node_images(client, &node).await
}

/// Export an image from a configured private registry to a local .tar file.
#[tauri::command]
pub async fn export_from_registry(
    registry_name: String,
    repo: String,
    tag: String,
    save_path: String,
    insecure_src: bool,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<image_sync::ExportRegistryResult> {
    let sink = mgr.manager.sink();
    image_sync::export_from_registry(&registry_name, &repo, &tag, &save_path, insecure_src, sink)
        .await
}

// ---------------------------------------------------------------------------
// Image manifest drill-down.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn image_registry_manifest(
    name: String,
    repo: String,
    tag: String,
) -> AppResult<imagerepo::ImageManifest> {
    let reg = imagerepo::list_registries()?
        .into_iter()
        .find(|r| r.name == name)
        .ok_or_else(|| AppError::NotFound(format!("registry '{name}' not found")))?;
    imagerepo::manifest(&reg, &repo, &tag).await
}

//! Storage and image management commands: pod file browser, image registry,
//! image import/sync, and multi-document YAML apply (templates).

use crate::commands::core::require_client;
use k7s_core::core::CoreState;
use k7s_core::error::{AppError, AppResult};
#[cfg(not(target_os = "android"))]
use k7s_core::kube::{image::archive, image::export, image::import, image::sync};
use k7s_core::kube::{image::repo, pod_files, templates};
#[cfg(feature = "ipc")]
use std::sync::Arc;
#[cfg(feature = "ipc")]
use tauri::State;

// ---------------------------------------------------------------------------
// Pod file management (Phase 2 of KubePi parity) — browse / read / write /
// download / upload inside a running pod's container.
// ---------------------------------------------------------------------------

/// List a directory inside a pod's container. Returns file / dir / symlink
/// entries with sizes, mtimes, and POSIX modes.
/// Wire arguments for [`pod_files_list`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PodFilesListArgs {
    pub namespace: String,
    pub pod: String,
    pub container: Option<String>,
    pub path: String,
}

pub async fn pod_files_list_impl(
    mgr: std::sync::Arc<CoreState>,
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
) -> AppResult<Vec<pod_files::FileEntry>> {
    let client = require_client(&mgr.manager).await?;
    pod_files::list_dir(client, &namespace, &pod, container.as_deref(), &path).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn pod_files_list(
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<pod_files::FileEntry>> {
    pod_files_list_impl(mgr.inner().clone(), namespace, pod, container, path).await
}

/// Read a file's text contents. Returns UTF-8 lossy so logs/configs work
/// even if the bytes aren't valid UTF-8 (e.g. UTF-16 BOM'd files).
/// Wire arguments for [`pod_files_read`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PodFilesReadArgs {
    pub namespace: String,
    pub pod: String,
    pub container: Option<String>,
    pub path: String,
}

pub async fn pod_files_read_impl(
    mgr: std::sync::Arc<CoreState>,
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
) -> AppResult<String> {
    let client = require_client(&mgr.manager).await?;
    pod_files::read_file(client, &namespace, &pod, container.as_deref(), &path).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn pod_files_read(
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<String> {
    pod_files_read_impl(mgr.inner().clone(), namespace, pod, container, path).await
}

/// Write a file's contents inside a container. Creates parent directories
/// as needed.
/// Wire arguments for [`pod_files_write`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PodFilesWriteArgs {
    pub namespace: String,
    pub pod: String,
    pub container: Option<String>,
    pub path: String,
    pub content: String,
}

pub async fn pod_files_write_impl(
    mgr: std::sync::Arc<CoreState>,
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
    content: String,
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

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn pod_files_write(
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
    content: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    pod_files_write_impl(
        mgr.inner().clone(),
        namespace,
        pod,
        container,
        path,
        content,
    )
    .await
}

/// Download a path as a tar archive. The frontend turns the bytes into a
/// user-saved file.
/// Wire arguments for [`pod_files_download`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PodFilesDownloadArgs {
    pub namespace: String,
    pub pod: String,
    pub container: Option<String>,
    pub path: String,
}

pub async fn pod_files_download_impl(
    mgr: std::sync::Arc<CoreState>,
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
) -> AppResult<Vec<u8>> {
    let client = require_client(&mgr.manager).await?;
    pod_files::download_path(client, &namespace, &pod, container.as_deref(), &path).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn pod_files_download(
    namespace: String,
    pod: String,
    container: Option<String>,
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<u8>> {
    pod_files_download_impl(mgr.inner().clone(), namespace, pod, container, path).await
}

/// Upload a tar archive (bytes) into a directory inside a container.
/// Wire arguments for [`pod_files_upload`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PodFilesUploadArgs {
    pub namespace: String,
    pub pod: String,
    pub container: Option<String>,
    pub dest_dir: String,
    pub tar_b64: String,
}

pub async fn pod_files_upload_impl(
    mgr: std::sync::Arc<CoreState>,
    namespace: String,
    pod: String,
    container: Option<String>,
    dest_dir: String,
    tar_b64: String,
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

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn pod_files_upload(
    namespace: String,
    pod: String,
    container: Option<String>,
    dest_dir: String,
    tar_b64: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<()> {
    pod_files_upload_impl(
        mgr.inner().clone(),
        namespace,
        pod,
        container,
        dest_dir,
        tar_b64,
    )
    .await
}

// ---------------------------------------------------------------------------
// Image registry management (Phase 5 of KubePi parity).
// ---------------------------------------------------------------------------

#[cfg(feature = "ipc")]
#[tauri::command]
pub fn image_registry_list() -> AppResult<Vec<repo::ImageRegistry>> {
    repo::list_registries()
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub fn image_registry_upsert(
    name: String,
    url: String,
    username: String,
    password: String,
    insecure: bool,
    description: String,
) -> AppResult<repo::ImageRegistry> {
    repo::upsert_registry(&name, &url, &username, &password, insecure, &description)
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub fn image_registry_remove(name: String) -> AppResult<()> {
    repo::remove_registry(&name)
}

/// Wire arguments for [`image_registry_test`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageRegistryTestArgs {
    pub name: String,
}

pub async fn image_registry_test_impl(name: String) -> AppResult<()> {
    let reg = repo::list_registries()?
        .into_iter()
        .find(|r| r.name == name)
        .ok_or_else(|| AppError::NotFound(format!("registry '{name}' not found")))?;
    repo::test_connect(&reg).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn image_registry_test(name: String) -> AppResult<()> {
    image_registry_test_impl(name).await
}

/// Wire arguments for [`image_registry_repos`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageRegistryReposArgs {
    pub name: String,
}

pub async fn image_registry_repos_impl(name: String) -> AppResult<Vec<repo::RepoEntry>> {
    let reg = repo::list_registries()?
        .into_iter()
        .find(|r| r.name == name)
        .ok_or_else(|| AppError::NotFound(format!("registry '{name}' not found")))?;
    repo::list_repositories(&reg).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn image_registry_repos(name: String) -> AppResult<Vec<repo::RepoEntry>> {
    image_registry_repos_impl(name).await
}

/// Wire arguments for [`image_registry_tags`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageRegistryTagsArgs {
    pub name: String,
    pub repo: String,
}

pub async fn image_registry_tags_impl(
    name: String,
    repo: String,
) -> AppResult<Vec<repo::TagEntry>> {
    let reg = repo::list_registries()?
        .into_iter()
        .find(|r| r.name == name)
        .ok_or_else(|| AppError::NotFound(format!("registry '{name}' not found")))?;
    repo::list_tags(&reg, &repo).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn image_registry_tags(name: String, repo: String) -> AppResult<Vec<repo::TagEntry>> {
    image_registry_tags_impl(name, repo).await
}

// ---------------------------------------------------------------------------
// Multi-document YAML apply (Phase 4 — used by the templates feature).
// ---------------------------------------------------------------------------

/// Apply a multi-document YAML bundle. Returns one `ApplyResult` per doc,
/// with `action` set to "created", "updated", or "failed" and a per-doc
/// error message on failure.
/// Wire arguments for [`apply_yaml_bundle`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplyYamlBundleArgs {
    pub yaml: String,
}

pub async fn apply_yaml_bundle_impl(
    mgr: std::sync::Arc<CoreState>,
    yaml: String,
) -> AppResult<Vec<templates::ApplyResult>> {
    let client = require_client(&mgr.manager).await?;
    templates::multi_apply(&yaml, client, &mgr.manager).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn apply_yaml_bundle(
    yaml: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<templates::ApplyResult>> {
    apply_yaml_bundle_impl(mgr.inner().clone(), yaml).await
}

/// Dry-run a multi-document YAML bundle without writing (YAML-import create
/// mode's Preview step). The single-doc `dry_run_yaml` can't handle a
/// multi-kind create bundle, so this reuses `templates::multi_dry_run`.
/// Wire arguments for [`dry_run_yaml_bundle`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DryRunYamlBundleArgs {
    pub yaml: String,
}

pub async fn dry_run_yaml_bundle_impl(
    mgr: std::sync::Arc<CoreState>,
    yaml: String,
) -> AppResult<Vec<templates::DocDryRun>> {
    let client = require_client(&mgr.manager).await?;
    templates::multi_dry_run(&yaml, client).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn dry_run_yaml_bundle(
    yaml: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<templates::DocDryRun>> {
    dry_run_yaml_bundle_impl(mgr.inner().clone(), yaml).await
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
#[cfg(not(target_os = "android"))]
/// Wire arguments for [`import_image_to_node`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportImageToNodeArgs {
    pub node: String,
    pub path: String,
}

pub async fn import_image_to_node_impl(
    mgr: std::sync::Arc<CoreState>,
    node: String,
    path: String,
) -> AppResult<import::ImportResult> {
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
    import::import_to_node(client, &node, &tar_bytes).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn import_image_to_node(
    node: String,
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<import::ImportResult> {
    import_image_to_node_impl(mgr.inner().clone(), node, path).await
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
#[cfg(not(target_os = "android"))]
pub async fn image_sync_status_impl() -> AppResult<sync::SkopeoAvailability> {
    Ok(sync::check_skopeo().await)
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn image_sync_status() -> AppResult<sync::SkopeoAvailability> {
    image_sync_status_impl().await
}

/// Copy an image into a configured destination registry via `skopeo copy`.
/// `source` is any skopeo transport (`docker://nginx:1.25`,
/// `docker-archive:/tmp/img.tar`, `oci:…`); the destination registry is
/// resolved by name from the stored image-registries config (its credentials
/// are used automatically). Streams each stdout/stderr line as an
/// `image-sync-log` event so the UI can render a live progress log.
#[cfg(not(target_os = "android"))]
#[cfg(feature = "ipc")]
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
) -> AppResult<sync::ImageSyncResult> {
    let sink = mgr.manager.sink();
    sync::copy_image(
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
#[cfg(not(target_os = "android"))]
/// Wire arguments for [`image_inspect_archive`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageInspectArchiveArgs {
    pub tar_path: String,
}

pub async fn image_inspect_archive_impl(tar_path: String) -> AppResult<archive::ArchiveInfo> {
    archive::inspect_archive(&tar_path).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn image_inspect_archive(tar_path: String) -> AppResult<archive::ArchiveInfo> {
    image_inspect_archive_impl(tar_path).await
}

// ---------------------------------------------------------------------------
// Image export — get images out of a cluster node or registry to a local .tar.
// ---------------------------------------------------------------------------

/// Export a container image from a K8s node to a local .tar file.
#[cfg(not(target_os = "android"))]
/// Wire arguments for [`export_from_node`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportFromNodeArgs {
    pub node: String,
    pub image_ref: String,
    pub save_path: String,
}

pub async fn export_from_node_impl(
    mgr: std::sync::Arc<CoreState>,
    node: String,
    image_ref: String,
    save_path: String,
) -> AppResult<export::ExportResult> {
    let client = require_client(&mgr.manager).await?;
    export::export_from_node(client, &node, &image_ref, &save_path).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn export_from_node(
    node: String,
    image_ref: String,
    save_path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<export::ExportResult> {
    export_from_node_impl(mgr.inner().clone(), node, image_ref, save_path).await
}

/// List container images present on a K8s node.
#[cfg(not(target_os = "android"))]
/// Wire arguments for [`list_node_images`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListNodeImagesArgs {
    pub node: String,
}

pub async fn list_node_images_impl(
    mgr: std::sync::Arc<CoreState>,
    node: String,
) -> AppResult<Vec<String>> {
    let client = require_client(&mgr.manager).await?;
    export::list_node_images(client, &node).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn list_node_images(
    node: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<String>> {
    list_node_images_impl(mgr.inner().clone(), node).await
}

/// Export an image from a configured private registry to a local .tar file.
#[cfg(not(target_os = "android"))]
/// Wire arguments for [`export_from_registry`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportFromRegistryArgs {
    pub registry_name: String,
    pub repo: String,
    pub tag: String,
    pub save_path: String,
    pub insecure_src: bool,
}

pub async fn export_from_registry_impl(
    mgr: std::sync::Arc<CoreState>,
    registry_name: String,
    repo: String,
    tag: String,
    save_path: String,
    insecure_src: bool,
) -> AppResult<sync::ExportRegistryResult> {
    let sink = mgr.manager.sink();
    sync::export_from_registry(&registry_name, &repo, &tag, &save_path, insecure_src, sink).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn export_from_registry(
    registry_name: String,
    repo: String,
    tag: String,
    save_path: String,
    insecure_src: bool,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<sync::ExportRegistryResult> {
    export_from_registry_impl(
        mgr.inner().clone(),
        registry_name,
        repo,
        tag,
        save_path,
        insecure_src,
    )
    .await
}

// ---------------------------------------------------------------------------
// Image manifest drill-down.
// ---------------------------------------------------------------------------

/// Wire arguments for [`image_registry_manifest`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageRegistryManifestArgs {
    pub name: String,
    pub repo: String,
    pub tag: String,
}

pub async fn image_registry_manifest_impl(
    name: String,
    repo: String,
    tag: String,
) -> AppResult<repo::ImageManifest> {
    let reg = repo::list_registries()?
        .into_iter()
        .find(|r| r.name == name)
        .ok_or_else(|| AppError::NotFound(format!("registry '{name}' not found")))?;
    repo::manifest(&reg, &repo, &tag).await
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn image_registry_manifest(
    name: String,
    repo: String,
    tag: String,
) -> AppResult<repo::ImageManifest> {
    image_registry_manifest_impl(name, repo, tag).await
}

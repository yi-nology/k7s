//! Storage and image management commands: pod file browser, image registry,
//! image import/sync, and multi-document YAML apply (templates).
//!
//! On iPadOS, pod file management, image registry/transfer/export, and related
//! desktop-only features are excluded to reduce binary size.

use crate::commands::core::require_client;
use crate::core::CoreState;
#[cfg(not(target_os = "ios"))]
use crate::error::AppError;
use crate::error::AppResult;
use crate::kube::templates;
use std::sync::Arc;
use tauri::State;

// ---------------------------------------------------------------------------
// Pod file management (Phase 2 of KubePi parity) — excluded from iPadOS.
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "ios"))]
mod pod_files_cmds {
    use super::*;
    use crate::kube::pod_files;

    /// List a directory inside a pod's container.
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

    /// Read a file's text contents.
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

    /// Write a file's contents inside a container.
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

    /// Download a path as a tar archive.
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
        use k7s_deps::base64;
        let bytes = base64::engine::general_purpose::STANDARD
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
}
#[cfg(not(target_os = "ios"))]
pub use pod_files_cmds::*;

// ---------------------------------------------------------------------------
// Image registry management (Phase 5 of KubePi parity) — excluded from iPadOS.
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "ios"))]
mod image_registry_cmds {
    use super::*;
    use crate::kube::imagerepo;

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
}
#[cfg(not(target_os = "ios"))]
pub use image_registry_cmds::*;

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
// Image import/export/sync — desktop only, excluded from iPadOS.
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "ios"))]
mod image_cmds {
    use super::*;
    use crate::kube::{image_archive, image_sync, imageexport, imageimport, imagerepo};

    /// Soft cap on a single import's tar size.
    const IMAGE_IMPORT_MAX_BYTES: u64 = 8 * 1024 * 1024 * 1024; // 8 GiB

    /// Import a local `.tar` image archive into a node's container runtime.
    #[tauri::command]
    pub async fn import_image_to_node(
        node: String,
        path: String,
        mgr: State<'_, Arc<CoreState>>,
    ) -> AppResult<imageimport::ImportResult> {
        let client = require_client(&mgr.manager).await?;
        let meta = std::fs::metadata(&path)
            .map_err(|e| AppError::Other(format!("read file '{}': {e}", path)))?;
        if meta.len() > IMAGE_IMPORT_MAX_BYTES {
            return Err(AppError::Other(format!(
                "file is {} bytes, exceeds the {} byte import cap",
                meta.len(),
                IMAGE_IMPORT_MAX_BYTES
            )));
        }
        let tar_bytes = std::fs::read(&path)
            .map_err(|e| AppError::Other(format!("read file '{}': {e}", path)))?;
        imageimport::import_to_node(client, &node, &tar_bytes).await
    }

    /// Whether skopeo is installed and usable on this host.
    #[tauri::command]
    pub async fn image_sync_status() -> AppResult<image_sync::SkopeoAvailability> {
        Ok(image_sync::check_skopeo().await)
    }

    /// Copy an image into a configured destination registry via `skopeo copy`.
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

    /// Inspect a local `docker save` tarball before copying it.
    #[tauri::command]
    pub async fn image_inspect_archive(tar_path: String) -> AppResult<image_archive::ArchiveInfo> {
        image_archive::inspect_archive(&tar_path).await
    }

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
        image_sync::export_from_registry(
            &registry_name,
            &repo,
            &tag,
            &save_path,
            insecure_src,
            sink,
        )
        .await
    }

    /// Image manifest drill-down.
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
}
#[cfg(not(target_os = "ios"))]
pub use image_cmds::*;

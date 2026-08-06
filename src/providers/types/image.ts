/**
 * Image and pod-file management types.
 *
 * Split from providers/types.ts during the large-file refactor.
 */

export interface PodFileEntry {
  name: string;
  /** "file" | "dir" | "symlink" | "other" */
  kind: string;
  size: number;
  /** Unix mtime seconds; 0 if unknown. */
  modified: number;
  target?: string;
  mode: number;
}

export interface ImageRegistry {
  name: string;
  url: string;
  username: string;
  insecure: boolean;
  description: string;
  lastError: string | null;
  lastRefreshed: string | null;
}

export interface ImageRegistryUpsert {
  name: string;
  url: string;
  username: string;
  password: string;
  insecure: boolean;
  description: string;
}

export interface ImageRepo {
  name: string;
}

export interface ImageTag {
  name: string;
  digest: string | null;
  size: number | null;
  created: string | null;
}

/** Result of importing a local `.tar` into a node's container runtime.
 * Mirrors the Rust `ImportResult` in `src-tauri/src/kube/imageimport.rs`. */
export interface ImportImageResult {
  /** Detected runtime family: "containerd" | "docker". Empty on a
   * pre-detection error (e.g. unsupported runtime). */
  runtime: string;
  /** Raw stdout from the load command (the "Loaded image: \u2026" lines). */
  output: string;
  /** Image refs parsed out of `output` (e.g. "nginx:1.25"). */
  images: string[];
  /** null on success; the failure reason on error. */
  error: string | null;
}

/** Whether skopeo is installed and usable on the host. Mirrors the Rust
 * `SkopeoAvailability` in `src-tauri/src/kube/image_sync.rs`. */
export interface SkopeoAvailability {
  available: boolean;
  /** Resolved binary path, or null when not found. */
  path: string | null;
  /** `skopeo --version` output, or an install hint when missing. */
  version: string | null;
}

/** Result of a completed `skopeo copy` into a private registry. Mirrors the
 * Rust `ImageSyncResult` in `src-tauri/src/kube/image_sync.rs`. */
export interface ImageSyncResult {
  /** The original source transport string (e.g. `docker-archive:/tmp/x.tar`). */
  source: string;
  /** The final destination (`docker://harbor.internal/library/nginx:1.25`). */
  destination: string;
  /** True if the skopeo process exited 0. */
  success: boolean;
  /** Number of stdout+stderr lines produced. */
  lines: number;
  /** Human-readable summary, e.g. "copied \u2026 -> harbor/library/nginx:1.25". */
  summary: string;
}

/** Salient facts about an image inside a local archive, enough to decide
 * whether to copy it. Mirrors the Rust `ArchiveInfo` in
 * `src-tauri/src/kube/image_archive.rs`. */
export interface ArchiveInfo {
  /** Canonical name (e.g. `docker.io/library/nginx`). May be empty. */
  name: string;
  /** Tag(s) stored in the archive (e.g. `["1.25", "latest"]`). */
  repoTags: string[];
  /** Content digest (`sha256:\u2026`). */
  digest: string;
  /** Target architecture, e.g. `amd64`. */
  architecture: string;
  /** Target OS, e.g. `linux`. */
  os: string;
  /** When the image was built (RFC3339), best-effort. */
  created: string;
  /** Total size of all layers in bytes (the on-wire size of the push). */
  sizeBytes: number;
}

export interface ImageManifest {
  schemaVersion: number;
  mediaType: string;
  digest: string;
  size: number;
  raw: string;
  configDigest: string;
  configSize: number;
  layers: ImageLayer[];
}

export interface ImageLayer {
  digest: string;
  size: number;
  mediaType: string;
}

// ---- Container image vulnerability scanning ----

/** A single vulnerability found in a container image (e.g. by Trivy / Grype). */
export interface Vulnerability {
  id: string; // CVE ID, e.g. "CVE-2023-1234"
  severity: string; // CRITICAL / HIGH / MEDIUM / LOW
  pkgName: string;
  installedVersion: string;
  fixedVersion: string | null;
  title: string;
  description: string;
  references: string[];
}

/** Severity counts rolled up from a vulnerability scan. */
export interface ScanSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

/** Result of a container image vulnerability scan. */
export interface ScanResult {
  engine: string; // scanner name, e.g. "trivy"
  target: string; // image reference scanned
  scannedAt: string; // ISO 8601
  summary: ScanSummary;
  vulnerabilities: Vulnerability[];
}

/** Information about a single scanning engine (trivy, grype, native). */
export interface ScannerEngineInfo {
  /** Engine name: "trivy", "grype", or "native". */
  name: string;
  /** Whether this engine is currently available. */
  available: boolean;
  /** Resolved binary path, or null for native (built-in). */
  path: string | null;
  /** Whether the user can configure a custom path for this engine. */
  configurable: boolean;
  /** Source of the path: "configured" (user-set) or "auto-detected" or "built-in". */
  pathSource: string;
}

/** Overall scanner status returned by the backend. */
export interface ScannerStatus {
  /** All known engines, in fallback priority order. */
  engines: ScannerEngineInfo[];
  /** The engine that would be used for the next scan. */
  activeEngine: string;
  /** Configured timeout (e.g. "5m"). */
  timeout: string;
}

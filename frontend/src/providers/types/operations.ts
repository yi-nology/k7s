/**
 * Template/bundle apply operations and CronJob trigger types.
 *
 * Split from providers/types.ts during the large-file refactor.
 */

export interface ApplyResult {
  name: string;
  kind: string;
  namespace: string;
  /** "created" | "updated" | "unchanged" | "failed" */
  action: string;
  error: string | null;
}

/** Per-document result of a bundle dry run (the create-side preview path).
 * Mirrors the Rust `DocDryRun` in `src-tauri/src/kube/templates.rs`. */
export interface DocDryRun {
  kind: string;
  namespace: string;
  name: string;
  /** Server-defaulted manifest that would be stored (after mutating
   * webhooks), serialized as YAML; null when the doc errored. */
  proposed: string | null;
  /** Per-doc error (parse / discovery / admission); null on success. */
  error: string | null;
}

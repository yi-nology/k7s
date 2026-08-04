/**
 * Cluster connection, context, and preference types.
 *
 * Split from providers/types.ts during the large-file refactor.
 */

import type { KindId } from './resource';

/** Cluster-wide status shown in the status bar and cluster switcher. */
export interface ClusterStatus {
  connected: boolean;
  /** Server git version, e.g. "v1.31". */
  version: string;
  apiLatencyMs: number;
  nodesReady: number;
  nodesTotal: number;
  /** null when metrics-server is unavailable — UI renders "\u2014". */
  cpuPercent: number | null;
  memPercent: number | null;
  /**
   * Kubeconfig context this status belongs to. Optional for backward
   * compatibility with backends that pre-date the context-tagging wire change;
   * when present, `useBootstrap`'s reconciliation drops statuses whose context
   * doesn't match the store's current context (so a stale event from the
   * previous cluster can't flip the new cluster's connection phase).
   */
  context?: string;
}

/** A kubeconfig context entry for the cluster switcher. */
export interface ContextInfo {
  name: string;
  /** The cluster this context points at (shown as the right-hand env tag). */
  cluster: string;
  /** True for the kubeconfig's current-context. */
  current: boolean;
}

/** Result of a successful kubeconfig import. */
export interface ImportResult {
  /** The merged switcher list: default kubeconfig contexts + all imported ones. */
  contexts: ContextInfo[];
  /** The file that was imported, persisted so it survives a relaunch (B17). */
  path: string;
}

/** Result of a successful {@link DataProvider.connect}. */
export interface ClusterInfo {
  context: string;
  clusterName: string;
  server: string;
  version: string;
}

/** Persisted UI preferences (B11) — where the user left off. */
export interface Prefs {
  context?: string | null;
  /** Last kind viewed; may be a custom kind's id (B15). */
  nav?: KindId | null;
  namespace?: string | null;
  showTimestamps?: boolean | null;
  /** Kubeconfig files imported by the user, re-imported on boot (B17). */
  importedFiles?: string[] | null;
  // ---- settings (B23) ----
  // Flat rather than nested so an older prefs.json keeps loading: serde and
  // JSON.parse both just leave absent fields undefined, and sanitizeSettings
  // fills them with defaults.
  logBufferCap?: number | null;
  metricsIntervalSecs?: number | null;
  statusIntervalSecs?: number | null;
  defaultNamespace?: string | null;
  shellCommand?: string | null;
  /** Colour palette: "dark" | "light" | "system" (B52). */
  theme?: string | null;
  /** UI language: "en" | "zh". Unrecognised values fall back to English. */
  language?: string | null;
  /** Image for the node debug shell; empty uses the default (B53). */
  nodeShellImage?: string | null;
  /** Pinned context names for the sidebar hotbar. */
  hotbar?: string[] | null;
}

/** Identifies a specific object for YAML/events/log commands. */
export interface ResourceRef {
  /** Built-in kind id, or a custom kind's "group/plural" id (B15). */
  kind: KindId;
  namespace?: string;
  name: string;
}

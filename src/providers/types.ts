/**
 * Shared data contract between the UI and whatever is feeding it data.
 *
 * Two implementations of {@link DataProvider}:
 *   - TauriProvider  — invokes Rust commands / listens to Tauri events (real cluster)
 *   - MockProvider   — replays fixture data (demo mode, plain browser)
 *
 * Components depend only on this interface, never on either implementation,
 * so the whole UI can run against mock data without a cluster.
 *
 * **The shapes here mirror `src-tauri/src/kube/dto.rs` 1:1.** When adding
 * a field on the Rust side, add it here too.
 */

// ---------------------------------------------------------------------------
// Resource kinds
// ---------------------------------------------------------------------------

/** Built-in Kubernetes resource kinds the app navigates. */
export type ResourceKind =
  | "pods"
  | "deployments"
  | "statefulsets"
  | "daemonsets"
  | "replicasets"
  | "jobs"
  | "cronjobs"
  | "services"
  | "ingresses"
  | "ingressclasses"
  | "configmaps"
  | "secrets"
  | "serviceaccounts"
  | "persistentvolumeclaims"
  | "persistentvolumeclaims" // alias
  | "persistentvolumes"
  | "storageclasses"
  | "poddisruptionbudgets"
  | "rolebindings"
  | "nodes"
  | "namespaces"
  | "events"
  | "hpa";

// ---------------------------------------------------------------------------
// Tone — the single coloring channel
// ---------------------------------------------------------------------------

/**
 * The one color bucket the backend exposes. The UI maps this to a CSS
 * variable. One source of truth for status semantics — drift between
 * backend and UI is impossible.
 */
export type Tone =
  | "primary" // names
  | "secondary" // data values
  | "muted" // namespace, age
  | "ok" // green / healthy
  | "warn" // amber / transient
  | "err"; // red / failure

// ---------------------------------------------------------------------------
// Cell — the unit of display
// ---------------------------------------------------------------------------

export type CellFormat = "age";

/** A click-through navigation target (e.g. pod → owning ReplicaSet). */
export interface NavTarget {
  kind: string;
  namespace?: string;
  name: string;
}

/** A single table cell. */
export interface Cell {
  text: string;
  tone: Tone;
  /** Render a leading "●" status dot in the tone color. */
  dot?: boolean;
  /** When "age", `text` is an RFC3339 timestamp the UI reformats & ticks. */
  format?: CellFormat;
  /** Numeric sort key for columns whose display text isn't orderable
   *  (e.g. "3.2Gi" / "486Mi"). Most columns sort by heuristic. */
  sort?: number;
  /** When set, the cell renders as a link to another object. */
  nav?: NavTarget;
}

// ---------------------------------------------------------------------------
// PodMeta — the only per-kind row extension
// ---------------------------------------------------------------------------

/** Pod-only fields the detail panel needs. */
export interface PodMeta {
  node: string;
  containers: string[];
  status: string;
  ready: string;
  restarts: number;
  /** RFC3339 creation timestamp. */
  creationTs: string;
  statusTone: Tone;
}

// ---------------------------------------------------------------------------
// Row — one table row
// ---------------------------------------------------------------------------

/** One row in a resource table. */
export interface Row {
  /** Stable id (k8s uid or synthetic). */
  uid: string;
  name: string;
  /** Undefined for cluster-scoped kinds. */
  namespace?: string;
  /** Cells in the same order as the kind's columns. */
  cells: Cell[];
  /** Present only on pod rows. */
  pod?: PodMeta;
  /** Labels, for label-selector filtering. */
  labels?: Record<string, string>;
  /** Workload's pod selector (for "view pods" jump). */
  selector?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Resource snapshot
// ---------------------------------------------------------------------------

/** Complete snapshot of one resource kind's rows. Replaces whatever the
 *  frontend has. Emitted on `resource-update` events. */
export interface ResourceSnapshot {
  kind: ResourceKind | string;
  rows: Row[];
}

// ---------------------------------------------------------------------------
// Cluster-level types
// ---------------------------------------------------------------------------

/** A kubeconfig context for the cluster switcher. */
export interface ContextInfo {
  name: string;
  cluster: string;
  user: string;
  namespace?: string;
  isCurrent: boolean;
}

/** Result of a successful `connect`. */
export interface ClusterInfo {
  context: string;
  clusterName: string;
  server: string;
  version: string;
}

/** Cluster-wide status (status bar / cluster switcher). */
export interface ClusterStatus {
  connected: boolean;
  version: string;
  apiLatencyMs: number;
  nodesReady: number;
  nodesTotal: number;
  /** null when metrics-server is absent — UI renders "—". */
  cpuPercent: number | null;
  memPercent: number | null;
}

// ---------------------------------------------------------------------------
// Log lines
// ---------------------------------------------------------------------------

/** A single parsed log line. */
export interface LogLine {
  /** "HH:MM:SS.mmm", or "" when timestamps are unavailable. */
  ts: string;
  /** Normalized level; "" when no level could be detected. */
  level: "" | "DEBUG" | "INFO" | "WARN" | "ERROR";
  msg: string;
  /** Source container — set only when streaming all containers. */
  container?: string;
}

/** Identifies a specific object for YAML / events / log commands. */
export interface ResourceRef {
  kind: ResourceKind | string;
  namespace?: string;
  name: string;
}

/** Options for starting a log stream. */
export interface LogOptions {
  /** Resume only lines newer than this RFC3339 time (used on un-pause). */
  sinceTime?: string;
  /** Historical lines to seed with on first open. */
  tail?: number;
  /** Only lines from the last N seconds. */
  sinceSeconds?: number;
  /** Read the previous container generation (snapshot, not a stream). */
  previous?: boolean;
}

/** Handle for a running log stream; call `.stop()` to cancel. */
export interface LogHandle {
  stop(): void;
}

/** Handle for a running interactive shell (P4). */
export interface ShellHandle {
  id: string;
  stop(): void;
  /** Send raw bytes (base64-encoded) to the shell's stdin. */
  input(b64: string): Promise<void>;
  /** Resize the remote PTY. */
  resize(cols: number, rows: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Port-forward
// ---------------------------------------------------------------------------

/** An active port-forward. */
export interface ForwardInfo {
  id: string;
  namespace: string;
  pod: string;
  service?: string;
  remotePort: number;
  servicePort?: number;
  localPort: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// DataProvider — the contract
// ---------------------------------------------------------------------------

export type Unsub = () => void;

/**
 * The full data contract. Two implementations: TauriProvider (real)
 * and MockProvider (demo).
 */
export interface DataProvider {
  // ---- one-shot commands ----
  /** List kubeconfig contexts. */
  listContexts(): Promise<ContextInfo[]>;
  /** Connect to a context; starts watchers, returns cluster info. */
  connect(context: string): Promise<ClusterInfo>;
  /** Disconnect; cancels everything tied to the cluster. */
  disconnect(): Promise<void>;
  /** Read YAML for an object. `managedFields` is stripped server-side. */
  getYaml(ref: ResourceRef): Promise<string>;
  /** Rejects with the API error message on failure. */
  applyYaml(ref: ResourceRef, text: string): Promise<void>;
  /** Server-side dry run; returns `current` and `proposed` for diff. */
  dryRunYaml(ref: ResourceRef, text: string): Promise<{ current: string; proposed: string }>;
  /** Events for the object this event is about. */
  getEvents(ref: ResourceRef): Promise<Row[]>;

  // ---- mutations (P3) ----
  deleteResource(ref: ResourceRef): Promise<void>;
  scaleResource(ref: ResourceRef, replicas: number): Promise<void>;
  restartPod(ref: ResourceRef): Promise<void>;
  restartRollout(ref: ResourceRef): Promise<void>;
  setCordon(node: string, unschedulable: boolean): Promise<void>;
  drainNode(node: string): Promise<void>;

  // ---- shell / port-forward (P4) ----
  execPod(
    name: string,
    namespace: string,
    container: string | null,
    command: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }>;
  /** Start an interactive TTY shell on a pod/container. */
  startShell(
    namespace: string,
    pod: string,
    container: string | null,
    onChunk: (b64: string) => void,
    onClosed: (reason: string, status: string) => void,
  ): Promise<ShellHandle>;
  startLogStream(
    ref: ResourceRef,
    container: string | null,
    opts: LogOptions,
    onLine: (line: LogLine) => void,
    onClosed?: (reason: string) => void,
  ): Promise<LogHandle>;
  startPortForward(
    kind: string,
    name: string,
    namespace: string,
    localPort: number,
    remotePort: number,
  ): Promise<ForwardInfo>;
  stopPortForward(id: string): Promise<void>;
  listPortForwards(): Promise<ForwardInfo[]>;

  // ---- event subscriptions (P1/P2) ----
  /** Subscribe to per-kind resource snapshots. */
  onResourceUpdate(cb: (snap: ResourceSnapshot) => void): Unsub;
  /** Subscribe to cluster-status updates (latency, nodes ready, cpu/mem%). */
  onClusterStatus(cb: (status: ClusterStatus) => void): Unsub;
  /** Subscribe to "watch: N streams active" footer count. */
  onWatchStatus(cb: (active: number) => void): Unsub;
}

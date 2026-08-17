/**
 * Kubernetes data types: logs, metrics, properties, shell, port-forwarding, drain.
 *
 * Split from providers/types.ts during the large-file refactor.
 */

import type { Cell, NavTarget } from './table';

/** A single parsed log line. */
export interface LogLine {
  /** "HH:MM:SS.mmm", or "" when timestamps are unavailable. */
  ts: string;
  /** Normalized level; "" when no level could be detected. */
  level: '' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  msg: string;
  /** Source container — set only when streaming all containers (B7). */
  container?: string;
}

/** Per-pod resource usage, keyed by "namespace/name". */
export interface PodMetrics {
  cpuMillis: number;
  memBytes: number;
  /** Epoch milliseconds when this sample was taken. */
  ts: number;
}
export type PodMetricsMap = Record<string, PodMetrics>;

/**
 * One point in a pod's live usage series, accumulated while its Metrics tab is
 * open. Unlike a node's NodeSample (scraped from node-exporter), these come from
 * the same `metrics.k8s.io` feed that drives the pod list — summed across the
 * pod's containers — so a single point is already a real reading, not a rate that
 * needs two scrapes to compute.
 */
export interface PodSample {
  /** Epoch milliseconds — the x axis. */
  ts: number;
  cpuMillis: number;
  memBytes: number;
}

/** Per-node usage percentages, keyed by node name. */
export interface NodeMetrics {
  cpuPercent: number;
  memPercent: number;
  /** Absolute usage from metrics.k8s.io (added so the node Metrics tab can plot
   *  "how much room is left" without node-exporter). */
  cpuMillis: number;
  memBytes: number;
  memTotalBytes: number;
}
export type NodeMetricsMap = Record<string, NodeMetrics>;

/** A label/annotation entry. */
export interface KeyValue {
  key: string;
  value: string;
}

/** A decoded Secret data entry (base64 -> UTF-8). */
export interface SecretEntry {
  key: string;
  value: string;
}

/** Diagnosis for a single container within a Pod. */
export interface ContainerDiagnosis {
  name: string;
  /** "container" or "initContainer". */
  containerType: string;
  ready: boolean;
  restartCount: number;
  /** "running", "waiting", "terminated", or "unknown". */
  currentState: string;
  currentReason?: string;
  currentMessage?: string;
  currentExitCode?: number;
  lastTerminationReason?: string;
  lastTerminationExitCode?: number;
}

/** Overall Pod termination diagnosis. */
export interface PodDiagnosis {
  pod: string;
  namespace: string;
  phase: string;
  containers: ContainerDiagnosis[];
  /** Human-readable one-line summary. */
  summary: string;
  /** "ok", "warn", or "critical". */
  severity: string;
  /** Common pattern if detected (e.g. "oomkilled", "crashloop"). */
  pattern?: string;
}

/** One row of a properties field grid: a label, a toned value, and an optional
 * nav target that makes the value a click-through link (B33). */
export interface Field {
  label: string;
  value: Cell;
  nav?: NavTarget;
}

/**
 * What a properties section renders as (B18). Discriminated by `type`, matching
 * the backend's tagged enum.
 */
export type SectionBody =
  | { type: 'fields'; fields: Field[] }
  | { type: 'table'; columns: string[]; rows: Cell[][] }
  | { type: 'chips'; chips: KeyValue[] };

/** One section of the Properties tab. */
export interface Section {
  title: string;
  /** Rendered in place of an empty table ("no taints"). */
  emptyNote?: string;
  body: SectionBody;
}

/**
 * Everything the Properties tab renders, for any kind (B13, B18).
 *
 * The backend decides both the content *and* the shape: sections are a generic
 * grid/table/chips document, so a new kind is a backend gatherer and no frontend
 * change. See src-tauri/src/kube/properties.rs.
 */
export interface Properties {
  sections: Section[];
}

/**
 * What a proposed YAML edit would actually do, as the server sees it (B36).
 * `proposed` is the object that *would* be stored — after defaulting and any
 * mutating webhooks — so it can differ from the text that was typed.
 */
export interface YamlDiff {
  current: string;
  proposed: string;
}

/**
 * One container's image in a workload pod template. Mirrors the Rust
 * `rollout::ContainerImage` DTO. `init` distinguishes initContainers so the
 * Revisions tab can badge them apart from the main containers.
 */
export interface ContainerImage {
  name: string;
  image: string;
  init: boolean;
}

/**
 * One row of a workload's revision history (Revisions detail tab). Mirrors the
 * Rust `rollout::Revision` DTO. Works for both history storage shapes —
 * Deployment ReplicaSets and StatefulSet/DaemonSet ControllerRevisions — so the
 * frontend renders a single table regardless of kind.
 */
export interface Revision {
  /** The numeric revision, or null when neither annotation nor name yields one. */
  revision: number | null;
  /** Each container's name:image from this revision's pod template, in order. */
  images: ContainerImage[];
  /** The replica count this revision was declared with (0 for STS/DS history). */
  desired: number;
  /** How many replicas of this revision are currently ready. */
  ready: number;
  /** RFC3339 creation timestamp, for the AGE column. */
  age: string;
  /** True for the revision the workload is currently rolling out. */
  isCurrent: boolean;
}

/** Options for starting a log stream. */
export interface LogOptions {
  /** Resume streaming only lines newer than this RFC3339 time (used on un-pause). */
  sinceTime?: string;
  /** Number of historical lines to seed with on first open. */
  tail?: number;
  /**
   * Only lines from the last N seconds (B29). Ignored when `sinceTime` is set —
   * the API rejects both, and the resume anchor is the more precise of the two.
   */
  sinceSeconds?: number;
  /**
   * Read the previous container generation (B29). A snapshot, not a stream: the
   * previous container is dead, so the read ends rather than following.
   */
  previous?: boolean;
}

/** Result of saving a log to disk (B29). */
export interface SavedLog {
  path: string;
  lines: number;
}

/** Handle for a running log stream; call {@link stop} to cancel it. */
export interface LogHandle {
  stop(): void;
}

/** Handle for an interactive shell session (B4). */
export interface ShellHandle {
  /** Send keystrokes to the container. */
  input(data: string): void;
  /** Notify the container of a terminal resize. */
  resize(cols: number, rows: number): void;
  /** End the session. */
  stop(): void;
}

/**
 * A node debug shell session (B53) — a {@link ShellHandle} that also names the pod
 * backing it.
 *
 * The pod name is surfaced deliberately: this feature creates a *privileged* pod on
 * the node, and the UI shows exactly which one, so it is never something the app
 * did invisibly. If teardown ever fails, that name is what the user needs.
 */
export interface NodeShellHandle extends ShellHandle {
  readonly namespace: string;
  readonly pod: string;
}

/** An active port-forward (B6). */
export interface ForwardInfo {
  id: string;
  namespace: string;
  /** The pod traffic reaches — for a Service forward, the one selected (B16). */
  pod: string;
  /** Set for Service forwards: the service name, which is what the strip shows. */
  service?: string;
  /** Port on the pod (a Service forward's resolved targetPort). */
  remotePort: number;
  /**
   * For Service forwards, the port the user actually asked for — the Service's
   * own port — when it differs from the resolved targetPort (B16). The strip
   * shows this: `remotePort` is a container port the Service doesn't publish.
   */
  servicePort?: number;
  localPort: number;
  /** Last per-connection failure; the forward stays up (B16). */
  error?: string;
}

/** A pod a drain could not evict (B20). */
export interface DrainFailure {
  pod: string;
  message: string;
  /** True when a PodDisruptionBudget held it back (429), not a real error. */
  blockedByPdb: boolean;
}

/** Progress of a node drain (B20). */
export interface DrainProgress {
  node: string;
  evicted: number;
  /** Pods eligible for eviction (excludes DaemonSet/mirror/finished pods). */
  total: number;
  failures: DrainFailure[];
  /** False while working; true once every pod has been attempted. */
  done: boolean;
}

/** One mounted filesystem on a node (B27). */
export interface Filesystem {
  mountpoint: string;
  usedBytes: number;
  sizeBytes: number;
}

/**
 * One node-exporter sample, rates already computed by the backend (B27).
 * The frontend only plots these.
 */
export interface NodeSample {
  /** Epoch milliseconds — the x axis. */
  ts: number;
  /** Busy CPU across all cores, 0–100. */
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  /** Bytes/second over physical interfaces. */
  netRxBps: number;
  netTxBps: number;
  load1: number;
  load5: number;
  load15: number;
  /** Slow-moving, so shown as a current bar chart rather than a series. */
  filesystems: Filesystem[];
}

/** Why a node has no plots (B27). */
export interface NodeStatsError {
  node: string;
  message: string;
}

/** A policy that matched during network simulation. */
export interface MatchedPolicy {
  name: string;
  namespace: string;
  /** "ingress" or "egress". */
  direction: string;
  /** "allows" or "denies". */
  effect: string;
}

/** Result of a network policy connectivity simulation. */
export interface SimulationResult {
  allowed: boolean;
  ingressAllowed: boolean;
  egressAllowed: boolean;
  ingressReason: string;
  egressReason: string;
  matchingPolicies: MatchedPolicy[];
}

/** Unsubscribe function returned by the `on*` event subscriptions. */
export type Unsub = () => void;

/** A node in a resource dependency graph. */
export interface GraphNode {
  kind: string;
  name: string;
  namespace?: string;
}

/** An edge in a resource dependency graph. */
export interface GraphEdge {
  from: GraphNode;
  to: GraphNode;
  relation: string;
}

/** A resource dependency graph: nodes and edges representing Kubernetes resource relationships. */
export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** One hop in an Ingress routing chain. */
export interface RouteHop {
  kind: string;
  name: string;
  namespace: string;
  /** "ok", "warning", or "error". */
  status: string;
  detail: string;
}

/** A single Ingress rule path with its full routing chain. */
export interface IngressRoute {
  host: string;
  path: string;
  pathType: string;
  hops: RouteHop[];
  /** Worst status across all hops. */
  overallStatus: string;
}

/** Full debug result for an Ingress resource. */
export interface IngressDebugResult {
  ingress: string;
  namespace: string;
  ingressClass?: string;
  tls: boolean;
  routes: IngressRoute[];
}

/**
 * A point-in-time snapshot of a ConfigMap or Secret's data.
 *
 * Since Kubernetes does not store historical versions, the backend captures
 * these into a ring buffer whenever the user views a resource. Users can
 * compare any two snapshots to see what changed.
 */
export interface ConfigSnapshot {
  /** Kubernetes resourceVersion — the cluster's monotonic revision counter. */
  resourceVersion: string;
  /** RFC3339 timestamp when this snapshot was taken. */
  timestamp: string;
  /** Sorted list of data keys at this version. */
  dataKeys: string[];
  /** Serialized YAML of the resource (secrets are redacted). */
  yaml: string;
}

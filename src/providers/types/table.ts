/**
 * Table display types: rows, cells, tones, and pod metadata.
 *
 * Split from providers/types.ts during the large-file refactor.
 */

import type { KindId } from './resource';

/**
 * The one coloring channel exposed by providers. The backend decides semantics
 * (e.g. CrashLoopBackOff → "err"); the table maps tone → a token color. This keeps
 * status semantics in a single place rather than scattered through the UI.
 *
 * Color mapping (see components/table): primary → --text-primary (names),
 * secondary → --text-secondary (metrics/data), muted → --text-muted
 * (namespace/age), ok/warn/err → the semantic status colors.
 */
export type Tone = 'primary' | 'secondary' | 'muted' | 'ok' | 'warn' | 'err';

/**
 * A navigable target: a nav id plus the object's namespace/name (B33). Carried by
 * a properties {@link Field} and by any {@link Cell} that names another object.
 */
export interface NavTarget {
  /** Nav id — a built-in plural ("deployments") or a CRD "group/plural". */
  kind: KindId;
  namespace?: string;
  name: string;
}

/** A single table cell. */
export interface Cell {
  /** Display text. When `format === "age"`, this is an RFC3339 timestamp instead. */
  text: string;
  /** Color bucket (see {@link Tone}). */
  tone: Tone;
  /** If true, render a leading "\u25cf " status dot in the tone color. */
  dot?: boolean;
  /**
   * When "age", the UI formats `text` (an ISO timestamp) into a k8s-style age
   * ("4d2h") and re-renders it on a periodic tick instead of showing it literally.
   */
  format?: 'age';
  /**
   * Optional numeric sort key for columns whose display text can't be compared
   * directly (CPU/MEM, where "3.2Gi" and "486Mi" don't order lexically). Most
   * columns are sorted by an auto-detected heuristic (see lib/sort.ts); this
   * overrides it when set.
   */
  sort?: number;
  /**
   * When set, this cell names another object and renders as a click-through link
   * in the Properties tables (B40). List tables ignore it — clicking the row is
   * already the navigation there.
   */
  nav?: NavTarget;
}

/**
 * A pod's total CPU/memory requests and limits, summed across its regular
 * containers (init excluded) to match the usage the metrics feed reports. Units
 * are millicores (CPU) and bytes (memory). `null` means unset — and for a limit,
 * that a container is uncapped, so the Metrics tab draws no ceiling line.
 */
export interface PodResources {
  cpuRequestMillis: number | null;
  cpuLimitMillis: number | null;
  memRequestBytes: number | null;
  memLimitBytes: number | null;
}

/** Extra fields carried only by pod rows, used to drive the detail panel. */
export interface PodMeta {
  node: string;
  containers: string[];
  status: string;
  ready: string;
  restarts: number;
  /** RFC3339 creation timestamp, formatted into an age in the detail header. */
  creationTs: string;
  /** Tone for the status word / header dot. */
  statusTone: Tone;
  /** Aggregate requests/limits, for the Metrics tab's overlay lines. */
  resources: PodResources;
}

/** The object an Event is about, for click-through navigation (B33). */
export interface InvolvedRef {
  /** Kubernetes Kind, e.g. "Pod", "Deployment", "Application". */
  kind: string;
  name: string;
  namespace?: string;
  /** apiVersion, e.g. "argoproj.io/v1alpha1"; its group disambiguates CRDs. */
  apiVersion?: string;
}

/** One row in a resource table. */
export interface Row {
  /** Stable identity for React keys and selection (k8s uid, or a synthetic id). */
  uid: string;
  name: string;
  /** Undefined for cluster-scoped kinds (Nodes, Namespaces). */
  namespace?: string;
  /** Cells in the same order as the kind's columns (see lib/kinds.ts). */
  cells: Cell[];
  /** Present only for pods. */
  pod?: PodMeta;
  /** Labels, for label-selector filtering (B33). Present on pods. */
  labels?: Record<string, string>;
  /** A workload's pod selector (matchLabels), for the "view pods" jump (B33). */
  selector?: Record<string, string>;
  /** Present only on Event rows: the object the event is about (B33). */
  involved?: InvolvedRef;
}

/** A Kubernetes Event as shown in the detail panel's Events tab. */
export interface EventItem {
  type: 'Normal' | 'Warning';
  reason: string;
  message: string;
  count: number;
  /** Pre-formatted age string (e.g. "2m"). */
  age: string;
  /** Last-seen timestamp (RFC3339), used by the EventsTab time-range filter. */
  lastTimestamp?: string;
}

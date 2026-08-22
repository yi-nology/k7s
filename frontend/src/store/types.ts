/**
 * Type definitions for the application store.
 */

import type {
  ClusterStatus,
  ContextInfo,
  CustomKind,
  DrainProgress,
  ForwardInfo,
  NodeSample,
  KindId,
  LogLine,
  NavTarget,
  NodeMetricsMap,
  PodMetricsMap,
  PodSample,
  Row,
} from '../providers/types';
import type { SinceOption } from '../lib/logview';
import type { Settings } from '../lib/settings';
import type { SectionId } from '../lib/sections';

/**
 * Intercepted navigation intent while YAML is dirty.
 * When the user tries to navigate away while editing, the intent is stored here
 * and a confirmation dialog is shown. On confirm, the intent is replayed.
 */
export type DetailIntent =
  | { type: 'select'; row: Row }
  | { type: 'tab'; tab: DetailTab }
  | { type: 'closeTab'; uid: string }
  | { type: 'closePanel' }
  | { type: 'jump'; kind: KindId; row?: Row };

/** Detail-panel tab identifiers. */
export type DetailTab =
  | 'logs'
  | 'properties'
  | 'revisions'
  | 'metrics'
  | 'shell'
  | 'yaml'
  | 'events'
  | 'pods'
  | 'timeline'
  | 'diff';

/**
 * Multi-tab entry: one open resource in the detail panel's tab strip.
 * The `activeTab` is the sub-tab (logs, yaml, etc.) the user was viewing.
 */
export interface DetailTab2 {
  uid: string;
  kind: KindId;
  row: Row;
  activeTab: DetailTab;
}

/** Which dropdown menu (if any) is currently open — only one at a time. */
export type OpenMenu = 'cluster' | 'ns' | 'lang' | null;

/** Which feature overlay is open above the resource table. */
export type OverlayKey =
  | 'helm-market'
  | 'pod-files'
  | 'image-repos'
  | 'image-transfer'
  | 'templates'
  | 'dashboard'
  | 'metrics'
  | 'grafana'
  | 'endpoints'
  | 'topology'
  | 'ingress-routes'
  | 'alerting'
  | 'audit'
  | 'ingress-editor'
  | 'diff'
  | 'plugins'
  | 'sbom'
  | 'wizard';

/** Connection lifecycle for the active cluster/context. */
export interface ConnectionState {
  phase: 'idle' | 'connecting' | 'connected' | 'error';
  /** kubeconfig context name currently selected. */
  context: string | null;
  /** Cluster display name (from connect result). */
  clusterName: string | null;
  /** Error message when phase === "error". */
  error?: string;
}

/**
 * Rows keyed by kind id.
 */
export type RowMap = Record<string, Row[]>;

/**
 * Points kept per node's metric series (B27).
 */
export const NODE_SAMPLE_CAP = 240;

/** Points kept per pod's series. */
export const POD_SAMPLE_CAP = 240;

/**
 * Ring-buffer cap for the log view.
 */
export const LOG_BUFFER_CAP_DEFAULT = 200;

/** Selection state for multi-row selection. */
export interface SelectionState {
  selected: string[];
  anchor: string | null;
}

/** Rows for a kind, or an empty array for a custom kind not yet watched. */
export const EMPTY_ROWS: Row[] = [];

export function rowsFor(rows: RowMap, kind: KindId): Row[] {
  return rows[kind] ?? EMPTY_ROWS;
}

/**
 * Derive a `{ kind → count }` map from the full rows map. For components that
 * only need per-kind counts (nav badges, dashboard tiles) this lets the
 * selector return a stable shallow-equal object instead of re-rendering on
 * every row mutation across all kinds. Pair with `useShallow`.
 */
export function selectKindCounts(rows: RowMap): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [kind, list] of Object.entries(rows)) {
    counts[kind] = list.length;
  }
  return counts;
}

/**
 * Full application state interface.
 * This combines all the state from different slices.
 */
export interface AppState {
  // connection & cluster
  connection: ConnectionState;
  clusterStatus: ClusterStatus | null;
  watchCount: number;
  contexts: ContextInfo[];
  importedFiles: string[];
  hotbar: string[];

  // navigation & filtering
  nav: KindId;
  /** Active top-level section of the 5-section IA (P1). Derived on setNav. */
  section: SectionId;
  namespace: string;
  tableFilter: string;
  sortCol: number | null;
  sortDir: 'asc' | 'desc';
  openMenu: OpenMenu;

  // overlays
  overlay: OverlayKey | null;
  overlayPodRef: { namespace: string; name: string; container: string | null } | null;

  // live data
  rows: RowMap;
  customKinds: CustomKind[];
  settings: Settings;
  selection: SelectionState;
  systemDark: boolean;
  settingsOpen: boolean;
  /** When settings opens, optionally scroll to a named section (e.g. 'ai').
   *  Cleared after the panel consumes it. null = no requested section. */
  settingsSection: string | null;
  /** Onboarding wizard (kubeconfig import) visibility. Set by the overview
   *  page's no-cluster empty state; the wizard itself renders off this flag. */
  onboardingOpen: boolean;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  podMetrics: PodMetricsMap;
  nodeMetrics: NodeMetricsMap;
  portForwards: ForwardInfo[];
  drains: Record<string, DrainProgress>;
  nodeSamples: Record<string, NodeSample[]>;
  nodeStatsErrors: Record<string, string>;
  watchStatus: Record<string, 'ok' | 'forbidden'>;
  podSamples: Record<string, PodSample[]>;
  /** Per-kind instance counts for custom (CRD) kinds, fetched once on connect.
   *  undefined = counts not yet loaded (provider may not support it). */
  customKindCounts: Record<string, number> | undefined;

  // detail panel
  selectedRow: Row | null;
  activeTab: DetailTab;
  detailTabs: DetailTab2[];
  activeDetailTabUid: string | null;

  // logs
  logSearch: string;
  containerIndex: number;
  showTimestamps: boolean;
  following: boolean;
  logBuffer: LogLine[];
  logPrevious: boolean;
  logSince: SinceOption;
  eventsSince: SinceOption;

  // yaml
  yamlEditing: boolean;
  yamlDraft: string;
  /** Baseline text for dirty detection — set when startYamlEdit is called. */
  yamlBase: string;
  /** Intercepted navigation intent while YAML is dirty. null = no pending intent. */
  pendingDetail: DetailIntent | null;

  // ai
  aiPanelOpen: boolean;
  aiPendingMessage?: string;

  // actions
  setNav: (kind: KindId) => void;
  setSection: (section: SectionId) => void;
  setNamespace: (ns: string) => void;
  setTableFilter: (q: string) => void;
  toggleSort: (col: number) => void;
  toggleMenu: (menu: Exclude<OpenMenu, null>) => void;
  closeMenus: () => void;
  setConnection: (c: Partial<ConnectionState>) => void;
  setContexts: (contexts: ContextInfo[]) => void;
  setImportedFiles: (paths: string[]) => void;
  addImportedFile: (path: string) => void;
  setHotbar: (items: string[]) => void;
  addHotbarItem: (context: string) => void;
  removeHotbarItem: (context: string) => void;
  setClusterStatus: (s: ClusterStatus) => void;
  setWatchCount: (n: number) => void;
  setRows: (kind: KindId, rows: Row[]) => void;
  setCustomKinds: (kinds: CustomKind[]) => void;
  setCustomKindCounts: (counts: Record<string, number>) => void;
  setPodMetrics: (m: PodMetricsMap) => void;
  setNodeMetrics: (m: NodeMetricsMap) => void;
  setPortForwards: (list: ForwardInfo[]) => void;
  setDrain: (progress: DrainProgress) => void;
  seedNodeSamples: (node: string, history: NodeSample[]) => void;
  addNodeSample: (node: string, sample: NodeSample) => void;
  setNodeStatsError: (node: string, message: string) => void;
  addPodSample: (key: string, sample: PodSample) => void;
  setWatchStatus: (kind: string, status: 'ok' | 'forbidden') => void;
  setSettings: (patch: Partial<Settings>) => void;
  setSystemDark: (dark: boolean) => void;
  setSelection: (selection: SelectionState) => void;
  clearSelection: () => void;
  /** Open (or close) the settings modal. `section` optionally requests the
   *  panel scroll to / highlight a named block (currently 'ai' or 'advanced')
   *  — used by the "enable AI" affordances to drop the user right at the config. */
  setSettingsOpen: (open: boolean, section?: string) => void;
  setOnboardingOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  jumpTo: (kind: KindId, row?: Row) => void;
  navigateTo: (target: NavTarget) => void;
  viewPods: (namespace: string | undefined, selector: string) => void;
  resetData: () => void;
  selectRow: (row: Row) => void;
  closeDetail: () => void;
  setActiveTab: (tab: DetailTab) => void;
  openDetailTab: (kind: KindId, row: Row) => void;
  closeDetailTab: (uid: string) => void;
  /** Prune multi-tabs whose resource was deleted from live watcher data. */
  pruneDetailTabs: (kind: KindId, rows: Row[]) => void;
  setActiveDetailTab: (uid: string) => void;
  cycleDetailTab: (direction: 1 | -1) => void;
  openSelectedInTab: () => void;
  setLogSearch: (q: string) => void;
  cycleContainer: () => void;
  toggleTimestamps: () => void;
  toggleFollow: () => void;
  setFollowing: (value: boolean) => void;
  setLogPrevious: (value: boolean) => void;
  setLogSince: (value: SinceOption) => void;
  setEventsSince: (value: SinceOption) => void;
  appendLogs: (lines: LogLine[]) => void;
  clearLogs: () => void;
  startYamlEdit: (initial: string) => void;
  cancelYaml: () => void;
  setYamlDraft: (text: string) => void;
  confirmPendingDetail: () => void;
  cancelPendingDetail: () => void;
  openOverlay: (
    key: OverlayKey,
    podRef?: { namespace: string; name: string; container: string | null } | null
  ) => void;
  closeOverlay: () => void;
  setAiPanelOpen: (open: boolean) => void;
  setAiPendingMessage: (msg: string | undefined) => void;
}

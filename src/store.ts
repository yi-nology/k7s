/**
 * Central application store (Zustand). Holds exactly the state enumerated in the
 * design handoff's "State Management" section plus the live data streamed in from
 * the provider. UI components subscribe to slices of this; provider event handlers
 * (wired in app bootstrap) call the setters.
 */

import { create } from "zustand";
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
} from "./providers/types";
import { KIND_ORDER } from "./lib/kinds";
import { DEFAULT_SETTINGS, type Settings } from "./lib/settings";
import { cachedTheme, prefersDark } from "./lib/theme";
import { cachedLocale } from "./lib/i18n";
import { EMPTY_SELECTION, type SelectionState } from "./lib/selection";
import type { SinceOption } from "./lib/logview";

/**
 * Ring-buffer cap for the log view (the design default, and the starting value
 * of the user-editable setting — see lib/settings.ts).
 */
export const LOG_BUFFER_CAP = DEFAULT_SETTINGS.logBufferCap;

/** Detail-panel tab identifiers. */
export type DetailTab =
  | "logs"
  | "properties"
  | "revisions"
  | "metrics"
  | "shell"
  | "yaml"
  | "events"
  | "pods"
  | "timeline";

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
export type OpenMenu = "cluster" | "ns" | "lang" | null;

/** Which feature overlay is open above the resource table. Each value maps
 * to one of the feature panels added in the KubePi-parity phases:
 *  - Tier 1 (Phase 1/2/4/5): helm-market, pod-files, image-repos, templates
 *  - Tier 2 (Dashboard, Metrics, Grafana, Endpoints, Topology, Alerting)
 * `null` means the regular resource table is showing. */
export type OverlayKey =
  | "helm-market"
  | "pod-files"
  | "image-repos"
  | "image-import"
  | "templates"
  | "dashboard"
  | "metrics"
  | "grafana"
  | "endpoints"
  | "topology"
  | "ingress-routes"
  | "alerting"
  | "audit"
  | "ingress-editor"
  | "diff"
  | "plugins";

/** Connection lifecycle for the active cluster/context. */
export interface ConnectionState {
  phase: "idle" | "connecting" | "connected" | "error";
  /** kubeconfig context name currently selected. */
  context: string | null;
  /** Cluster display name (from connect result). */
  clusterName: string | null;
  /** Error message when phase === "error". */
  error?: string;
}

/**
 * Rows keyed by kind id. Not a `Record<ResourceKind, …>`: custom (CRD-backed)
 * kind ids aren't known at build time, and their entries only appear once the
 * kind is watched — so readers must tolerate a missing key (see {@link rowsFor}).
 */
export type RowMap = Record<string, Row[]>;

/** Empty row map: every built-in kind present with an empty array. */
function emptyRows(): RowMap {
  return Object.fromEntries(KIND_ORDER.map((k) => [k, [] as Row[]]));
}

/** Rows for a kind, or an empty array for a custom kind not yet watched (B15). */
export function rowsFor(rows: RowMap, kind: KindId): Row[] {
  return rows[kind] ?? EMPTY_ROWS;
}

/** Shared empty array so `rowsFor` returns a stable reference (avoids re-renders). */
const EMPTY_ROWS: Row[] = [];

/**
 * Points kept per node's metric series (B27). At the default 15s poll that's an
 * hour of history; the series is live-only anyway, so this only bounds memory for
 * a tab left open all day.
 */
export const NODE_SAMPLE_CAP = 240;

/** Points kept per pod's series — same reasoning and cadence as NODE_SAMPLE_CAP. */
export const POD_SAMPLE_CAP = 240;

/**
 * The state change that *is* selecting a row: open the panel on a sensible tab
 * and reset the per-object view state. Shared by selectRow and jumpTo (B28) so
 * arriving via the palette and via a click are the same thing.
 */
function selectionPatch(row: Row) {
  return {
    selectedRow: row,
    // A plain click is a single-row selection (B39): opening the detail panel for
    // one object and leaving a stale multi-selection behind would mean the row
    // menu acts on rows the panel isn't showing.
    selection: { selected: [row.uid], anchor: row.uid } as SelectionState,
    // Pods open on Logs; every other kind lacks that tab, so YAML is the default.
    activeTab: (row.pod ? "logs" : "yaml") as DetailTab,
    // Closing the edit session also drops the draft. Otherwise it lives in the
    // store as dead state: the editor is now read-only, the user can't see it,
    // and the next Edit click on any row overwrites it with the fresh fetch —
    // silently discarding every keystroke they typed.
    yamlEditing: false,
    yamlDraft: "",
    logBuffer: [] as LogLine[],
    logSearch: "",
    containerIndex: 0,
    following: true,
    // A different pod is a different question: "previous" and a narrow window
    // are answers about the pod you were just looking at, and silently carrying
    // them over would show the next pod's logs through a filter you'd forgotten
    // you set.
    logPrevious: false,
    logSince: "all" as SinceOption,
    // NOTE: eventsSince is intentionally NOT reset here. It is a cluster-wide
    // filter shared by the Events table and the EventsTab — clicking a pod
    // should not clear the user's time-range filter on the cluster events view.
    // It is only reset in resetData() on disconnect.
  };
}

/**
 * The patch for going to a kind, optionally selecting a row (B28, B33). Shared by
 * `jumpTo` and `navigateTo` so palette jumps, owner links, and event click-through
 * all behave identically. Resets filter/sort/menus and closes the palette; with a
 * row, moves the namespace filter only when it would otherwise hide the row.
 */
function jumpPatch(current: { namespace: string }, kind: KindId, row?: Row) {
  const base = {
    nav: kind,
    openMenu: null,
    tableFilter: "",
    sortCol: null,
    sortDir: "asc" as const,
    paletteOpen: false,
  };
  if (!row) return { ...base, selectedRow: null, selection: EMPTY_SELECTION };

  // A namespace filter that would hide the row moves to the row's own namespace.
  // Jumping somewhere and landing on an empty table because of a filter set ten
  // minutes ago is worse than the filter changing under you.
  const namespace =
    row.namespace && current.namespace !== "all" && current.namespace !== row.namespace
      ? row.namespace
      : current.namespace;

  return { ...base, namespace, ...selectionPatch(row) };
}

/** A copy of `obj` without `key`. */
function omit<T>(obj: Record<string, T>, key: string): Record<string, T> {
  if (!(key in obj)) return obj;
  const next = { ...obj };
  delete next[key];
  return next;
}

export interface AppState {
  // ---------- connection & cluster ----------
  connection: ConnectionState;
  clusterStatus: ClusterStatus | null;
  watchCount: number;
  /** Available kubeconfig contexts (cluster switcher entries). */
  contexts: ContextInfo[];
  /**
   * Kubeconfig files imported by the user (B17). Persisted via prefs and
   * re-imported on boot, so imported contexts survive a relaunch.
   */
  importedFiles: string[];
  /** Pinned context names for the sidebar hotbar (max 8). */
  hotbar: string[];

  // ---------- navigation & filtering ----------
  /** Active resource kind (drives the table + breadcrumb); a custom id for CRDs. */
  nav: KindId;
  /** Namespace filter; "all" shows everything. */
  namespace: string;
  /** Free-text name filter for the current table (cleared on nav change). */
  tableFilter: string;
  /** Column index the table is sorted by, or null for server order. */
  sortCol: number | null;
  /** Sort direction when `sortCol` is set. */
  sortDir: "asc" | "desc";
  /** Which dropdown is open (cluster switcher or ns menu). */
  openMenu: OpenMenu;

  // ---------- overlays (Phase 1/2/4/5 of KubePi parity) ----------
  /**
   * Which feature panel is open as an overlay above the table. `null` means
   * the regular resource table is showing. The overlay covers the content
   * area but leaves the top bar / status bar / sidebar in place so the user
   * can still switch contexts, change namespace, etc.
   */
  overlay: OverlayKey | null;
  /**
   * The pod + container the PodFiles overlay should target. Set when the
   * overlay is opened from a Pod's row context menu. `null` for any other
   * overlay.
   */
  overlayPodRef: { namespace: string; name: string; container: string | null } | null;

  // ---------- live data ----------
  /** Rows per kind. Built-ins always present; custom kinds appear once watched. */
  rows: RowMap;
  /** CRD-backed kinds discovered on connect (B15); empty when disconnected. */
  customKinds: CustomKind[];
  /** User settings (B23). Persisted via prefs; the log cap applies live. */
  settings: Settings;
  /**
   * Multi-row selection for the current kind (B39).
   *
   * Uids, not rows: watch updates replace every Row object, and sorting/filtering
   * moves indices. Cleared wherever `selectedRow` is, since it belongs to the kind
   * and namespace being shown — a selection surviving a nav change would let a
   * bulk action fire at objects from a table you have left.
   */
  selection: SelectionState;
  /**
   * Whether the OS currently wants dark (B52). Not persisted — it's a fact about
   * the machine, read fresh at boot and updated by a media-query listener. It
   * lives in the store rather than in a hook so anything that needs the *resolved*
   * palette (the terminal, the plots) re-renders when the OS flips.
   */
  systemDark: boolean;
  /** Whether the settings panel is open. */
  settingsOpen: boolean;
  /** Whether the command palette is open (B28). */
  paletteOpen: boolean;
  podMetrics: PodMetricsMap;
  nodeMetrics: NodeMetricsMap;
  /** Active port-forwards (B6). */
  portForwards: ForwardInfo[];
  /**
   * Node drains in progress or recently finished, keyed by node name (B20).
   * Kept in the store rather than in the node's panel so progress survives
   * navigating away — a drain takes minutes.
   */
  drains: Record<string, DrainProgress>;
  /**
   * node-exporter samples per node (B27), oldest first. Live-only: the series
   * starts when you open a node's Metrics tab, because the exporter reports
   * counters rather than history — there is nothing to backfill from.
   */
  nodeSamples: Record<string, NodeSample[]>;
  /** Why a node has no samples (no exporter, forward failed), keyed by node. */
  nodeStatsErrors: Record<string, string>;
  /** Per-kind watch status: "forbidden" when a watch returns 403, "ok" otherwise. */
  watchStatus: Record<string, "ok" | "forbidden">;
  /**
   * Per-pod usage samples, keyed "namespace/name", oldest first. Live-only like
   * nodeSamples: the series starts when you open a pod's Metrics tab and fills
   * from the metrics poller — there is no per-pod history to backfill.
   */
  podSamples: Record<string, PodSample[]>;

  // ---------- detail panel ----------
  /** Selected row (null → panel closed). Pods also get a Logs tab. */
  selectedRow: Row | null;
  activeTab: DetailTab;

  // multi-tab system
  /** Open resource tabs in the detail panel (empty = single-panel mode). */
  detailTabs: DetailTab2[];
  /** Uid of the active multi-tab, or null when no multi-tabs are open. */
  activeDetailTabUid: string | null;

  // logs tab
  logSearch: string;
  containerIndex: number;
  showTimestamps: boolean;
  following: boolean;
  logBuffer: LogLine[];
  /**
   * Read the previous container generation instead of the current one (B29) —
   * what a crash-looper printed on its way down.
   */
  logPrevious: boolean;
  /** How far back the read reaches (B29). */
  logSince: SinceOption;
  /** Events time-range filter (Cluster → Events table + EventsTab). */
  eventsSince: SinceOption;

  // yaml tab
  yamlEditing: boolean;
  yamlDraft: string;

  // ---------- actions ----------
  // navigation
  setNav: (kind: KindId) => void;
  setNamespace: (ns: string) => void;
  setTableFilter: (q: string) => void;
  /** Sort by a column: same column toggles direction, a new column starts ascending. */
  toggleSort: (col: number) => void;
  toggleMenu: (menu: Exclude<OpenMenu, null>) => void;
  closeMenus: () => void;

  // connection/data setters (called by provider event handlers)
  setConnection: (c: Partial<ConnectionState>) => void;
  setContexts: (contexts: ContextInfo[]) => void;
  setImportedFiles: (paths: string[]) => void;
  /** Remember an imported kubeconfig path (no-op if already known). */
  addImportedFile: (path: string) => void;
  setHotbar: (items: string[]) => void;
  addHotbarItem: (context: string) => void;
  removeHotbarItem: (context: string) => void;
  setClusterStatus: (s: ClusterStatus) => void;
  setWatchCount: (n: number) => void;
  setRows: (kind: KindId, rows: Row[]) => void;
  setCustomKinds: (kinds: CustomKind[]) => void;
  setPodMetrics: (m: PodMetricsMap) => void;
  setNodeMetrics: (m: NodeMetricsMap) => void;
  setPortForwards: (list: ForwardInfo[]) => void;
  setDrain: (progress: DrainProgress) => void;
  /**
   * Seed a node's series with history from Prometheus (B38). Merged rather than
   * replaced: the live scraper may already have produced points by the time the
   * backfill lands, and those are the fresher reading.
   */
  seedNodeSamples: (node: string, history: NodeSample[]) => void;
  /** Append a sample to a node's series, capped at NODE_SAMPLE_CAP. */
  addNodeSample: (node: string, sample: NodeSample) => void;
  setNodeStatsError: (node: string, message: string) => void;
  /** Append a sample to a pod's series, capped at POD_SAMPLE_CAP. */
  addPodSample: (key: string, sample: PodSample) => void;
  setWatchStatus: (kind: string, status: "ok" | "forbidden") => void;
  /** Merge a settings change (already sanitised by the caller). */
  setSettings: (patch: Partial<Settings>) => void;
  /** Record the OS colour-scheme preference (B52). */
  setSystemDark: (dark: boolean) => void;
  /** Replace the multi-row selection (B39). Computed by lib/selection.ts. */
  setSelection: (selection: SelectionState) => void;
  /** Drop the multi-row selection, leaving the detail panel alone. */
  clearSelection: () => void;
  setSettingsOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  /**
   * Go to a kind, optionally selecting a row within it (B28).
   *
   * One atomic update rather than setNav + setNamespace + selectRow: each of
   * those clears the selection on its own, so calling them in sequence lands on
   * the kind with nothing selected. The order that happens to work is exactly
   * the kind of trap this avoids.
   */
  jumpTo: (kind: KindId, row?: Row) => void;
  /**
   * Navigate to an object by (kind, namespace, name) — the owner link and event
   * click-through (B33). Resolves the live row when loaded, else a synthetic one.
   */
  navigateTo: (target: NavTarget) => void;
  /**
   * Go to the Pods table filtered by a workload's selector, scoped to its
   * namespace (B33's workload→pods jump).
   */
  viewPods: (namespace: string | undefined, selector: string) => void;
  resetData: () => void;

  // detail panel
  selectRow: (row: Row) => void;
  closeDetail: () => void;
  setActiveTab: (tab: DetailTab) => void;

  // multi-tab system
  /** Open a resource in a new multi-tab (or activate an existing one). */
  openDetailTab: (kind: KindId, row: Row) => void;
  /** Close a multi-tab by uid. */
  closeDetailTab: (uid: string) => void;
  /** Set the active multi-tab by uid. */
  setActiveDetailTab: (uid: string) => void;
  /** Cycle to the next or previous multi-tab. */
  cycleDetailTab: (direction: 1 | -1) => void;
  /** Open the current selectedRow in a new multi-tab. */
  openSelectedInTab: () => void;

  // logs
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

  // yaml
  startYamlEdit: (initial: string) => void;
  cancelYaml: () => void;
  setYamlDraft: (text: string) => void;

  // ---------- overlays (Phase 1/2/4/5 entry points) ----------
  openOverlay: (
    key: OverlayKey,
    podRef?: { namespace: string; name: string; container: string | null } | null,
  ) => void;
  closeOverlay: () => void;
}

export const useStore = create<AppState>((set) => ({
  // ---------- initial state ----------
  connection: { phase: "idle", context: null, clusterName: null },
  clusterStatus: null,
  watchCount: 0,
  contexts: [],
  importedFiles: [],
  hotbar: [],

  nav: "pods",
  namespace: "all",
  tableFilter: "",
  sortCol: null,
  sortDir: "asc",
  openMenu: null,
  overlay: null,
  overlayPodRef: null,

  rows: emptyRows(),
  customKinds: [],
  // Theme + language come from the paint-time cache rather than the default, so
  // the boot render agrees with what index.html already painted. Prefs overwrite
  // them a moment later; without this the window would flash the default
  // palette/locale in between (B52, i18n).
  settings: { ...DEFAULT_SETTINGS, theme: cachedTheme(), language: cachedLocale() },
  selection: EMPTY_SELECTION,
  systemDark: prefersDark(),
  settingsOpen: false,
  paletteOpen: false,
  podMetrics: {},
  nodeMetrics: {},
  portForwards: [],
  drains: {},
  nodeSamples: {},
  nodeStatsErrors: {},
  podSamples: {},
  watchStatus: {},

  selectedRow: null,
  activeTab: "logs",

  detailTabs: [],
  activeDetailTabUid: null,

  logSearch: "",
  containerIndex: 0,
  showTimestamps: true,
  following: true,
  logBuffer: [],
  logPrevious: false,
  logSince: "all",
  eventsSince: "all",

  yamlEditing: false,
  yamlDraft: "",

  // ---------- navigation ----------
  // Switching kind clears the pod selection, any open menu, the name filter, and
  // the sort (all are scoped to the kind you were viewing).
  setNav: (kind) =>
    set({
      nav: kind,
      selectedRow: null,
      selection: EMPTY_SELECTION,
      openMenu: null,
      tableFilter: "",
      sortCol: null,
      sortDir: "asc",
    }),
  // Changing namespace also clears selection (a pod may no longer be visible).
  setNamespace: (ns) =>
    set({ namespace: ns, openMenu: null, selectedRow: null, selection: EMPTY_SELECTION }),
  setTableFilter: (q) => set({ tableFilter: q }),
  toggleSort: (col) =>
    set((s) =>
      s.sortCol === col
        ? { sortDir: s.sortDir === "asc" ? "desc" : "asc" }
        : { sortCol: col, sortDir: "asc" },
    ),
  // Toggle a menu; opening one closes the other (only one open at a time).
  toggleMenu: (menu) => set((s) => ({ openMenu: s.openMenu === menu ? null : menu })),
  closeMenus: () => set({ openMenu: null }),

  // ---------- overlays ----------
  // Opening an overlay also closes any open menu so the chrome doesn't
  // compete for attention. The podFiles overlay accepts a `podRef` so the
  // shell can deep-link to a specific pod's filesystem; the other three
  // ignore it.
  openOverlay: (key, podRef) =>
    set({ overlay: key, overlayPodRef: podRef ?? null, openMenu: null }),
  closeOverlay: () => set({ overlay: null, overlayPodRef: null }),

  // ---------- connection/data setters ----------
  setConnection: (c) => set((s) => ({ connection: { ...s.connection, ...c } })),
  setContexts: (contexts) => set({ contexts }),
  setImportedFiles: (paths) => set({ importedFiles: paths }),
  addImportedFile: (path) =>
    set((s) =>
      s.importedFiles.includes(path) ? s : { importedFiles: [...s.importedFiles, path] },
    ),
  setHotbar: (items) => set({ hotbar: items }),
  addHotbarItem: (context) =>
    set((s) => {
      if (s.hotbar.includes(context) || s.hotbar.length >= 8) return s;
      return { hotbar: [...s.hotbar, context] };
    }),
  removeHotbarItem: (context) =>
    set((s) => ({ hotbar: s.hotbar.filter((c) => c !== context) })),
  setClusterStatus: (status) => set({ clusterStatus: status }),
  setWatchCount: (n) => set({ watchCount: n }),
  setRows: (kind, rows) =>
    set((s) => {
      const nextRows = { ...s.rows, [kind]: rows };
      // Clean up multi-tabs whose resource was deleted externally.
      let nextTabs = s.detailTabs;
      if (s.detailTabs.length > 0 && rows.length > 0) {
        const filtered = s.detailTabs.filter(
          (t) => t.kind !== kind || rows.some((r) => r.uid === t.row.uid),
        );
        if (filtered.length !== s.detailTabs.length) nextTabs = filtered;
      }
      return {
        rows: nextRows,
        ...(nextTabs !== s.detailTabs
          ? {
              detailTabs: nextTabs,
              activeDetailTabUid:
                nextTabs.length === 0
                  ? null
                  : nextTabs.some((t) => t.uid === s.activeDetailTabUid)
                    ? s.activeDetailTabUid
                    : nextTabs[0].uid,
            }
          : {}),
      };
    }),
  setCustomKinds: (kinds) => set({ customKinds: kinds }),
  setPodMetrics: (m) => set({ podMetrics: m }),
  setNodeMetrics: (m) => set({ nodeMetrics: m }),
  setPortForwards: (list) => set({ portForwards: list }),
  setDrain: (p) => set((s) => ({ drains: { ...s.drains, [p.node]: p } })),
  seedNodeSamples: (node, history) =>
    set((s) => {
      if (history.length === 0) return {};
      const live = s.nodeSamples[node] ?? [];
      // Keep only history strictly older than the oldest live point. The live
      // scrape and the backfill can overlap in time, and the live reading is the
      // more accurate of the two — it's measured, not re-derived from a rate over
      // a wider window.
      const oldestLive = live.length ? live[0].ts : Infinity;
      const merged = history.filter((h) => h.ts < oldestLive).concat(live);
      return {
        nodeSamples: {
          ...s.nodeSamples,
          [node]: merged.length > NODE_SAMPLE_CAP ? merged.slice(-NODE_SAMPLE_CAP) : merged,
        },
      };
    }),
  addNodeSample: (node, sample) =>
    set((s) => {
      const next = (s.nodeSamples[node] ?? []).concat(sample);
      return {
        nodeSamples: {
          ...s.nodeSamples,
          [node]: next.length > NODE_SAMPLE_CAP ? next.slice(-NODE_SAMPLE_CAP) : next,
        },
        // A sample arriving means whatever was wrong isn't any more.
        nodeStatsErrors: omit(s.nodeStatsErrors, node),
      };
    }),
  setNodeStatsError: (node, message) =>
    set((s) => ({ nodeStatsErrors: { ...s.nodeStatsErrors, [node]: message } })),
  addPodSample: (key, sample) =>
    set((s) => {
      const next = (s.podSamples[key] ?? []).concat(sample);
      return {
        podSamples: {
          ...s.podSamples,
          [key]: next.length > POD_SAMPLE_CAP ? next.slice(-POD_SAMPLE_CAP) : next,
        },
      };
    }),
  setWatchStatus: (kind, status) =>
    set((s) => ({ watchStatus: { ...s.watchStatus, [kind]: status } })),
  setSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      // Shrinking the cap has to bite immediately, not at the next log line —
      // that's the difference between a setting and a promise (B23).
      const logBuffer =
        s.logBuffer.length > settings.logBufferCap
          ? s.logBuffer.slice(-settings.logBufferCap)
          : s.logBuffer;
      return { settings, logBuffer };
    }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSystemDark: (dark) => set({ systemDark: dark }),
  setSelection: (selection) => set({ selection }),
  clearSelection: () => set({ selection: EMPTY_SELECTION }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  jumpTo: (kind, row) => set((s) => jumpPatch(s, kind, row)),
  navigateTo: (target) =>
    set((s) => {
      // Prefer the live row so the table highlights and the panel shows real
      // cells; fall back to a synthetic row when the target's kind isn't loaded
      // (e.g. a not-yet-watched CRD). The detail panel fetches YAML/properties by
      // ref either way, so a synthetic row still opens a working panel.
      const found = rowsFor(s.rows, target.kind).find(
        (r) => r.name === target.name && (!target.namespace || r.namespace === target.namespace),
      );
      const row =
        found ?? {
          uid: `${target.namespace ?? ""}/${target.name}`,
          name: target.name,
          namespace: target.namespace,
          cells: [],
        };
      return jumpPatch(s, target.kind, row);
    }),
  viewPods: (namespace, selector) =>
    set((s) => ({
      nav: "pods",
      openMenu: null,
      sortCol: null,
      sortDir: "asc",
      paletteOpen: false,
      selectedRow: null,
      selection: EMPTY_SELECTION,
      // Scope to the workload's namespace so only its pods show, and drop the
      // selector into the filter box as editable, removable text.
      namespace: namespace || s.namespace,
      tableFilter: selector,
    })),
  // Wipe all live data on disconnect/context-switch (Story 6.1). The backend also
  // aborts every forward/shell on reset, so we clear the local list here too.
  resetData: () =>
    set({
      rows: emptyRows(),
      // The discovered CRDs belong to the old cluster; connect re-discovers them.
      // `nav` is deliberately left alone: on a reconnect to the same cluster the
      // kind comes straight back, and a nav pointing at a kind this cluster lacks
      // renders an empty table rather than yanking the user elsewhere.
      customKinds: [],
      podMetrics: {},
      nodeMetrics: {},
      portForwards: [],
      // Drains belong to the old connection; the backend aborts them on reset.
      drains: {},
      // As do node samples — a different cluster's nodes are different machines,
      // and the backend has dropped their scrapers (B27).
      nodeSamples: {},
      nodeStatsErrors: {},
      // Pod samples belong to the old connection too — a reconnect starts fresh.
      podSamples: {},
      // Per-kind RBAC status belongs to the old connection.
      watchStatus: {},
      selectedRow: null,
      selection: EMPTY_SELECTION,
      logBuffer: [],
      clusterStatus: null,
      openMenu: null,
      detailTabs: [],
      activeDetailTabUid: null,
    }),

  // ---------- detail panel ----------
  // Selecting a row opens the panel and resets log/yaml view state. Pods open on
  // the Logs tab; other kinds have no Logs tab, so they open on YAML.
  // (The logs component re-seeds the stream in response to a pod selection.)
  selectRow: (row) => set(selectionPatch(row)),
  // Close the detail panel and clean up view state. Safe because DetailPanel
  // returns null when selectedRow is null — all tab components are already
  // unmounted, so no active hooks depend on this state.
  closeDetail: () =>
    set((s) => {
      // If a multi-tab is active, close it instead of the single-panel.
      if (s.activeDetailTabUid) {
        const next = s.detailTabs.filter((t) => t.uid !== s.activeDetailTabUid);
        if (next.length === 0) {
          return {
            detailTabs: [],
            activeDetailTabUid: null,
            selectedRow: null,
            logBuffer: [],
            logSearch: "",
            containerIndex: 0,
            following: true,
            logPrevious: false,
            logSince: "all",
            yamlEditing: false,
            yamlDraft: "",
          };
        }
        const newActive = next[Math.min(
          s.detailTabs.findIndex((t) => t.uid === s.activeDetailTabUid),
          next.length - 1,
        )];
        return {
          detailTabs: next,
          activeDetailTabUid: newActive.uid,
          nav: newActive.kind,
          selectedRow: newActive.row,
          activeTab: newActive.activeTab,
          yamlEditing: false,
          yamlDraft: "",
          logBuffer: [],
          logSearch: "",
          containerIndex: 0,
          following: true,
          logPrevious: false,
          logSince: "all",
        };
      }
      return {
        selectedRow: null,
        logBuffer: [],
        logSearch: "",
        containerIndex: 0,
        following: true,
        logPrevious: false,
        logSince: "all",
        yamlEditing: false,
        yamlDraft: "",
      };
    }),
  // Switching tabs cancels any in-progress YAML edit (design behavior) and
  // also drops the draft — see selectionPatch for why carrying it forward is
  // worse than discarding it.
  setActiveTab: (tab) =>
    set((s) => {
      // Sync the active multi-tab's sub-tab so switching back restores it.
      let detailTabs = s.detailTabs;
      if (s.activeDetailTabUid) {
        detailTabs = s.detailTabs.map((t) =>
          t.uid === s.activeDetailTabUid ? { ...t, activeTab: tab } : t,
        );
      }
      return { activeTab: tab, yamlEditing: false, yamlDraft: "", detailTabs };
    }),

  // ---------- multi-tab system ----------
  // Opening a multi-tab: reuse if the resource is already open, else create.
  // Hides the single-panel view; the tab strip + active tab drive the detail.
  openDetailTab: (kind, row) =>
    set((s) => {
      const existing = s.detailTabs.find((t) => t.row.uid === row.uid);
      if (existing) return { activeDetailTabUid: existing.uid, selectedRow: null };
      const uid = crypto.randomUUID();
      const activeTab: DetailTab = row.pod ? "logs" : "yaml";
      return {
        detailTabs: [...s.detailTabs, { uid, kind, row, activeTab }],
        activeDetailTabUid: uid,
        selectedRow: null,
      };
    }),
  closeDetailTab: (uid) =>
    set((s) => {
      const idx = s.detailTabs.findIndex((t) => t.uid === uid);
      if (idx < 0) return {};
      const next = s.detailTabs.filter((t) => t.uid !== uid);
      if (next.length === 0) return { detailTabs: [], activeDetailTabUid: null };
      // Activate the nearest surviving tab.
      const newActive = next[Math.min(idx, next.length - 1)];
      return { detailTabs: next, activeDetailTabUid: newActive.uid };
    }),
  setActiveDetailTab: (uid) =>
    set((s) => {
      const tab = s.detailTabs.find((t) => t.uid === uid);
      if (!tab || uid === s.activeDetailTabUid) return {};
      return {
        activeDetailTabUid: uid,
        nav: tab.kind,
        selectedRow: tab.row,
        activeTab: tab.activeTab,
        yamlEditing: false,
        yamlDraft: "",
        logBuffer: [],
        logSearch: "",
        containerIndex: 0,
        following: true,
        logPrevious: false,
        logSince: "all",
      };
    }),
  cycleDetailTab: (direction) =>
    set((s) => {
      if (s.detailTabs.length <= 1) return {};
      const i = s.detailTabs.findIndex((t) => t.uid === s.activeDetailTabUid);
      if (i < 0) return {};
      const next = s.detailTabs[(i + direction + s.detailTabs.length) % s.detailTabs.length];
      return {
        activeDetailTabUid: next.uid,
        nav: next.kind,
        selectedRow: next.row,
        activeTab: next.activeTab,
        yamlEditing: false,
        yamlDraft: "",
        logBuffer: [],
        logSearch: "",
        containerIndex: 0,
        following: true,
        logPrevious: false,
        logSince: "all",
      };
    }),
  openSelectedInTab: () =>
    set((s) => {
      if (!s.selectedRow) return {};
      const row = s.selectedRow;
      const kind = s.nav;
      const existing = s.detailTabs.find((t) => t.row.uid === row.uid);
      if (existing) return { activeDetailTabUid: existing.uid, selectedRow: null };
      const uid = crypto.randomUUID();
      const activeTab: DetailTab = row.pod ? "logs" : "yaml";
      return {
        detailTabs: [...s.detailTabs, { uid, kind, row, activeTab }],
        activeDetailTabUid: uid,
        selectedRow: null,
      };
    }),

  // ---------- logs ----------
  setLogSearch: (q) => set({ logSearch: q }),
  cycleContainer: () =>
    // Advance the container index and clear the buffer (a new container = new stream).
    set((s) => ({ containerIndex: s.containerIndex + 1, logBuffer: [] })),
  toggleTimestamps: () => set((s) => ({ showTimestamps: !s.showTimestamps })),
  toggleFollow: () => set((s) => ({ following: !s.following })),
  setFollowing: (value) => set({ following: value }),
  // Both of these change *which lines exist*, not just which are shown, so the
  // buffer is emptied rather than appended to — mixing a previous container's
  // output into the current one's would be worse than useless.
  setLogPrevious: (value) => set({ logPrevious: value, logBuffer: [] }),
  setLogSince: (value) => set({ logSince: value, logBuffer: [] }),
  // Events filtering is client-side over the live watcher snapshot, so there's
  // no buffer to clear — just flip the value and the table memo recomputes.
  setEventsSince: (value) => set({ eventsSince: value }),
  // Append new lines, capping the buffer at the configured size (drop oldest).
  appendLogs: (lines) =>
    set((s) => {
      const cap = s.settings.logBufferCap;
      const next = s.logBuffer.concat(lines);
      return { logBuffer: next.length > cap ? next.slice(-cap) : next };
    }),
  clearLogs: () => set({ logBuffer: [] }),

  // ---------- yaml ----------
  startYamlEdit: (initial) => set({ yamlEditing: true, yamlDraft: initial }),
  // Cancel is "abandon this edit" — including the draft. See selectionPatch /
  // setActiveTab for the reasoning.
  cancelYaml: () => set({ yamlEditing: false, yamlDraft: "" }),
  setYamlDraft: (text) => set({ yamlDraft: text }),
}));

/**
 * Connection and cluster state slice.
 */

import type { StateCreator } from 'zustand';
import type { ClusterStatus, ContextInfo, CustomKind, KindId, Row } from '../providers/types';
import type { AppState, ConnectionState, OverlayKey, RowMap } from './types';
import { KIND_ORDER } from '../lib/kinds';
import { EMPTY_SELECTION } from '../lib/selection';

/**
 * Pre-built empty row map: every built-in kind present with an empty array.
 * Frozen and shared — callers that need a fresh map for mutation create one
 * via the `emptyRows()` accessor, but reads (selectors, comparisons) can use
 * the constant directly.
 */
const EMPTY_ROWS_MAP: RowMap = Object.freeze(
  Object.fromEntries(KIND_ORDER.map((k) => [k, [] as Row[]]))
) as RowMap;

/** Empty row map: every built-in kind present with an empty array. */
function emptyRows(): RowMap {
  return { ...EMPTY_ROWS_MAP };
}

export interface ConnectionSlice {
  // State
  connection: ConnectionState;
  clusterStatus: ClusterStatus | null;
  watchCount: number;
  contexts: ContextInfo[];
  importedFiles: string[];
  hotbar: string[];
  overlay: OverlayKey | null;
  overlayPodRef: { namespace: string; name: string; container: string | null } | null;
  rows: RowMap;
  customKinds: CustomKind[];
  customKindCounts: Record<string, number> | undefined;
  watchStatus: Record<string, 'ok' | 'forbidden'>;

  // Actions
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
  setWatchStatus: (kind: string, status: 'ok' | 'forbidden') => void;
  openOverlay: (
    key: OverlayKey,
    podRef?: { namespace: string; name: string; container: string | null } | null
  ) => void;
  closeOverlay: () => void;
  resetData: () => void;
}

export const createConnectionSlice: StateCreator<AppState, [], [], ConnectionSlice> = (
  set,
  get
) => ({
  // Initial state
  connection: { phase: 'idle', context: null, clusterName: null },
  clusterStatus: null,
  watchCount: 0,
  contexts: [],
  importedFiles: [],
  hotbar: [],
  overlay: null,
  overlayPodRef: null,
  rows: emptyRows(),
  customKinds: [],
  customKindCounts: undefined,
  watchStatus: {},

  // Actions
  setConnection: (c) => set((s) => ({ connection: { ...s.connection, ...c } })),
  setContexts: (contexts) => set({ contexts }),
  setImportedFiles: (paths) => set({ importedFiles: paths }),
  addImportedFile: (path) =>
    set((s) =>
      s.importedFiles.includes(path) ? s : { importedFiles: [...s.importedFiles, path] }
    ),
  setHotbar: (items) => set({ hotbar: items }),
  addHotbarItem: (context) =>
    set((s) => {
      if (s.hotbar.includes(context) || s.hotbar.length >= 8) return s;
      return { hotbar: [...s.hotbar, context] };
    }),
  removeHotbarItem: (context) => set((s) => ({ hotbar: s.hotbar.filter((c) => c !== context) })),
  setClusterStatus: (status) => set({ clusterStatus: status }),
  setWatchCount: (n) => set({ watchCount: n }),
  setRows: (kind, rows) => {
    set({ rows: { ...(get().rows), [kind]: rows } });
    // Prune any multi-tabs whose resource disappeared from the live watcher
    // data — delegated to the detail slice so it owns its own tab lifecycle.
    get().pruneDetailTabs(kind, rows);
  },
  setCustomKinds: (kinds) => set({ customKinds: kinds }),
  setCustomKindCounts: (counts) => set({ customKindCounts: counts }),
  setWatchStatus: (kind, status) =>
    set((s) => ({ watchStatus: { ...s.watchStatus, [kind]: status } })),
  openOverlay: (key, podRef) =>
    set({ overlay: key, overlayPodRef: podRef ?? null, openMenu: null }),
  closeOverlay: () => set({ overlay: null, overlayPodRef: null }),
  resetData: () =>
    set({
      rows: emptyRows(),
      customKinds: [],
      customKindCounts: undefined,
      podMetrics: {},
      nodeMetrics: {},
      portForwards: [],
      drains: {},
      nodeSamples: {},
      nodeStatsErrors: {},
      podSamples: {},
      watchStatus: {},
      selectedRow: null,
      selection: EMPTY_SELECTION,
      logBuffer: [],
      clusterStatus: null,
      openMenu: null,
      detailTabs: [],
      activeDetailTabUid: null,
    }),
});

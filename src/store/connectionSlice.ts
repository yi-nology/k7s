/**
 * Connection and cluster state slice.
 */

import type { StateCreator } from 'zustand';
import type {
  ClusterStatus,
  ContextInfo,
  CustomKind,
  KindId,
  Row,
} from '../providers/types';
import type {
  AppState,
  ConnectionState,
  OverlayKey,
  RowMap,
} from './types';
import { KIND_ORDER } from '../lib/kinds';
import { EMPTY_SELECTION } from '../lib/selection';

/** Empty row map: every built-in kind present with an empty array. */
function emptyRows(): RowMap {
  return Object.fromEntries(KIND_ORDER.map((k) => [k, [] as Row[]]));
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
  setWatchStatus: (kind: string, status: 'ok' | 'forbidden') => void;
  openOverlay: (
    key: OverlayKey,
    podRef?: { namespace: string; name: string; container: string | null } | null
  ) => void;
  closeOverlay: () => void;
  resetData: () => void;
}

export const createConnectionSlice: StateCreator<AppState, [], [], ConnectionSlice> = (set) => ({
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
  setRows: (kind, rows) =>
    set((s) => {
      const nextRows = { ...s.rows, [kind]: rows };
      // Clean up multi-tabs whose resource was deleted externally.
      let nextTabs = s.detailTabs;
      if (s.detailTabs.length > 0 && rows.length > 0) {
        const filtered = s.detailTabs.filter(
          (t) => t.kind !== kind || rows.some((r) => r.uid === t.row.uid)
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
  setWatchStatus: (kind, status) =>
    set((s) => ({ watchStatus: { ...s.watchStatus, [kind]: status } })),
  openOverlay: (key, podRef) =>
    set({ overlay: key, overlayPodRef: podRef ?? null, openMenu: null }),
  closeOverlay: () => set({ overlay: null, overlayPodRef: null }),
  resetData: () =>
    set({
      rows: emptyRows(),
      customKinds: [],
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

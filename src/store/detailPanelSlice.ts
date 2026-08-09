/**
 * Detail panel and multi-tab state slice.
 */

import type { StateCreator } from 'zustand';
import type { KindId, LogLine, Row } from '../providers/types';
import type { AppState, DetailTab, DetailTab2 } from './types';
import { rowsFor } from './types';
import { EMPTY_SELECTION, type SelectionState } from '../lib/selection';
import type { SinceOption } from '../lib/logview';

/**
 * The eight log/YAML-related fields that reset to defaults whenever the detail
 * context changes (new selection, tab switch, close). Centralised so the reset
 * stays consistent instead of being re-typed at every call site.
 */
function logResetPatch() {
  return {
    yamlEditing: false,
    yamlDraft: '',
    logBuffer: [] as LogLine[],
    logSearch: '',
    containerIndex: 0,
    following: true,
    logPrevious: false,
    logSince: 'all' as SinceOption,
  };
}

/**
 * The state change that *is* selecting a row.
 */
function selectionPatch(row: Row) {
  return {
    selectedRow: row,
    selection: { selected: [row.uid], anchor: row.uid } as SelectionState,
    activeTab: (row.pod ? 'logs' : 'yaml') as DetailTab,
    ...logResetPatch(),
  };
}

/**
 * The patch for going to a kind, optionally selecting a row.
 */
function jumpPatch(current: { namespace: string }, kind: KindId, row?: Row) {
  const base = {
    nav: kind,
    openMenu: null,
    tableFilter: '',
    sortCol: null,
    sortDir: 'asc' as const,
    paletteOpen: false,
  };
  if (!row) return { ...base, selectedRow: null, selection: EMPTY_SELECTION };

  const namespace =
    row.namespace && current.namespace !== 'all' && current.namespace !== row.namespace
      ? row.namespace
      : current.namespace;

  return { ...base, namespace, ...selectionPatch(row) };
}

export interface DetailPanelSlice {
  // State
  selectedRow: Row | null;
  activeTab: DetailTab;
  detailTabs: DetailTab2[];
  activeDetailTabUid: string | null;
  logSearch: string;
  containerIndex: number;
  showTimestamps: boolean;
  following: boolean;
  logBuffer: LogLine[];
  logPrevious: boolean;
  logSince: SinceOption;
  eventsSince: SinceOption;
  yamlEditing: boolean;
  yamlDraft: string;

  // Actions
  selectRow: (row: Row) => void;
  closeDetail: () => void;
  setActiveTab: (tab: DetailTab) => void;
  openDetailTab: (kind: KindId, row: Row) => void;
  closeDetailTab: (uid: string) => void;
  /**
   * Drop multi-tabs whose resource was deleted from the live watcher data.
   * Called by the connection slice when a kind's rows are refreshed, so the
   * detail slice owns its own tab lifecycle (instead of the connection slice
   * reaching across to mutate `detailTabs`/`activeDetailTabUid` directly).
   * No-op when there are no tabs or the refreshed kind has no rows.
   */
  pruneDetailTabs: (kind: KindId, rows: Row[]) => void;
  setActiveDetailTab: (uid: string) => void;
  cycleDetailTab: (direction: 1 | -1) => void;
  openSelectedInTab: () => void;
  jumpTo: (kind: KindId, row?: Row) => void;
  navigateTo: (target: { kind: KindId; namespace?: string; name: string }) => void;
  viewPods: (namespace: string | undefined, selector: string) => void;
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
}

export const createDetailPanelSlice: StateCreator<AppState, [], [], DetailPanelSlice> = (set) => ({
  // Initial state
  selectedRow: null,
  activeTab: 'logs',
  detailTabs: [],
  activeDetailTabUid: null,
  logSearch: '',
  containerIndex: 0,
  showTimestamps: true,
  following: true,
  logBuffer: [],
  logPrevious: false,
  logSince: 'all',
  eventsSince: 'all',
  yamlEditing: false,
  yamlDraft: '',

  // Actions
  selectRow: (row) => set(selectionPatch(row)),
  closeDetail: () =>
    set((s) => {
      if (s.activeDetailTabUid) {
        const next = s.detailTabs.filter((t) => t.uid !== s.activeDetailTabUid);
        if (next.length === 0) {
          return {
            detailTabs: [],
            activeDetailTabUid: null,
            selectedRow: null,
            ...logResetPatch(),
          };
        }
        const newActive =
          next[
            Math.min(
              s.detailTabs.findIndex((t) => t.uid === s.activeDetailTabUid),
              next.length - 1
            )
          ];
        return {
          detailTabs: next,
          activeDetailTabUid: newActive.uid,
          nav: newActive.kind,
          selectedRow: newActive.row,
          activeTab: newActive.activeTab,
          ...logResetPatch(),
        };
      }
      return {
        selectedRow: null,
        ...logResetPatch(),
      };
    }),
  setActiveTab: (tab) =>
    set((s) => {
      let detailTabs = s.detailTabs;
      if (s.activeDetailTabUid) {
        detailTabs = s.detailTabs.map((t) =>
          t.uid === s.activeDetailTabUid ? { ...t, activeTab: tab } : t
        );
      }
      return { activeTab: tab, yamlEditing: false, yamlDraft: '', detailTabs };
    }),
  openDetailTab: (kind, row) =>
    set((s) => {
      const existing = s.detailTabs.find((t) => t.row.uid === row.uid);
      if (existing) {
        return {
          activeDetailTabUid: existing.uid,
          nav: existing.kind,
          selectedRow: existing.row,
          activeTab: existing.activeTab,
          ...logResetPatch(),
        };
      }
      const uid = crypto.randomUUID();
      const activeTab: DetailTab = row.pod ? 'logs' : 'yaml';
      return {
        detailTabs: [...s.detailTabs, { uid, kind, row, activeTab }],
        activeDetailTabUid: uid,
        nav: kind,
        selectedRow: row,
        activeTab,
        ...logResetPatch(),
      };
    }),
  closeDetailTab: (uid) =>
    set((s) => {
      const idx = s.detailTabs.findIndex((t) => t.uid === uid);
      if (idx < 0) return {};
      const next = s.detailTabs.filter((t) => t.uid !== uid);
      if (next.length === 0) return { detailTabs: [], activeDetailTabUid: null, selectedRow: null };
      const newActive = next[Math.min(idx, next.length - 1)];
      // Update all related fields so the panel shows the new active tab's data
      return {
        detailTabs: next,
        activeDetailTabUid: newActive.uid,
        nav: newActive.kind,
        selectedRow: newActive.row,
        activeTab: newActive.activeTab,
        ...logResetPatch(),
      };
    }),
  pruneDetailTabs: (kind, rows) =>
    set((s) => {
      // Nothing to prune if there are no tabs, or the refreshed kind has no
      // rows to compare against (an empty snapshot would wipe everything).
      if (s.detailTabs.length === 0 || rows.length === 0) return {};
      const filtered = s.detailTabs.filter(
        (t) => t.kind !== kind || rows.some((r) => r.uid === t.row.uid)
      );
      if (filtered.length === s.detailTabs.length) return {};
      if (filtered.length === 0) return { detailTabs: [], activeDetailTabUid: null, selectedRow: null };
      const activeStillExists = filtered.some((t) => t.uid === s.activeDetailTabUid);
      const newActive = activeStillExists
        ? filtered.find((t) => t.uid === s.activeDetailTabUid)!
        : filtered[0];
      return {
        detailTabs: filtered,
        activeDetailTabUid: newActive.uid,
        // Only update related fields if the active tab changed
        ...(activeStillExists ? {} : {
          nav: newActive.kind,
          selectedRow: newActive.row,
          activeTab: newActive.activeTab,
          ...logResetPatch(),
        }),
      };
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
        ...logResetPatch(),
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
        ...logResetPatch(),
      };
    }),
  openSelectedInTab: () =>
    set((s) => {
      if (!s.selectedRow) return {};
      const row = s.selectedRow;
      const kind = s.nav;
      const existing = s.detailTabs.find((t) => t.row.uid === row.uid);
      if (existing) {
        return {
          activeDetailTabUid: existing.uid,
          nav: existing.kind,
          selectedRow: existing.row,
          activeTab: existing.activeTab,
          ...logResetPatch(),
        };
      }
      const uid = crypto.randomUUID();
      const activeTab: DetailTab = row.pod ? 'logs' : 'yaml';
      return {
        detailTabs: [...s.detailTabs, { uid, kind, row, activeTab }],
        activeDetailTabUid: uid,
        nav: kind,
        selectedRow: row,
        activeTab,
        ...logResetPatch(),
      };
    }),
  jumpTo: (kind, row) => set((s) => jumpPatch(s, kind, row)),
  navigateTo: (target) =>
    set((s) => {
      const found = rowsFor(s.rows, target.kind).find(
        (r) => r.name === target.name && (!target.namespace || r.namespace === target.namespace)
      );
      const row = found ?? {
        uid: `${target.namespace ?? ''}/${target.name}`,
        name: target.name,
        namespace: target.namespace,
        cells: [],
      };
      return jumpPatch(s, target.kind, row);
    }),
  viewPods: (namespace, selector) =>
    set((s) => ({
      nav: 'pods',
      openMenu: null,
      sortCol: null,
      sortDir: 'asc',
      paletteOpen: false,
      selectedRow: null,
      selection: EMPTY_SELECTION,
      namespace: namespace || s.namespace,
      tableFilter: selector,
    })),
  setLogSearch: (q) => set({ logSearch: q }),
  cycleContainer: () => set((s) => ({ containerIndex: s.containerIndex + 1, logBuffer: [] })),
  toggleTimestamps: () => set((s) => ({ showTimestamps: !s.showTimestamps })),
  toggleFollow: () => set((s) => ({ following: !s.following })),
  setFollowing: (value) => set({ following: value }),
  setLogPrevious: (value) => set({ logPrevious: value, logBuffer: [] }),
  setLogSince: (value) => set({ logSince: value, logBuffer: [] }),
  setEventsSince: (value) => set({ eventsSince: value }),
  appendLogs: (lines) =>
    set((s) => {
      const cap = s.settings.logBufferCap;
      const next = s.logBuffer.concat(lines);
      return { logBuffer: next.length > cap ? next.slice(-cap) : next };
    }),
  clearLogs: () => set({ logBuffer: [] }),
  startYamlEdit: (initial) => set({ yamlEditing: true, yamlDraft: initial }),
  cancelYaml: () => set({ yamlEditing: false, yamlDraft: '' }),
  setYamlDraft: (text) => set({ yamlDraft: text }),
});

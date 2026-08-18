/**
 * Navigation and filtering state slice.
 */

import type { StateCreator } from 'zustand';
import type { KindId } from '../providers/types';
import type { AppState, OpenMenu } from './types';
import { EMPTY_SELECTION } from '../lib/selection';
import { sectionForKind } from '../lib/sections';
import type { SectionId } from '../lib/sections';

export interface NavigationSlice {
  // State
  nav: KindId;
  section: SectionId;
  namespace: string;
  tableFilter: string;
  sortCol: number | null;
  sortDir: 'asc' | 'desc';
  openMenu: OpenMenu;
  paletteOpen: boolean;

  // Actions
  setNav: (kind: KindId) => void;
  setSection: (section: SectionId) => void;
  setNamespace: (ns: string) => void;
  setTableFilter: (q: string) => void;
  toggleSort: (col: number) => void;
  toggleMenu: (menu: Exclude<OpenMenu, null>) => void;
  closeMenus: () => void;
  setPaletteOpen: (open: boolean) => void;
}

export const createNavigationSlice: StateCreator<AppState, [], [], NavigationSlice> = (set) => ({
  // Initial state
  nav: 'pods',
  section: 'overview', // 默认落在概览页
  namespace: 'all',
  tableFilter: '',
  sortCol: null,
  sortDir: 'asc',
  openMenu: null,
  paletteOpen: false,

  // Actions
  setNav: (kind) =>
    set({
      nav: kind,
      section: sectionForKind(kind), // kind 导航自动带出分区
      selectedRow: null,
      selection: EMPTY_SELECTION,
      openMenu: null,
      tableFilter: '',
      sortCol: null,
      sortDir: 'asc',
      // Navigating away from an open overlay (Dashboard, Helm Market, …) must
      // dismiss it — otherwise the table swaps kind *behind* the overlay and
      // the click looks like it did nothing.
      overlay: null,
      overlayPodRef: null,
    }),
  setSection: (section) =>
    set({
      section,
      overlay: null,
      overlayPodRef: null,
      // 进入资源分区时切到该分区第一个 kind;概览/工具分区保留当前 nav,
      // 返回资源分区时表格还能显示上次的 kind。
      ...(section === 'workloads' || section === 'config' || section === 'storage'
        ? { nav: FIRST_KIND[section] }
        : {}),
    }),
  setNamespace: (ns) =>
    set({ namespace: ns, openMenu: null, selectedRow: null, selection: EMPTY_SELECTION }),
  setTableFilter: (q) => set({ tableFilter: q }),
  toggleSort: (col) =>
    set((s) =>
      s.sortCol === col
        ? { sortDir: s.sortDir === 'asc' ? 'desc' : 'asc' }
        : { sortCol: col, sortDir: 'asc' }
    ),
  toggleMenu: (menu) => set((s) => ({ openMenu: s.openMenu === menu ? null : menu })),
  closeMenus: () => set({ openMenu: null }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
});

/** 每个资源分区的默认 kind。 */
const FIRST_KIND: Record<string, KindId> = {
  workloads: 'deployments',
  config: 'configmaps',
  storage: 'persistentvolumeclaims',
};

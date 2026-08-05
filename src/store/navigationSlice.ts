/**
 * Navigation and filtering state slice.
 */

import type { StateCreator } from 'zustand';
import type { KindId } from '../providers/types';
import type { AppState, OpenMenu } from './types';
import { EMPTY_SELECTION } from '../lib/selection';

export interface NavigationSlice {
  // State
  nav: KindId;
  namespace: string;
  tableFilter: string;
  sortCol: number | null;
  sortDir: 'asc' | 'desc';
  openMenu: OpenMenu;
  paletteOpen: boolean;

  // Actions
  setNav: (kind: KindId) => void;
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
      selectedRow: null,
      selection: EMPTY_SELECTION,
      openMenu: null,
      tableFilter: '',
      sortCol: null,
      sortDir: 'asc',
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

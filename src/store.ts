/**
 * Central application store (Zustand). Combines state slices for
 * connection, navigation, detail panel, and live data.
 */

import { create } from 'zustand';
import { cachedTheme, prefersDark } from './lib/theme';
import { cachedLocale } from './lib/i18n';
import { DEFAULT_SETTINGS } from './lib/settings';
import { EMPTY_SELECTION } from './lib/selection';
import { createConnectionSlice } from './store/connectionSlice';
import { createNavigationSlice } from './store/navigationSlice';
import { createDetailPanelSlice } from './store/detailPanelSlice';
import { createDataSlice } from './store/dataSlice';
import type { AppState } from './store/types';

export const useStore = create<AppState>()((set, get, api) => ({
  // Theme + language come from the paint-time cache rather than the default, so
  // the boot render agrees with what index.html already painted.
  settings: { ...DEFAULT_SETTINGS, theme: cachedTheme(), language: cachedLocale() },
  systemDark: prefersDark(),
  settingsOpen: false,
  settingsSection: null,
  onboardingOpen: false,
  selection: EMPTY_SELECTION,
  shortcutsOpen: false,
  aiPanelOpen: false,
  aiPendingMessage: undefined,
  setShortcutsOpen: (open: boolean) => set({ shortcutsOpen: open }),
  setAiPanelOpen: (open: boolean) => set({ aiPanelOpen: open }),
  setAiPendingMessage: (msg: string | undefined) => set({ aiPendingMessage: msg }),
  setSettings: (patch: Partial<typeof DEFAULT_SETTINGS>) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      const logBuffer =
        s.logBuffer.length > settings.logBufferCap
          ? s.logBuffer.slice(-settings.logBufferCap)
          : s.logBuffer;
      return { settings, logBuffer };
    }),
  setSettingsOpen: (open: boolean, section?: string) =>
    set({ settingsOpen: open, settingsSection: open ? (section ?? null) : null }),
  setOnboardingOpen: (open: boolean) => set({ onboardingOpen: open }),
  setSystemDark: (dark: boolean) => set({ systemDark: dark }),
  setSelection: (selection: { selected: string[]; anchor: string | null }) => set({ selection }),
  clearSelection: () => set({ selection: EMPTY_SELECTION }),

  // Combine slices
  ...createConnectionSlice(set, get, api),
  ...createNavigationSlice(set, get, api),
  ...createDetailPanelSlice(set, get, api),
  ...createDataSlice(set, get, api),
}));

// Re-export types from store/types.ts
export type {
  AppState,
  DetailTab,
  DetailTab2,
  OpenMenu,
  OverlayKey,
  ConnectionState,
  RowMap,
  SelectionState,
} from './store/types';

// Re-export values from store/types.ts
export {
  EMPTY_ROWS,
  rowsFor,
  selectKindCounts,
  NODE_SAMPLE_CAP,
  POD_SAMPLE_CAP,
  LOG_BUFFER_CAP_DEFAULT as LOG_BUFFER_CAP,
} from './store/types';

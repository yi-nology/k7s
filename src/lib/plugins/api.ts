/**
 * PluginAPI implementation — the bridge between plugins and the k7s app.
 *
 * Each PluginManager creates one `PluginAPIImpl` instance. It wraps the
 * Zustand store and the data provider so plugins never import them directly.
 */

import type { PluginAPI, SidebarItemDef, DetailTabDef, DashboardCardDef } from './types';
import type { KindId } from '../../providers/types';
import { useStore, rowsFor } from '../../store';

/** Runtime-registered sidebar items (populated via api.registerSidebarItem). */
const _sidebarItems: SidebarItemDef[] = [];
/** Runtime-registered detail tabs. */
const _detailTabs: DetailTabDef[] = [];
/** Runtime-registered dashboard cards. */
const _dashboardCards: DashboardCardDef[] = [];

export class PluginAPIImpl implements PluginAPI {
  getStore() {
    return useStore;
  }

  navigate(kind: KindId, name?: string, namespace?: string): void {
    const store = useStore.getState();
    if (name) {
      store.navigateTo({ kind, name, namespace });
    } else {
      store.jumpTo(kind);
    }
  }

  notify(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    // Use the existing status-bar / notification surface. For now, fall back
    // to console + a simple event that the UI can hook into later.
    const prefix =
      level === 'error' ? '[plugin:error]' : level === 'warn' ? '[plugin:warn]' : '[plugin]';
    if (level === 'error') {
      console.error(prefix, message);
    } else if (level === 'warn') {
      console.warn(prefix, message);
    } else {
      console.log(prefix, message);
    }
    // Dispatch a custom event so the status bar or a toast component can pick it up.
    window.dispatchEvent(new CustomEvent('k7s:plugin-notify', { detail: { message, level } }));
  }

  getResources(kind: KindId): any[] {
    return rowsFor(useStore.getState().rows, kind);
  }

  getResource(kind: KindId, name: string, namespace?: string): any | undefined {
    const rows = rowsFor(useStore.getState().rows, kind);
    return rows.find((r) => r.name === name && (!namespace || r.namespace === namespace));
  }

  // ---- runtime registration ----

  registerSidebarItem(item: SidebarItemDef): void {
    // Avoid duplicates.
    if (!_sidebarItems.some((s) => s.key === item.key)) {
      _sidebarItems.push(item);
    }
  }

  registerDetailTab(tab: DetailTabDef): void {
    if (!_detailTabs.some((t) => t.id === tab.id)) {
      _detailTabs.push(tab);
    }
  }

  registerDashboardCard(card: DashboardCardDef): void {
    if (!_dashboardCards.some((c) => c.id === card.id)) {
      _dashboardCards.push(card);
    }
  }
}

// Accessors for the UI layer to read runtime-registered extensions.
export function getPluginSidebarItems(): SidebarItemDef[] {
  return _sidebarItems;
}

export function getPluginDetailTabs(): DetailTabDef[] {
  return _detailTabs;
}

export function getPluginDashboardCards(): DashboardCardDef[] {
  return _dashboardCards;
}

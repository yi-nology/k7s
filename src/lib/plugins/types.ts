/**
 * Plugin / Extension API type definitions.
 *
 * A k7s plugin is a plain object conforming to `K7sPlugin`. The plugin manager
 * calls `activate` on enable and `activate` on registration if the plugin is
 * enabled by default. Extension points (sidebar items, detail tabs, etc.) are
 * discovered from the plugin object itself — no imperative registration needed
 * for the static case, though `PluginAPI` also allows runtime registration.
 */

import type { KindId } from '../../providers/types';

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export interface K7sPlugin {
  /** Stable unique id, e.g. "gpu-monitor". */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** SemVer string. */
  version: string;
  /** Short description shown in the plugin panel. */
  description?: string;
  /** Author / maintainer. */
  author?: string;

  /** Called when the plugin is enabled. Receives the plugin API. */
  activate?(api: PluginAPI): void;
  /** Called when the plugin is disabled. Clean up listeners, timers, etc. */
  deactivate?(): void;

  // ---- static extension points (optional) ----
  /** Extra sidebar entries. */
  sidebarItems?: SidebarItemDef[];
  /** Extra detail-panel tabs (scoped by resource kind). */
  detailTabs?: DetailTabDef[];
  /** Extra table columns (scoped by resource kind). */
  resourceColumns?: ResourceColumnDef[];
  /** Extra row actions (scoped by resource kind). */
  actions?: ActionDef[];
  /** Extra dashboard cards. */
  dashboardCards?: DashboardCardDef[];
}

// ---------------------------------------------------------------------------
// Plugin API — passed to `activate`
// ---------------------------------------------------------------------------

export interface PluginAPI {
  /** The Zustand store (read-only access via getState). */
  getStore(): {
    getState: () => unknown;
    subscribe: (listener: (state: unknown) => void) => () => void;
  };

  /** Navigate to a resource kind, optionally selecting a row. */
  navigate(kind: KindId, name?: string, namespace?: string): void;

  /** Show a toast / notification. */
  notify(message: string, level?: 'info' | 'warn' | 'error'): void;

  /** Read the current rows for a kind from the store. */
  getResources(kind: KindId): unknown[];
  /** Read a single resource row by name (and optional namespace). */
  getResource(kind: KindId, name: string, namespace?: string): unknown;

  // ---- runtime UI registration ----
  registerSidebarItem(item: SidebarItemDef): void;
  registerDetailTab(tab: DetailTabDef): void;
  registerDashboardCard(card: DashboardCardDef): void;
}

// ---------------------------------------------------------------------------
// Extension-point definitions
// ---------------------------------------------------------------------------

export interface SidebarItemDef {
  key: string;
  label: string;
  icon: string;
  group?: string;
  onClick: () => void;
}

export interface DetailTabDef {
  id: string;
  label: string;
  /** Restrict to specific resource kinds; omit for all. */
  kinds?: KindId[];
  /** React component rendered inside the detail panel. */
  component: React.ComponentType<{ row: unknown }>;
}

export interface ResourceColumnDef {
  kind: KindId;
  header: string;
  render: (row: unknown) => string;
}

export interface ActionDef {
  id: string;
  label: string;
  /** Restrict to specific resource kinds; omit for all. */
  kinds?: KindId[];
  icon?: string;
  onClick: (row: unknown) => void;
}

export interface DashboardCardDef {
  id: string;
  title: string;
  component: React.ComponentType;
}

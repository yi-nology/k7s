/**
 * Plugin manager — singleton that owns every registered plugin's lifecycle.
 *
 * Plugins are registered once (built-in at boot, user-supplied later via the
 * plugin panel). The manager tracks enabled/disabled state per plugin and
 * calls `activate` / `deactivate` as appropriate. Enabled state is persisted
 * in the app's settings alongside other user prefs.
 */

import type { K7sPlugin, PluginAPI } from './types';
import { PluginAPIImpl } from './api';

export class PluginManager {
  private plugins: Map<string, K7sPlugin> = new Map();
  private enabled: Set<string> = new Set();
  private api: PluginAPIImpl;

  constructor() {
    this.api = new PluginAPIImpl();
  }

  // ---- registration ----

  /** Register a plugin. If it was previously enabled (from prefs), activate it. */
  register(plugin: K7sPlugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[plugins] duplicate registration: "${plugin.id}"`);
      return;
    }
    this.plugins.set(plugin.id, plugin);
  }

  /** Remove a plugin entirely (deactivates first if active). */
  unregister(id: string): void {
    this.deactivate(id);
    this.plugins.delete(id);
    this.enabled.delete(id);
  }

  // ---- activation ----

  /** Enable and activate a plugin. No-op if already active. */
  activate(id: string): void {
    const plugin = this.plugins.get(id);
    if (!plugin) return;
    if (this.enabled.has(id)) return;
    this.enabled.add(id);
    try {
      plugin.activate?.(this.api);
    } catch (err) {
      console.error(`[plugins] activate("${id}") failed:`, err);
      this.enabled.delete(id);
    }
  }

  /** Deactivate and disable a plugin. No-op if already inactive. */
  deactivate(id: string): void {
    const plugin = this.plugins.get(id);
    if (!plugin || !this.enabled.has(id)) return;
    this.enabled.delete(id);
    try {
      plugin.deactivate?.();
    } catch (err) {
      console.error(`[plugins] deactivate("${id}") failed:`, err);
    }
  }

  /** Toggle enabled state. Returns the new state. */
  toggle(id: string): boolean {
    if (this.isEnabled(id)) {
      this.deactivate(id);
      return false;
    } else {
      this.activate(id);
      return true;
    }
  }

  // ---- queries ----

  getAll(): K7sPlugin[] {
    return [...this.plugins.values()];
  }

  get(id: string): K7sPlugin | undefined {
    return this.plugins.get(id);
  }

  isEnabled(id: string): boolean {
    return this.enabled.has(id);
  }

  getAPI(): PluginAPI {
    return this.api;
  }

  /** Snapshot of enabled plugin ids, for persistence. */
  getEnabledIds(): string[] {
    return [...this.enabled];
  }

  /** Bulk-restore enabled state (e.g. from persisted prefs). */
  restoreEnabled(ids: string[]): void {
    for (const id of ids) {
      if (this.plugins.has(id)) {
        this.activate(id);
      }
    }
  }
}

/** The shared singleton. */
export const pluginManager = new PluginManager();

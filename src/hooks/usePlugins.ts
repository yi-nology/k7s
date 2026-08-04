/**
 * App-level hook: registers built-in plugins and activates those that were
 * enabled in the previous session. Mounted once at the app root.
 *
 * Deactivates all plugins on unmount so cleanup hooks run on shutdown / hot
 * reload.
 */

import { useEffect } from "react";
import { pluginManager } from "../lib/plugins/manager";
import { BUILTIN_PLUGINS } from "../lib/plugins/builtin";

/** Plugin ids that are enabled by default on first launch. */
const DEFAULT_ENABLED = ["gpu-monitor", "netpol-viewer"];

export function usePlugins(): void {
  useEffect(() => {
    // Register every built-in plugin.
    for (const plugin of BUILTIN_PLUGINS) {
      pluginManager.register(plugin);
    }

    // Try to restore previously-enabled ids from localStorage.
    let enabledIds: string[] = DEFAULT_ENABLED;
    try {
      const stored = localStorage.getItem("k7s:plugins:enabled");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) enabledIds = parsed;
      }
    } catch {
      // Corrupt or missing — fall back to defaults.
    }

    pluginManager.restoreEnabled(enabledIds);

    // Persist enabled state on every change so it survives a relaunch.
    const persist = () => {
      try {
        localStorage.setItem(
          "k7s:plugins:enabled",
          JSON.stringify(pluginManager.getEnabledIds()),
        );
      } catch {
        // localStorage full or unavailable — best-effort.
      }
    };
    // Persist on any toggle (the PluginPanel calls toggle which activates/deactivates).
    // We also persist on unload so the latest state is captured.
    window.addEventListener("beforeunload", persist);
    // Listen for our custom event fired by the PluginPanel on toggle.
    window.addEventListener("k7s:plugins-changed", persist);

    return () => {
      // Deactivate all plugins on unmount.
      for (const id of pluginManager.getEnabledIds()) {
        pluginManager.deactivate(id);
      }
      window.removeEventListener("beforeunload", persist);
      window.removeEventListener("k7s:plugins-changed", persist);
    };
  }, []);
}

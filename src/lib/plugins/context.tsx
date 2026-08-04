/**
 * React context that exposes the PluginManager singleton to the component tree.
 *
 * Components that need to read plugin state (e.g. the detail panel for extra
 * tabs) consume this context rather than importing the singleton directly, so
 * the dependency graph stays clean and the manager is mockable in tests.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { pluginManager, PluginManager } from './manager';

const PluginContext = createContext<PluginManager>(pluginManager);

export function PluginProvider({ children }: { children: ReactNode }) {
  return <PluginContext.Provider value={pluginManager}>{children}</PluginContext.Provider>;
}

/** Access the plugin manager from any component. */
export function usePluginManager(): PluginManager {
  return useContext(PluginContext);
}

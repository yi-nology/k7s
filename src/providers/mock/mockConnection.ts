/**
 * Mock connection and context management.
 */

import type {
  ClusterInfo,
  ClusterStatus,
  ContextInfo,
  ImportResult,
  Prefs,
  Unsub,
} from '../types';
import { MOCK_CLUSTERS } from './data';

/** Fixed status matching the prototype's status bar. */
export const MOCK_STATUS: ClusterStatus = {
  connected: true,
  version: 'v1.31',
  apiLatencyMs: 42,
  nodesReady: 6,
  nodesTotal: 6,
  cpuPercent: 41,
  memPercent: 63,
};

/** Prototype shows a fixed "watch: 9 streams active". */
export const MOCK_WATCH_COUNT = 9;

export class MockConnectionMixin {
  protected statusCbs = new Set<(s: ClusterStatus) => void>();
  protected watchCbs = new Set<(n: number) => void>();

  async listContexts(): Promise<ContextInfo[]> {
    return MOCK_CLUSTERS.map((c) => ({ name: c.name, cluster: c.name, current: c.active }));
  }

  async connect(context: string): Promise<ClusterInfo> {
    this.emitAllRows();
    for (const cb of this.statusCbs) cb({ ...MOCK_STATUS, context });
    for (const cb of this.watchCbs) cb(MOCK_WATCH_COUNT);
    return { context, clusterName: context, server: 'https://mock.local:6443', version: 'v1.31' };
  }

  async importKubeconfig(): Promise<ImportResult | null> {
    const base = MOCK_CLUSTERS.map((c) => ({ name: c.name, cluster: c.name, current: c.active }));
    const imported: ContextInfo = {
      name: 'imported-team-cluster',
      cluster: 'team-eks',
      current: false,
    };
    return { contexts: [...base, imported], path: '/mock/team-cluster.kubeconfig' };
  }

  async restoreImports(_paths: string[]): Promise<string[]> {
    return [];
  }

  // Demo mode doesn't persist anything.
  async loadPrefs(): Promise<Prefs | null> {
    return null;
  }
  async savePrefs(_prefs: Prefs): Promise<void> {}

  async setWindowTheme(_theme: 'dark' | 'light'): Promise<void> {}

  onClusterStatus(cb: (status: ClusterStatus) => void): Unsub {
    this.statusCbs.add(cb);
    queueMicrotask(() => cb(MOCK_STATUS));
    return () => {
      this.statusCbs.delete(cb);
    };
  }

  onWatchStatus(cb: (activeStreams: number) => void): Unsub {
    this.watchCbs.add(cb);
    queueMicrotask(() => cb(MOCK_WATCH_COUNT));
    return () => {
      this.watchCbs.delete(cb);
    };
  }

  onWatchKindStatus(_cb: (kind: string, status: 'ok' | 'forbidden') => void): Unsub {
    return () => {}; // mock: no RBAC errors
  }

  // Override in main class
  protected emitAllRows(): void {
    // Implemented in MockProvider
  }
}

/**
 * Tests for the stale-context guard in useBootstrap's customKindCounts
 * subscription (lines 157-176).
 *
 * The subscription watches for `connection.phase === 'connected'` and
 * `connection.context !== lastCountedCtx`, then fetches custom-kind instance
 * counts. If the user switches contexts while the fetch is in flight, the
 * stale response must be discarded — otherwise it overwrites the new
 * context's counts (or sets counts when none should exist yet).
 *
 * Rather than mounting the full useBootstrap hook (which wires up dozens of
 * provider listeners), we replicate the subscription pattern with a mock
 * provider that returns a controllable promise.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { useStore } from '../store';

/** Minimal type for the parts of the provider we exercise. */
interface MockProvider {
  customKindCounts(): Promise<Array<{ id: string; count: number }>>;
}

function resetStore() {
  useStore.setState({
    connection: { phase: 'idle', context: null, clusterName: null },
    customKindCounts: undefined,
  });
}

beforeEach(() => {
  resetStore();
});

describe('useBootstrap customKindCounts stale-context guard', () => {
  it('discards stale fetch when context switches before response arrives', async () => {
    // Track each call's resolver so we can resolve them independently.
    const resolvers: Array<(v: Array<{ id: string; count: number }>) => void> = [];
    const provider: MockProvider = {
      customKindCounts: () => new Promise((r) => { resolvers.push(r); }),
    };

    // Replicate the subscription from useBootstrap.ts (lines 157-176).
    let lastCountedCtx: string | null = null;
    const unsub = useStore.subscribe((s) => {
      if (
        s.connection.phase === 'connected' &&
        s.connection.context &&
        s.connection.context !== lastCountedCtx
      ) {
        lastCountedCtx = s.connection.context;
        const ctxAtFetchTime = lastCountedCtx;
        provider.customKindCounts().then((arr) => {
          if (useStore.getState().connection.context !== ctxAtFetchTime) return;
          const map: Record<string, number> = {};
          for (const { id, count } of arr) map[id] = count;
          useStore.getState().setCustomKindCounts(map);
        });
      }
    });

    // Connect to context 'A' — triggers fetch #1.
    useStore.setState({
      connection: { phase: 'connected', context: 'A', clusterName: 'cluster-a' },
    });

    // Switch to context 'B' before fetch #1 resolves — triggers fetch #2.
    useStore.setState({
      connection: { phase: 'connected', context: 'B', clusterName: 'cluster-b' },
    });

    // Resolve fetch #1 (context 'A'). Guard should discard it because
    // connection.context is now 'B'.
    resolvers[0]([{ id: 'apps', count: 5 }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(useStore.getState().customKindCounts).toBeUndefined();

    // Resolve fetch #2 (context 'B'). Context hasn't changed — counts apply.
    resolvers[1]([{ id: 'apps', count: 10 }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(useStore.getState().customKindCounts).toEqual({ apps: 10 });

    unsub();
  });

  it('applies counts when context has not changed', async () => {
    let resolveA!: (v: Array<{ id: string; count: number }>) => void;
    const provider: MockProvider = {
      customKindCounts: () => new Promise((r) => { resolveA = r; }),
    };

    let lastCountedCtx: string | null = null;
    const unsub = useStore.subscribe((s) => {
      if (
        s.connection.phase === 'connected' &&
        s.connection.context &&
        s.connection.context !== lastCountedCtx
      ) {
        lastCountedCtx = s.connection.context;
        const ctxAtFetchTime = lastCountedCtx;
        provider.customKindCounts().then((arr) => {
          if (useStore.getState().connection.context !== ctxAtFetchTime) return;
          const map: Record<string, number> = {};
          for (const { id, count } of arr) map[id] = count;
          useStore.getState().setCustomKindCounts(map);
        });
      }
    });

    // Connect to context 'A'.
    useStore.setState({
      connection: { phase: 'connected', context: 'A', clusterName: 'cluster-a' },
    });

    // Resolve the fetch — context is still 'A'.
    resolveA([{ id: 'apps', count: 7 }]);
    await new Promise((r) => setTimeout(r, 0));

    expect(useStore.getState().customKindCounts).toEqual({ apps: 7 });

    unsub();
  });
});

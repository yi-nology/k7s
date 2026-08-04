/**
 * Tests for the cluster-status reconciliation. The reconciliation is the only
 * thing that flips the connection phase in response to a live `cluster-status`
 * push, so the gate that drops stale events from a previous cluster is what
 * protects a freshly-connected cluster B from being mis-labeled "error" by a
 * late `connected: false` event from cluster A.
 *
 * The reconciliation is unit-tested with a hand-rolled state slice (no React,
 * no Zustand singleton) so the test can drive every gate branch — context
 * match, context mismatch, untagged status, no store context — independently.
 */

import { describe, expect, it } from 'vitest';
import { reconcileClusterStatus, type ClusterStatusState } from './clusterStatus';
import type { ClusterStatus } from '../providers/types';
import type { ConnectionState } from '../store';

/** A baseline connected status for cluster A. */
const STATUS_A_OK: ClusterStatus = {
  connected: true,
  version: 'v1.31',
  apiLatencyMs: 42,
  nodesReady: 6,
  nodesTotal: 6,
  cpuPercent: 41,
  memPercent: 63,
  context: 'A',
};

const STATUS_A_DOWN: ClusterStatus = { ...STATUS_A_OK, connected: false, context: 'A' };

/** A recording state slice — what got written, in order. */
function newState(initial: ConnectionState): ClusterStatusState & {
  statusWrites: ClusterStatus[];
  connectionWrites: Partial<ConnectionState>[];
  podMetricsWrites: unknown[];
  nodeMetricsWrites: unknown[];
} {
  const state: ClusterStatusState = {
    connection: initial,
    setConnection: (patch) => {
      state.connection = { ...state.connection, ...patch };
      (state as ReturnType<typeof newState>).connectionWrites.push(patch);
    },
    setClusterStatus: (s) => {
      (state as ReturnType<typeof newState>).statusWrites.push(s);
    },
    setPodMetrics: (m) => {
      (state as ReturnType<typeof newState>).podMetricsWrites.push(m);
    },
    setNodeMetrics: (m) => {
      (state as ReturnType<typeof newState>).nodeMetricsWrites.push(m);
    },
  };
  return Object.assign(state, {
    statusWrites: [] as ClusterStatus[],
    connectionWrites: [] as Partial<ConnectionState>[],
    podMetricsWrites: [] as unknown[],
    nodeMetricsWrites: [] as unknown[],
  });
}

describe('reconcileClusterStatus — context match (pass-29 happy path)', () => {
  it('writes the status and leaves the connection phase alone when connected stays true', () => {
    const s = newState({ phase: 'connected', context: 'A', clusterName: 'A' });
    reconcileClusterStatus(STATUS_A_OK, s);
    expect(s.statusWrites).toEqual([STATUS_A_OK]);
    expect(s.connectionWrites).toEqual([]);
    expect(s.podMetricsWrites).toEqual([]);
    expect(s.nodeMetricsWrites).toEqual([]);
  });

  it('flips a connected phase to error when status reports !connected (same context)', () => {
    const s = newState({ phase: 'connected', context: 'A', clusterName: 'A' });
    reconcileClusterStatus(STATUS_A_DOWN, s);
    expect(s.connection.phase).toBe('error');
    expect(s.connection.error).toBe('cluster unreachable');
    // The status is still written so the status bar shows the new CPU/MEM,
    // which the user will see as the row that just "went down".
    expect(s.statusWrites).toEqual([STATUS_A_DOWN]);
  });

  it('flips an error phase back to connected when status reports connected (same context)', () => {
    const s = newState({ phase: 'error', context: 'A', clusterName: 'A', error: 'old' });
    reconcileClusterStatus(STATUS_A_OK, s);
    expect(s.connection.phase).toBe('connected');
    expect(s.connection.error).toBeUndefined();
  });

  it('clears cached pod/node metrics when cpuPercent goes null (metrics-server gone)', () => {
    const s = newState({ phase: 'connected', context: 'A', clusterName: 'A' });
    const noMetrics: ClusterStatus = { ...STATUS_A_OK, cpuPercent: null, memPercent: null };
    reconcileClusterStatus(noMetrics, s);
    expect(s.podMetricsWrites).toEqual([{}]);
    expect(s.nodeMetricsWrites).toEqual([{}]);
    // The phase stays connected — metrics-server being gone isn't the same
    // as the API server being unreachable.
    expect(s.connection.phase).toBe('connected');
  });

  it('ignores the metrics-clear path when cpuPercent is a number', () => {
    const s = newState({ phase: 'connected', context: 'A', clusterName: 'A' });
    reconcileClusterStatus(STATUS_A_OK, s);
    expect(s.podMetricsWrites).toEqual([]);
    expect(s.nodeMetricsWrites).toEqual([]);
  });
});

describe('reconcileClusterStatus — context mismatch (pass-29, the regression)', () => {
  it('drops a stale `connected: false` from a previous cluster (A → B switch)', () => {
    // The user is on cluster B, phase connected. A late `cluster-status` from
    // A saying "I'm down" lands in B's subscription stream. The old code
    // would have flipped B to error and cleared B's metrics.
    const s = newState({ phase: 'connected', context: 'B', clusterName: 'B' });
    reconcileClusterStatus(STATUS_A_DOWN, s);
    expect(s.connection.phase).toBe('connected');
    expect(s.connection.error).toBeUndefined();
    expect(s.statusWrites).toEqual([]);
    expect(s.connectionWrites).toEqual([]);
    expect(s.podMetricsWrites).toEqual([]);
    expect(s.nodeMetricsWrites).toEqual([]);
  });

  it('drops a stale `connected: true` from a previous cluster (B is currently error)', () => {
    // The user is on cluster B in an error state. A late `connected: true`
    // from A would otherwise flip B's phase to connected — equally wrong,
    // because B is actually down.
    const s = newState({ phase: 'error', context: 'B', clusterName: 'B', error: 'B-down' });
    reconcileClusterStatus(STATUS_A_OK, s);
    expect(s.connection.phase).toBe('error');
    expect(s.connection.error).toBe('B-down');
    expect(s.statusWrites).toEqual([]);
  });

  it('also drops the metrics-clear branch for a stale status', () => {
    const s = newState({ phase: 'connected', context: 'B', clusterName: 'B' });
    const noMetrics: ClusterStatus = { ...STATUS_A_OK, cpuPercent: null };
    reconcileClusterStatus(noMetrics, s);
    expect(s.podMetricsWrites).toEqual([]);
    expect(s.nodeMetricsWrites).toEqual([]);
  });
});

describe('reconcileClusterStatus — backward-compat (legacy untagged status)', () => {
  it('allows an untagged status through (status.context undefined)', () => {
    // Backends that pre-date the context-tagging wire change emit
    // `ClusterStatus` without the `context` field. The gate is a no-op for
    // those — pre-existing flows are preserved.
    const legacy: ClusterStatus = { ...STATUS_A_OK };
    delete (legacy as { context?: string }).context;
    const s = newState({ phase: 'connected', context: 'A', clusterName: 'A' });
    reconcileClusterStatus(legacy, s);
    expect(s.statusWrites).toEqual([legacy]);
    expect(s.connection.phase).toBe('connected');
  });

  it('allows a tagged status through when the store has no context yet (pre-first-connect)', () => {
    // The initial `cluster-status` emit from `onClusterStatus` is fired in a
    // queueMicrotask before the first `connectTo()` resolves. The store's
    // `connection.context` is still null at that point, so a tagged status
    // from the future-connected cluster must not be dropped.
    const s = newState({ phase: 'connecting', context: null, clusterName: null });
    reconcileClusterStatus(STATUS_A_OK, s);
    expect(s.statusWrites).toEqual([STATUS_A_OK]);
  });
});

describe('reconcileClusterStatus — store state propagation', () => {
  it('does not flip a connecting phase to error (only a connected phase)', () => {
    // Defensive: a `connected: false` mid-connect (before the await resolves)
    // shouldn't trip the gate into "error" — `connectTo` owns the error flip
    // for that case via its `try/catch`.
    const s = newState({ phase: 'connecting', context: 'A', clusterName: null });
    reconcileClusterStatus(STATUS_A_DOWN, s);
    expect(s.connection.phase).toBe('connecting');
  });
});

/**
 * Reconcile a `cluster-status` push into the connection lifecycle (Story 6.2):
 * a live cluster going unreachable flips the UI to disconnected, and recovery
 * flips it back — without a manual reconnect. Also clears stale metrics when
 * the metrics API disappears (`cpuPercent` goes null) so CPU/MEM fall back
 * to "—".
 *
 * The reconciliation is gated on the status's `context` matching the store's
 * current `connection.context` (when both are known). The TauriProvider's
 * `cluster-status` event is per-cluster, but a stale event from the previous
 * cluster could still land after the new cluster's `connect()` resolves. The
 * gate drops the stale event so a healthy cluster B doesn't briefly look
 * "error" / "unreachable" because cluster A went down.
 *
 * `status.context` is optional for backward compatibility with backends that
 * pre-date the context-tagging wire change: an untagged status is allowed
 * through (existing behavior preserved), and a tagged status with no
 * corresponding store context is allowed (the store context is null until the
 * first `connectTo()` resolves — covers the initial `cluster-status` emit
 * that fires before the connection is up).
 */

import type { ClusterStatus } from "../providers/types";
import type { AppState, ConnectionState } from "../store";

/**
 * The slice of `AppState` the reconciliation reads and writes.
 *
 * Decoupled from the full `useStore` so the function is unit-testable without
 * the React tree: a test can pass a hand-rolled `AppState` slice that records
 * what got written, instead of mutating the real Zustand singleton.
 */
export interface ClusterStatusState {
  connection: ConnectionState;
  setConnection: AppState["setConnection"];
  setClusterStatus: AppState["setClusterStatus"];
  setPodMetrics: AppState["setPodMetrics"];
  setNodeMetrics: AppState["setNodeMetrics"];
}

/**
 * Apply a `cluster-status` push to the store. The four side effects — writing
 * the status, flipping the connection phase on a connectivity change, and
 * clearing the cached pod/node metrics on a metrics-server disappearance — are
 * all gated on the status belonging to the store's current context.
 */
export function reconcileClusterStatus(
  status: ClusterStatus,
  state: ClusterStatusState,
): void {
  const { connection, setConnection, setClusterStatus, setPodMetrics, setNodeMetrics } = state;

  // Drop stale events from a previous cluster. The gate is a no-op when either
  // side is unknown (legacy untagged status, or the store is in the pre-first-
  // connect idle/connecting state), so the existing flows are preserved.
  if (
    typeof status.context === "string" &&
    connection.context != null &&
    status.context !== connection.context
  ) {
    return;
  }

  setClusterStatus(status);

  if (connection.phase === "connected" && !status.connected) {
    setConnection({ phase: "error", error: "cluster unreachable" });
  } else if (connection.phase === "error" && status.connected) {
    setConnection({ phase: "connected", error: undefined });
  }

  if (status.cpuPercent == null) {
    // metrics-server gone: drop cached usage so nothing stale lingers.
    setPodMetrics({});
    setNodeMetrics({});
  }
}

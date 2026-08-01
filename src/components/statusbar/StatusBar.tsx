/**
 * StatusBar — cluster health footer.
 *
 * Reads `ClusterStatus` and `WatchStatus` from the provider; renders
 * connected / disconnected, server latency, ready/total nodes, and the
 * "watch: N streams" counter.
 *
 * The values come from the `cluster-status` and `watch-status` events;
 * this component is purely presentational.
 */

import type { ClusterStatus } from "../../providers/types";

interface StatusBarProps {
  status: ClusterStatus;
  activeWatchers: number;
}

export function StatusBar({ status, activeWatchers }: StatusBarProps) {
  const conn = status.connected;
  return (
    <footer className="statusbar">
      <span className={`statusbar-pill ${conn ? "is-on" : "is-off"}`}>
        <span className="statusbar-dot" />
        {conn ? "connected" : "disconnected"}
      </span>
      <span className="statusbar-sep" />
      <span className="statusbar-item">
        <span className="statusbar-key">ver</span>
        <span className="statusbar-val">{status.version || "—"}</span>
      </span>
      <span className="statusbar-sep" />
      <span className="statusbar-item">
        <span className="statusbar-key">nodes</span>
        <span className="statusbar-val">
          {status.nodesReady}/{status.nodesTotal}
        </span>
      </span>
      <span className="statusbar-sep" />
      <span className="statusbar-item">
        <span className="statusbar-key">latency</span>
        <span className="statusbar-val">{status.apiLatencyMs}ms</span>
      </span>
      <span className="statusbar-spacer" />
      <span className="statusbar-item">
        <span className="statusbar-key">watch</span>
        <span className="statusbar-val">{activeWatchers}</span>
      </span>
    </footer>
  );
}

/**
 * useNodeMetricsSeries — accumulate a live time series of a node's CPU/memory
 * usage from the `nodeMetrics` store slice (fed by metrics.k8s.io, ~15s poll).
 *
 * The node Metrics tab used to scrape node-exporter directly for a rich series
 * (CPU rates, network, load, filesystems). Not every cluster runs
 * node-exporter, and the web shell never wired that path up — so the tab sat on
 * "waiting for the first samples" forever. metrics.k8s.io is already polled for
 * the Dashboard, so sampling it here gives a working CPU/MEM chart with zero
 * extra cluster setup, at the cost of the network/load/filesystem panels
 * (metrics.k8s.io doesn't carry those).
 *
 * The series is local to the hook instance (a ref), so it lives only while the
 * tab is mounted and resets on reopen — same lifetime semantics as the old
 * node-exporter scraper. Capped so a long-open tab doesn't grow unbounded.
 */

import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

export interface NodeMetricsPoint {
  ts: number;
  cpuPercent: number;
  memPercent: number;
  cpuMillis: number;
  memBytes: number;
  memTotalBytes: number;
}

const MAX_POINTS = 60; // ~15min at the 15s poll interval
const POLL_MS = 15_000;

export function useNodeMetricsSeries(node: string | undefined): NodeMetricsPoint[] {
  const nodeMetrics = useStore((s) => s.nodeMetrics);
  const seriesRef = useRef<NodeMetricsPoint[]>([]);
  const [tick, setTick] = useState(0);

  // Sample the current nodeMetrics snapshot on an interval. The backend already
  // polls metrics.k8s.io; this just reads the latest value it pushed, so there's
  // no extra cluster load — at worst a redundant point if the backend hasn't
  // updated yet (deduped by timestamp below).
  useEffect(() => {
    if (!node) {
      seriesRef.current = [];
      return;
    }
    const sample = () => {
      const m = nodeMetrics[node];
      if (!m) return;
      const now = Date.now();
      const last = seriesRef.current[seriesRef.current.length - 1];
      // Skip if the value hasn't changed since the last point (backend poll
      // hasn't refreshed yet) — avoids a flat staircase of duplicate samples.
      if (
        last &&
        last.cpuPercent === m.cpuPercent &&
        last.memPercent === m.memPercent &&
        now - last.ts < POLL_MS - 1
      ) {
        return;
      }
      seriesRef.current = [
        ...seriesRef.current,
        {
          ts: now,
          cpuPercent: m.cpuPercent,
          memPercent: m.memPercent,
          cpuMillis: m.cpuMillis,
          memBytes: m.memBytes,
          memTotalBytes: m.memTotalBytes,
        },
      ].slice(-MAX_POINTS);
      setTick((t) => t + 1);
    };
    // Take the first sample immediately so the chart isn't empty for a full
    // interval if data is already present.
    sample();
    const id = setInterval(sample, POLL_MS);
    return () => clearInterval(id);
    // nodeMetrics is read at sample time, not depended on for effect re-run —
    // we want one stable interval per node, reading the latest snapshot each tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]);

  // tick forces a re-render when the ref mutates; return the current snapshot.
  void tick;
  return node ? seriesRef.current : [];
}

/**
 * Mock metrics data generation.
 */

import type {
  DrainFailure,
  DrainProgress,
  NodeMetricsMap,
  NodeSample,
  NodeStatsError,
  PodMetricsMap,
  PodSample,
  Unsub,
} from '../types';
import { mockPodUsage } from './data';

/** Interval (ms) between mock log lines, matching the prototype's default. */
export const NODE_STATS_TICK_MS = 2000;

/** Clamp a value into a range. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export class MockMetricsMixin {
  protected nodeStatsCbs = new Set<(node: string, s: NodeSample) => void>();
  protected nodeStatsErrCbs = new Set<(e: NodeStatsError) => void>();
  protected podStatsCbs = new Set<(key: string, s: PodSample) => void>();
  protected drainCbs = new Set<(p: DrainProgress) => void>();
  protected nodeTimers = new Map<string, ReturnType<typeof setInterval>>();
  protected podTimers = new Map<string, ReturnType<typeof setInterval>>();

  async drainNode(node: string): Promise<void> {
    const total = 6;
    let evicted = 0;
    const failures: DrainFailure[] = [];
    const tick = () => {
      if (evicted < total - 1) {
        evicted += 1;
      } else if (failures.length === 0) {
        failures.push({
          pod: 'prod/yggdrasil-db-0',
          message:
            "blocked by a PodDisruptionBudget: Cannot evict pod as it would violate the pod's disruption budget.",
          blockedByPdb: true,
        });
      }
      const done = evicted >= total - 1 && failures.length > 0;
      for (const cb of this.drainCbs) cb({ node, evicted, total, failures: [...failures], done });
      if (!done) setTimeout(tick, 400);
    };
    setTimeout(tick, 300);
  }

  onPodMetrics(_cb: (metrics: PodMetricsMap) => void): Unsub {
    return () => {};
  }

  onNodeMetrics(_cb: (metrics: NodeMetricsMap) => void): Unsub {
    return () => {};
  }

  onDrainProgress(cb: (p: DrainProgress) => void): Unsub {
    this.drainCbs.add(cb);
    return () => {
      this.drainCbs.delete(cb);
    };
  }

  onNodeStats(cb: (node: string, s: NodeSample) => void): Unsub {
    this.nodeStatsCbs.add(cb);
    return () => {
      this.nodeStatsCbs.delete(cb);
    };
  }

  onNodeStatsError(cb: (e: NodeStatsError) => void): Unsub {
    this.nodeStatsErrCbs.add(cb);
    return () => {
      this.nodeStatsErrCbs.delete(cb);
    };
  }

  async nodeHistory(node: string): Promise<NodeSample[]> {
    if (node.endsWith('06')) return [];
    const step = 30_000;
    const points = 120;
    const now = Date.now();
    const total = 64 * 1024 ** 3;
    let cpu = 20 + (node.charCodeAt(node.length - 1) % 5) * 8;
    let used = total * 0.42;
    const out: NodeSample[] = [];
    for (let i = points; i > 0; i--) {
      cpu = clamp(cpu + (Math.random() - 0.5) * 10, 1, 98);
      used = clamp(used + (Math.random() - 0.5) * 8e8, total * 0.15, total * 0.9);
      const load = (cpu / 100) * 8;
      out.push({
        ts: now - i * step,
        cpuPercent: cpu,
        memUsedBytes: used,
        memTotalBytes: total,
        netRxBps: Math.max(0, 2e6 + (Math.random() - 0.5) * 1e6),
        netTxBps: Math.max(0, 5e5 + (Math.random() - 0.5) * 3e5),
        load1: load,
        load5: load * 0.9,
        load15: load * 0.8,
        filesystems: [],
      });
    }
    return out;
  }

  async podHistory(_namespace: string, _pod: string): Promise<PodSample[]> {
    const step = 30_000;
    const points = 120;
    const now = Date.now();
    let cpu = 150;
    let mem = 256 * 1024 * 1024;
    const out: PodSample[] = [];
    for (let i = points; i > 0; i--) {
      cpu = Math.max(10, cpu + (Math.random() - 0.5) * 80);
      mem = Math.max(64 * 1024 * 1024, mem + (Math.random() - 0.5) * 32 * 1024 * 1024);
      out.push({ ts: now - i * step, cpuMillis: Math.round(cpu), memBytes: Math.round(mem) });
    }
    return out;
  }

  async watchNodeStats(node: string): Promise<void> {
    if (this.nodeTimers.has(node)) return;

    if (node.endsWith('06')) {
      this.nodeStatsErrCbs.forEach((cb) =>
        cb({
          node,
          message: `no node-exporter pod found on ${node} — install one, or its port isn't 9100`,
        })
      );
      return;
    }

    let cpu = 20 + (node.charCodeAt(node.length - 1) % 5) * 8;
    let rx = 2e6;
    let tx = 5e5;
    const total = 64 * 1024 ** 3;
    let used = total * 0.42;

    const tick = () => {
      cpu = clamp(cpu + (Math.random() - 0.5) * 14, 1, 98);
      used = clamp(used + (Math.random() - 0.5) * 1e9, total * 0.15, total * 0.9);
      rx = Math.max(0, rx + (Math.random() - 0.5) * 1.2e6);
      tx = Math.max(0, tx + (Math.random() - 0.5) * 4e5);
      const load = (cpu / 100) * 8;
      const sample: NodeSample = {
        ts: Date.now(),
        cpuPercent: cpu,
        memUsedBytes: used,
        memTotalBytes: total,
        netRxBps: rx,
        netTxBps: tx,
        load1: load,
        load5: load * 0.9,
        load15: load * 0.8,
        filesystems: [
          { mountpoint: '/', usedBytes: 67e9, sizeBytes: 1920e9 },
          { mountpoint: '/home', usedBytes: 8e9, sizeBytes: 1861e9 },
          { mountpoint: '/mnt/data', usedBytes: 9078e9, sizeBytes: 20059e9 },
        ],
      };
      this.nodeStatsCbs.forEach((cb) => cb(node, sample));
    };
    setTimeout(tick, 200);
    this.nodeTimers.set(node, setInterval(tick, NODE_STATS_TICK_MS));
  }

  async unwatchNodeStats(node: string): Promise<void> {
    const t = this.nodeTimers.get(node);
    if (t !== undefined) {
      clearInterval(t);
      this.nodeTimers.delete(node);
    }
  }

  onPodStats(cb: (key: string, s: PodSample) => void): Unsub {
    this.podStatsCbs.add(cb);
    return () => {
      this.podStatsCbs.delete(cb);
    };
  }

  async watchPodStats(key: string): Promise<void> {
    if (this.podTimers.has(key)) return;

    const base = mockPodUsage(key);
    const baseCpu = base && base.cpuMillis > 0 ? base.cpuMillis : 40;
    const baseMem = base && base.memBytes > 0 ? base.memBytes : 96 * 1024 * 1024;
    let cpu = baseCpu;
    let mem = baseMem;

    const tick = () => {
      cpu = clamp(
        cpu + (Math.random() - 0.5) * baseCpu * 0.18,
        Math.max(1, baseCpu * 0.4),
        baseCpu * 2.1
      );
      mem = clamp(mem + (Math.random() - 0.5) * baseMem * 0.12, baseMem * 0.5, baseMem * 2.0);
      const sample: PodSample = {
        ts: Date.now(),
        cpuMillis: Math.round(cpu),
        memBytes: Math.round(mem),
      };
      this.podStatsCbs.forEach((cb) => cb(key, sample));
    };
    setTimeout(tick, 200);
    this.podTimers.set(key, setInterval(tick, NODE_STATS_TICK_MS));
  }

  async unwatchPodStats(key: string): Promise<void> {
    const t = this.podTimers.get(key);
    if (t !== undefined) {
      clearInterval(t);
      this.podTimers.delete(key);
    }
  }
}

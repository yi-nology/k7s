/**
 * Live data and metrics state slice.
 */

import type { StateCreator } from 'zustand';
import type {
  DrainProgress,
  ForwardInfo,
  NodeMetricsMap,
  NodeSample,
  PodMetricsMap,
  PodSample,
} from '../providers/types';
import type { AppState } from './types';
import { NODE_SAMPLE_CAP, POD_SAMPLE_CAP } from './types';

/** A copy of `obj` without `key`. */
function omit<T>(obj: Record<string, T>, key: string): Record<string, T> {
  if (!(key in obj)) return obj;
  const next = { ...obj };
  delete next[key];
  return next;
}

export interface DataSlice {
  // State
  podMetrics: PodMetricsMap;
  nodeMetrics: NodeMetricsMap;
  portForwards: ForwardInfo[];
  drains: Record<string, DrainProgress>;
  nodeSamples: Record<string, NodeSample[]>;
  nodeStatsErrors: Record<string, string>;
  podSamples: Record<string, PodSample[]>;

  // Actions
  setPodMetrics: (m: PodMetricsMap) => void;
  setNodeMetrics: (m: NodeMetricsMap) => void;
  setPortForwards: (list: ForwardInfo[]) => void;
  setDrain: (progress: DrainProgress) => void;
  seedNodeSamples: (node: string, history: NodeSample[]) => void;
  addNodeSample: (node: string, sample: NodeSample) => void;
  setNodeStatsError: (node: string, message: string) => void;
  addPodSample: (key: string, sample: PodSample) => void;
}

export const createDataSlice: StateCreator<AppState, [], [], DataSlice> = (set) => ({
  // Initial state
  podMetrics: {},
  nodeMetrics: {},
  portForwards: [],
  drains: {},
  nodeSamples: {},
  nodeStatsErrors: {},
  podSamples: {},

  // Actions
  setPodMetrics: (m) => set({ podMetrics: m }),
  setNodeMetrics: (m) => set({ nodeMetrics: m }),
  setPortForwards: (list) => set({ portForwards: list }),
  setDrain: (p) => set((s) => ({ drains: { ...s.drains, [p.node]: p } })),
  seedNodeSamples: (node, history) =>
    set((s) => {
      if (history.length === 0) return {};
      const live = s.nodeSamples[node] ?? [];
      const oldestLive = live.length ? live[0].ts : Infinity;
      const merged = history.filter((h) => h.ts < oldestLive).concat(live);
      return {
        nodeSamples: {
          ...s.nodeSamples,
          [node]: merged.length > NODE_SAMPLE_CAP ? merged.slice(-NODE_SAMPLE_CAP) : merged,
        },
      };
    }),
  addNodeSample: (node, sample) =>
    set((s) => {
      const next = (s.nodeSamples[node] ?? []).concat(sample);
      return {
        nodeSamples: {
          ...s.nodeSamples,
          [node]: next.length > NODE_SAMPLE_CAP ? next.slice(-NODE_SAMPLE_CAP) : next,
        },
        nodeStatsErrors: omit(s.nodeStatsErrors, node),
      };
    }),
  setNodeStatsError: (node, message) =>
    set((s) => ({ nodeStatsErrors: { ...s.nodeStatsErrors, [node]: message } })),
  addPodSample: (key, sample) =>
    set((s) => {
      const next = (s.podSamples[key] ?? []).concat(sample);
      return {
        podSamples: {
          ...s.podSamples,
          [key]: next.length > POD_SAMPLE_CAP ? next.slice(-POD_SAMPLE_CAP) : next,
        },
      };
    }),
});

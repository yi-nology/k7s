/**
 * Tests for MetricsTab — the metrics detail tab.
 *
 * Covers: no-selection state, waiting-for-samples state, error state,
 * rendering with samples (node-exporter path).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { useStore } from '../../store';
import { MetricsTab } from './MetricsTab';
import {
  render,
  cleanup,
  createMockRow,
  
  type RenderResult,
} from '../../test/componentUtils';
import type { NodeSample } from '../../providers/types';

// Mock IS_TAURI to control which path renders.
vi.mock('../../providers', () => ({
  IS_TAURI: true,
}));

// Mock PlotChart — renders a simple div with the title.
vi.mock('./PlotChart', () => ({
  Plot: ({ title }: any) =>
    createElement('div', { 'data-testid': 'plot' }, title || ''),
  useHostPlotColors: () => ({
    accent: '#000',
    accent2: '#111',
    ok: '#222',
    warn: '#333',
    err: '#444',
    grid: '#555',
    axis: '#666',
    surface: '#777',
  }),
}));

// Mock the hooks.
vi.mock('../../hooks/useNodeStats', () => ({
  useNodeStats: vi.fn(),
}));

vi.mock('../../hooks/useNodeMetricsSeries', () => ({
  useNodeMetricsSeries: vi.fn(() => []),
}));

// Mock the theme module — use importOriginal to preserve other exports needed by store.
vi.mock('../../lib/theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/theme')>();
  return {
    ...actual,
    withAlpha: (color: string, _alpha: number) => color,
  };
});

let view: RenderResult;

function resetStore() {
  useStore.setState({
    selectedRow: null,
    nodeSamples: {},
    nodeStatsErrors: {},
  });
}

function makeNodeSample(overrides: Partial<NodeSample> = {}): NodeSample {
  return {
    ts: Date.now(),
    cpuPercent: 42.5,
    memUsedBytes: 4 * 1024 * 1024 * 1024,
    memTotalBytes: 16 * 1024 * 1024 * 1024,
    netRxBps: 1_000_000,
    netTxBps: 500_000,
    load1: 1.5,
    load5: 2.0,
    load15: 1.8,
    filesystems: [
      { mountpoint: '/', usedBytes: 50 * 1024 * 1024 * 1024, sizeBytes: 100 * 1024 * 1024 * 1024 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('MetricsTab', () => {
  describe('no selection', () => {
    it('renders nothing when no row is selected', () => {
      useStore.setState({ selectedRow: null });
      view = render(<MetricsTab />);
      expect(view.container.innerHTML).toBe('');
    });
  });

  describe('waiting for samples', () => {
    it('shows waiting message when no samples exist', () => {
      const row = createMockRow({ uid: 'node-1', name: 'worker-1' });
      useStore.setState({
        selectedRow: row,
        nodeSamples: {},
        nodeStatsErrors: {},
      });
      view = render(<MetricsTab />);
      expect(view.queryByText(/Waiting/i)).not.toBeNull();
    });
  });

  describe('error state', () => {
    it('shows error when node stats have an error', () => {
      const row = createMockRow({ uid: 'node-1', name: 'worker-1' });
      useStore.setState({
        selectedRow: row,
        nodeSamples: {},
        nodeStatsErrors: { 'worker-1': 'no node-exporter' },
      });
      view = render(<MetricsTab />);
      expect(view.queryByText('no node-exporter')).not.toBeNull();
    });
  });

  describe('with samples', () => {
    it('renders plots when samples exist', () => {
      const row = createMockRow({ uid: 'node-1', name: 'worker-1' });
      const samples = [makeNodeSample()];
      useStore.setState({
        selectedRow: row,
        nodeSamples: { 'worker-1': samples },
        nodeStatsErrors: {},
      });
      view = render(<MetricsTab />);
      const plots = view.container.querySelectorAll('[data-testid="plot"]');
      // Should have: CPU, MEM, Network, Load, Filesystems = 5 plots
      expect(plots.length).toBeGreaterThanOrEqual(4);
    });

    it('renders CPU plot with percentage', () => {
      const row = createMockRow({ uid: 'node-1', name: 'worker-1' });
      const samples = [makeNodeSample({ cpuPercent: 42.5 })];
      useStore.setState({
        selectedRow: row,
        nodeSamples: { 'worker-1': samples },
        nodeStatsErrors: {},
      });
      view = render(<MetricsTab />);
      expect(view.queryByText(/42\.5%/)).not.toBeNull();
    });

    it('renders load averages', () => {
      const row = createMockRow({ uid: 'node-1', name: 'worker-1' });
      const samples = [makeNodeSample({ load1: 1.5, load5: 2.0, load15: 1.8 })];
      useStore.setState({
        selectedRow: row,
        nodeSamples: { 'worker-1': samples },
        nodeStatsErrors: {},
      });
      view = render(<MetricsTab />);
      expect(view.queryByText(/1\.50/)).not.toBeNull();
      expect(view.queryByText(/2\.00/)).not.toBeNull();
      expect(view.queryByText(/1\.80/)).not.toBeNull();
    });
  });
});

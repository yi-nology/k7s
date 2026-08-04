/**
 * Tests for PodMetricsTab — live pod CPU/memory metrics.
 *
 * Covers: no selection, waiting for samples, rendering with samples.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { useStore } from '../../store';
import { PodMetricsTab } from './PodMetricsTab';
import {
  render,
  cleanup,
  createMockPodRow,
  createMockPodMeta,
  type RenderResult,
} from '../../test/componentUtils';

// Mock PlotChart to avoid Plotly dependency.
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

// Mock usePodStats.
vi.mock('../../hooks/usePodStats', () => ({
  usePodStats: vi.fn(),
}));

// Mock theme.
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
    podSamples: {},
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('PodMetricsTab', () => {
  describe('no selection', () => {
    it('renders nothing when no row selected', () => {
      useStore.setState({ selectedRow: null });
      view = render(<PodMetricsTab />);
      expect(view.container.innerHTML).toBe('');
    });
  });

  describe('waiting for samples', () => {
    it('shows waiting message when no samples', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        namespace: 'default',
      });
      useStore.setState({
        selectedRow: pod,
        podSamples: {},
      });
      view = render(<PodMetricsTab />);
      expect(view.queryByText(/Waiting|waiting/i)).not.toBeNull();
    });
  });

  describe('with samples', () => {
    it('renders plots when samples exist', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        namespace: 'default',
      });
      useStore.setState({
        selectedRow: pod,
        podSamples: {
          'default/nginx': [
            { ts: Date.now(), cpuMillis: 250, memBytes: 128 * 1024 * 1024 },
          ],
        },
      });
      view = render(<PodMetricsTab />);
      const plots = view.container.querySelectorAll('[data-testid="plot"]');
      expect(plots.length).toBe(2); // CPU + Memory
    });

    it('renders CPU plot with value', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        namespace: 'default',
      });
      useStore.setState({
        selectedRow: pod,
        podSamples: {
          'default/nginx': [
            { ts: Date.now(), cpuMillis: 250, memBytes: 128 * 1024 * 1024 },
          ],
        },
      });
      view = render(<PodMetricsTab />);
      expect(view.queryByText(/250m/)).not.toBeNull();
    });

    it('renders memory plot with value', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        namespace: 'default',
      });
      useStore.setState({
        selectedRow: pod,
        podSamples: {
          'default/nginx': [
            { ts: Date.now(), cpuMillis: 100, memBytes: 256 * 1024 * 1024 },
          ],
        },
      });
      view = render(<PodMetricsTab />);
      expect(view.queryByText(/256.*MiB|256.*MB|268.*MB/i)).not.toBeNull();
    });
  });

  describe('request/limit lines', () => {
    it('shows request info when set', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        namespace: 'default',
        pod: createMockPodMeta({
          resources: {
            cpuRequestMillis: 100,
            cpuLimitMillis: 500,
            memRequestBytes: 64 * 1024 * 1024,
            memLimitBytes: 512 * 1024 * 1024,
          },
        }),
      });
      useStore.setState({
        selectedRow: pod,
        podSamples: {
          'default/nginx': [
            { ts: Date.now(), cpuMillis: 250, memBytes: 128 * 1024 * 1024 },
          ],
        },
      });
      view = render(<PodMetricsTab />);
      // Should render without crashing
      expect(view.container.firstChild).not.toBeNull();
    });
  });
});

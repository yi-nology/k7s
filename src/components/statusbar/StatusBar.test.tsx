/**
 * Tests for StatusBar — the status bar (Design §5).
 *
 * Covers: connection indicator, cluster name, API latency, nodes ready,
 * CPU/MEM percentages, kubectl context, dash fallback for null metrics.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store';
import type { ClusterStatus } from '../../providers/types';
import { StatusBar } from './StatusBar';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

function resetStore() {
  useStore.setState({
    connection: { phase: 'connected', context: 'minikube', clusterName: 'my-cluster' },
    clusterStatus: null,
    settings: useStore.getState().settings,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('StatusBar', () => {
  describe('connection indicator', () => {
    it('renders the cluster name', () => {
      view = render(<StatusBar />);
      expect(view.queryByText('my-cluster')).not.toBeNull();
    });

    it('falls back to context name when no cluster name', () => {
      useStore.setState({
        connection: { phase: 'connected', context: 'minikube', clusterName: null },
      });
      view = render(<StatusBar />);
      expect(view.queryByText('minikube')).not.toBeNull();
    });

    it('falls back to k7s when no connection info', () => {
      useStore.setState({
        connection: { phase: 'idle', context: null, clusterName: null },
      });
      view = render(<StatusBar />);
      expect(view.queryByText('k7s')).not.toBeNull();
    });

    it('shows green dot when connected', () => {
      useStore.setState({
        connection: { phase: 'connected', context: 'minikube', clusterName: 'my-cluster' },
      });
      view = render(<StatusBar />);
      const dot = view.container.querySelector('[class*="clusterDot"]');
      expect(dot).not.toBeNull();
      expect((dot as HTMLElement).style.background).toContain('var(--status-ok)');
    });

    it('shows red dot when not connected', () => {
      useStore.setState({
        connection: { phase: 'error', context: 'minikube', clusterName: 'my-cluster' },
      });
      view = render(<StatusBar />);
      const dot = view.container.querySelector('[class*="clusterDot"]');
      expect(dot).not.toBeNull();
      expect((dot as HTMLElement).style.background).toContain('var(--status-err)');
    });
  });

  describe('cluster metrics', () => {
    it('shows API latency when status is available', () => {
      const status: ClusterStatus = {
        connected: true,
        version: 'v1.28.0',
        apiLatencyMs: 42,
        nodesReady: 3,
        nodesTotal: 3,
        cpuPercent: 25,
        memPercent: 60,
      };
      useStore.setState({ clusterStatus: status });
      view = render(<StatusBar />);
      expect(view.queryByText('42ms')).not.toBeNull();
    });

    it('shows dash when API latency is null', () => {
      useStore.setState({ clusterStatus: null });
      view = render(<StatusBar />);
      // When clusterStatus is null, api is null, so we get "—"
      expect(view.queryByText('—')).not.toBeNull();
    });

    it('shows node ready count', () => {
      const status: ClusterStatus = {
        connected: true,
        version: 'v1.28.0',
        apiLatencyMs: 10,
        nodesReady: 2,
        nodesTotal: 3,
        cpuPercent: null,
        memPercent: null,
      };
      useStore.setState({ clusterStatus: status });
      view = render(<StatusBar />);
      // The ready/total is rendered as {ready}/{total} inside a <b> tag
      const boldEls = view.container.querySelectorAll('b');
      const readyEl = Array.from(boldEls).find((el) => el.textContent === '2/3');
      expect(readyEl).toBeDefined();
    });

    it('shows CPU percentage when available', () => {
      const status: ClusterStatus = {
        connected: true,
        version: 'v1.28.0',
        apiLatencyMs: 10,
        nodesReady: 3,
        nodesTotal: 3,
        cpuPercent: 45,
        memPercent: null,
      };
      useStore.setState({ clusterStatus: status });
      view = render(<StatusBar />);
      expect(view.queryByText('45%')).not.toBeNull();
    });

    it('shows MEM percentage when available', () => {
      const status: ClusterStatus = {
        connected: true,
        version: 'v1.28.0',
        apiLatencyMs: 10,
        nodesReady: 3,
        nodesTotal: 3,
        cpuPercent: null,
        memPercent: 72,
      };
      useStore.setState({ clusterStatus: status });
      view = render(<StatusBar />);
      expect(view.queryByText('72%')).not.toBeNull();
    });

    it('shows dash for CPU/MEM when null', () => {
      useStore.setState({ clusterStatus: null });
      view = render(<StatusBar />);
      // Multiple dashes for api, cpu, mem, and ctx
      const dashes = view.queryAllByText('—');
      expect(dashes.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('kubectl context', () => {
    it('shows the kubectl context', () => {
      useStore.setState({
        connection: { phase: 'connected', context: 'production-ctx', clusterName: 'prod' },
      });
      view = render(<StatusBar />);
      expect(view.queryByText('production-ctx')).not.toBeNull();
    });

    it('shows dash when no context', () => {
      useStore.setState({
        connection: { phase: 'idle', context: null, clusterName: null },
      });
      view = render(<StatusBar />);
      expect(view.queryByText('—')).not.toBeNull();
    });
  });
});

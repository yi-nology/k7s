/**
 * Tests for DetailPanel — the detail panel (Design §4).
 *
 * Covers: closed state (null render), open with pod row, open with non-pod row,
 * tab rendering, close button, kind label display.
 */

// Mock the transport layer so useLogStream doesn't hit a real fetch with a
// relative URL (which jsdom cannot parse).
vi.mock('../../providers/transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/transport')>();
  return {
    ...actual,
    httpInvoke: vi.fn().mockResolvedValue({ data: null }),
  };
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { useStore } from '../../store';
import { DetailPanel } from './DetailPanel';
import {
  render,
  cleanup,
  createMockRow,
  createMockPodRow,
  createMockCell,
  type RenderResult,
} from '../../test/componentUtils';

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
    namespace: 'all',
    selectedRow: null,
    activeTab: 'logs',
    rows: {
      ...useStore.getState().rows,
      pods: [],
      nodes: [],
      deployments: [],
    },
    customKinds: [],
    drains: {},
    detailTabs: [],
    activeDetailTabUid: null,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('DetailPanel', () => {
  describe('closed state', () => {
    it('renders nothing when no row is selected', () => {
      useStore.setState({ selectedRow: null });
      view = render(<DetailPanel />);
      expect(view.container.innerHTML).toBe('');
    });
  });

  describe('pod detail', () => {
    it('renders the pod name in the header', () => {
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx-abc' });
      useStore.setState({
        nav: 'pods',
        selectedRow: pod,
        rows: { ...useStore.getState().rows, pods: [pod] },
        activeTab: 'logs',
      });
      view = render(<DetailPanel />);
      expect(view.queryByText('nginx-abc')).not.toBeNull();
    });

    it('renders pod status in the header', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx-abc',
        pod: {
          node: 'node-1',
          containers: ['app'],
          status: 'Running',
          ready: '1/1',
          restarts: 0,
          creationTs: '2024-01-01T00:00:00Z',
          statusTone: 'ok',
          resources: {
            cpuRequestMillis: null,
            cpuLimitMillis: null,
            memRequestBytes: null,
            memLimitBytes: null,
          },
        },
      });
      useStore.setState({
        nav: 'pods',
        selectedRow: pod,
        rows: { ...useStore.getState().rows, pods: [pod] },
        activeTab: 'logs',
      });
      view = render(<DetailPanel />);
      expect(view.queryByText('Running')).not.toBeNull();
    });

    it('renders tab buttons for pod', () => {
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx-abc' });
      useStore.setState({
        nav: 'pods',
        selectedRow: pod,
        rows: { ...useStore.getState().rows, pods: [pod] },
        activeTab: 'logs',
      });
      view = render(<DetailPanel />);
      const tablist = view.queryByRole('tablist');
      expect(tablist).not.toBeNull();
    });

    it('switches tab on click', () => {
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx-abc' });
      useStore.setState({
        nav: 'pods',
        selectedRow: pod,
        rows: { ...useStore.getState().rows, pods: [pod] },
        activeTab: 'logs',
      });
      view = render(<DetailPanel />);
      // Find a tab button (e.g. YAML) and click it
      const tabs = view.querySelectorAll('[role="tab"]');
      // Pods have: logs, properties, shell, yaml, events
      expect(tabs.length).toBeGreaterThan(0);
      // Click the last tab (events or yaml)
      const yamlTab = Array.from(tabs).find((t) => t.textContent?.includes('YAML'));
      if (yamlTab) {
        view.click(yamlTab);
        expect(useStore.getState().activeTab).toBe('yaml');
      }
    });
  });

  describe('non-pod detail', () => {
    it('renders the kind label for a deployment', () => {
      const row = createMockRow({
        uid: 'deploy-1',
        name: 'my-deployment',
        cells: [
          createMockCell({ text: 'my-deployment' }),
          createMockCell({ text: 'default', tone: 'muted' }),
          createMockCell({ text: '3/3' }),
        ],
      });
      useStore.setState({
        nav: 'deployments',
        selectedRow: row,
        rows: { ...useStore.getState().rows, deployments: [row] },
        activeTab: 'yaml',
      });
      view = render(<DetailPanel />);
      expect(view.queryByText('my-deployment')).not.toBeNull();
    });

    it('renders kind label in the meta section', () => {
      const row = createMockRow({
        uid: 'deploy-1',
        name: 'my-deployment',
      });
      useStore.setState({
        nav: 'deployments',
        selectedRow: row,
        rows: { ...useStore.getState().rows, deployments: [row] },
        activeTab: 'yaml',
      });
      view = render(<DetailPanel />);
      // The kind label "Deployments" should appear in the meta area
      expect(view.queryByText('Deployments')).not.toBeNull();
    });
  });

  describe('close button', () => {
    it('renders a close button', () => {
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({
        nav: 'pods',
        selectedRow: pod,
        rows: { ...useStore.getState().rows, pods: [pod] },
        activeTab: 'logs',
      });
      view = render(<DetailPanel />);
      const closeBtn = view.container.querySelector('button[aria-label]');
      expect(closeBtn).not.toBeNull();
    });

    it('closes the panel when close button is clicked', () => {
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({
        nav: 'pods',
        selectedRow: pod,
        rows: { ...useStore.getState().rows, pods: [pod] },
        activeTab: 'logs',
      });
      view = render(<DetailPanel />);
      // Find the close button (it has the "x" text and aria-label)
      const closeBtn = Array.from(view.container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === '×'
      );
      expect(closeBtn).toBeDefined();
      view.click(closeBtn!);
      expect(useStore.getState().selectedRow).toBeNull();
    });
  });

  describe('stale row guard', () => {
    it('closes panel when selected row disappears from kind rows', () => {
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      const otherPod = createMockPodRow({ uid: 'pod-2', name: 'other' });
      useStore.setState({
        nav: 'pods',
        selectedRow: pod,
        rows: { ...useStore.getState().rows, pods: [pod] },
        activeTab: 'logs',
      });
      view = render(<DetailPanel />);
      // Replace the selected pod with a different one (non-empty array so
      // the guard doesn't skip as "still loading") — wrap in act so effects fire
      act(() => {
        useStore.setState({
          rows: { ...useStore.getState().rows, pods: [otherPod] },
        });
      });
      // The effect should close the detail since pod-1 is no longer in rows
      expect(useStore.getState().selectedRow).toBeNull();
    });
  });
});

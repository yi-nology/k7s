/**
 * Tests for NodePodsTab — pods tab on node detail panel.
 *
 * Covers: no node selected, empty pods, pod list, metrics display,
 * sorting by CPU, click navigation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { NodePodsTab } from './NodePodsTab';
import {
  render,
  cleanup,
  createMockRow,
  createMockPodRow,
  
  createMockPodMeta,
  type RenderResult,
} from '../../test/componentUtils';

let view: RenderResult;

function resetStore() {
  useStore.setState({
    selectedRow: null,
    rows: { ...useStore.getState().rows, pods: [] },
    podMetrics: {},
    navigateTo: vi.fn(),
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('NodePodsTab', () => {
  describe('no node selected', () => {
    it('shows no node message when no selection', () => {
      useStore.setState({ selectedRow: null });
      view = render(<NodePodsTab />);
      expect(view.queryByText(/No node selected/)).not.toBeNull();
    });
  });

  describe('empty pods', () => {
    it('shows empty message when no pods on node', () => {
      const node = createMockRow({ uid: 'node-1', name: 'worker-1' });
      useStore.setState({
        selectedRow: node,
        rows: { ...useStore.getState().rows, pods: [] },
      });
      view = render(<NodePodsTab />);
      expect(view.queryByText(/No pods scheduled/)).not.toBeNull();
    });
  });

  describe('with pods', () => {
    it('renders pod list', () => {
      const node = createMockRow({ uid: 'node-1', name: 'worker-1' });
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        namespace: 'default',
        pod: createMockPodMeta({ node: 'worker-1' }),
      });
      useStore.setState({
        selectedRow: node,
        rows: { ...useStore.getState().rows, pods: [pod] },
      });
      view = render(<NodePodsTab />);
      expect(view.queryByText('nginx')).not.toBeNull();
    });

    it('shows namespace for each pod', () => {
      const node = createMockRow({ uid: 'node-1', name: 'worker-1' });
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        namespace: 'production',
        pod: createMockPodMeta({ node: 'worker-1' }),
      });
      useStore.setState({
        selectedRow: node,
        rows: { ...useStore.getState().rows, pods: [pod] },
      });
      view = render(<NodePodsTab />);
      expect(view.queryByText('production')).not.toBeNull();
    });

    it('shows pod status', () => {
      const node = createMockRow({ uid: 'node-1', name: 'worker-1' });
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ node: 'worker-1', status: 'Running' }),
      });
      useStore.setState({
        selectedRow: node,
        rows: { ...useStore.getState().rows, pods: [pod] },
      });
      view = render(<NodePodsTab />);
      expect(view.queryByText('Running')).not.toBeNull();
    });

    it('shows CPU metrics when available', () => {
      const node = createMockRow({ uid: 'node-1', name: 'worker-1' });
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        namespace: 'default',
        pod: createMockPodMeta({ node: 'worker-1' }),
      });
      useStore.setState({
        selectedRow: node,
        rows: { ...useStore.getState().rows, pods: [pod] },
        podMetrics: { 'default/nginx': { cpuMillis: 250, memBytes: 128 * 1024 * 1024 } },
      });
      view = render(<NodePodsTab />);
      // Should show formatted CPU (250m)
      expect(view.queryByText(/250m/)).not.toBeNull();
    });

    it('filters pods to selected node only', () => {
      const node = createMockRow({ uid: 'node-1', name: 'worker-1' });
      const podOnNode = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ node: 'worker-1' }),
      });
      const podOnOther = createMockPodRow({
        uid: 'pod-2',
        name: 'redis',
        pod: createMockPodMeta({ node: 'worker-2' }),
      });
      useStore.setState({
        selectedRow: node,
        rows: { ...useStore.getState().rows, pods: [podOnNode, podOnOther] },
      });
      view = render(<NodePodsTab />);
      expect(view.queryByText('nginx')).not.toBeNull();
      expect(view.queryByText('redis')).toBeNull();
    });
  });

  describe('summary', () => {
    it('shows pod count in summary', () => {
      const node = createMockRow({ uid: 'node-1', name: 'worker-1' });
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        namespace: 'default',
        pod: createMockPodMeta({ node: 'worker-1' }),
      });
      useStore.setState({
        selectedRow: node,
        rows: { ...useStore.getState().rows, pods: [pod] },
      });
      view = render(<NodePodsTab />);
      expect(view.queryByText(/1.*pods/)).not.toBeNull();
    });
  });

  describe('navigation', () => {
    it('calls navigateTo when pod name clicked', () => {
      const navigateTo = vi.fn();
      const node = createMockRow({ uid: 'node-1', name: 'worker-1' });
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        namespace: 'default',
        pod: createMockPodMeta({ node: 'worker-1' }),
      });
      useStore.setState({
        selectedRow: node,
        rows: { ...useStore.getState().rows, pods: [pod] },
        navigateTo,
      });
      view = render(<NodePodsTab />);
      const podLink = view.queryByText('nginx');
      expect(podLink).not.toBeNull();
      view.click(podLink!);
      expect(navigateTo).toHaveBeenCalledWith({
        kind: 'pods',
        namespace: 'default',
        name: 'nginx',
      });
    });
  });
});

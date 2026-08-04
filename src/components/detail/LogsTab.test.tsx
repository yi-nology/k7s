/**
 * Tests for LogsTab — the logs detail tab.
 *
 * Covers: rendering log lines, search filter, follow/pause toggle,
 * timestamp toggle, container cycling, footer display.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { useStore } from '../../store';
import { LogsTab } from './LogsTab';
import {
  render,
  cleanup,
  createMockPodRow,
  createMockPodMeta,
  type RenderResult,
} from '../../test/componentUtils';
import type { LogLine } from '../../providers/types';

// Mock the log stream hook (no-op — we feed lines via store).
vi.mock('../../hooks/useLogStream', () => ({
  useLogStream: vi.fn(),
}));

// Mock the provider for saveLogs.
vi.mock('../../providers', () => ({
  getProvider: () => ({
    saveLogs: vi.fn().mockResolvedValue(null),
  }),
}));

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
    selectedRow: null,
    logBuffer: [],
    logSearch: '',
    showTimestamps: false,
    following: true,
    containerIndex: 0,
    logPrevious: false,
    logSince: 'all',
    setLogSearch: (q: string) => useStore.setState({ logSearch: q }),
    toggleTimestamps: () =>
      useStore.setState((s) => ({ showTimestamps: !s.showTimestamps })),
    toggleFollow: () =>
      useStore.setState((s) => ({ following: !s.following })),
    cycleContainer: () =>
      useStore.setState((s) => {
        const pod = s.selectedRow;
        const containers = pod?.pod?.containers ?? [];
        const options = containers.length > 1 ? [...containers, ''] : containers;
        return { containerIndex: (s.containerIndex + 1) % Math.max(options.length, 1) };
      }),
    setLogPrevious: (v: boolean) => useStore.setState({ logPrevious: v }),
    setLogSince: (v: any) => useStore.setState({ logSince: v }),
  });
}

const MOCK_LINES: LogLine[] = [
  { ts: '10:00:01.000', level: 'INFO', msg: 'Server started' },
  { ts: '10:00:02.000', level: 'WARN', msg: 'High memory usage' },
  { ts: '10:00:03.000', level: 'ERROR', msg: 'Connection refused' },
  { ts: '10:00:04.000', level: 'DEBUG', msg: 'Retry attempt 1' },
];

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('LogsTab', () => {
  describe('log line rendering', () => {
    it('renders log messages from the buffer', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app'] }),
      });
      useStore.setState({ selectedRow: pod, logBuffer: MOCK_LINES });
      view = render(<LogsTab />);
      expect(view.queryByText('Server started')).not.toBeNull();
      expect(view.queryByText('High memory usage')).not.toBeNull();
      expect(view.queryByText('Connection refused')).not.toBeNull();
    });

    it('renders log levels', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app'] }),
      });
      useStore.setState({ selectedRow: pod, logBuffer: MOCK_LINES });
      view = render(<LogsTab />);
      expect(view.queryByText('INFO')).not.toBeNull();
      expect(view.queryByText('WARN')).not.toBeNull();
      expect(view.queryByText('ERROR')).not.toBeNull();
      expect(view.queryByText('DEBUG')).not.toBeNull();
    });
  });

  describe('search filter', () => {
    it('renders the search input', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app'] }),
      });
      useStore.setState({ selectedRow: pod, logBuffer: MOCK_LINES });
      view = render(<LogsTab />);
      const input = view.container.querySelector('input');
      expect(input).not.toBeNull();
    });

    it('filters log lines by search query', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app'] }),
      });
      useStore.setState({ selectedRow: pod, logBuffer: MOCK_LINES, logSearch: 'ERROR' });
      view = render(<LogsTab />);
      // Only ERROR line should be visible
      expect(view.queryByText('Connection refused')).not.toBeNull();
      expect(view.queryByText('Server started')).toBeNull();
    });

    it('filters by message content', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app'] }),
      });
      useStore.setState({ selectedRow: pod, logBuffer: MOCK_LINES, logSearch: 'memory' });
      view = render(<LogsTab />);
      expect(view.queryByText('High memory usage')).not.toBeNull();
      expect(view.queryByText('Server started')).toBeNull();
    });
  });

  describe('follow/pause', () => {
    it('shows pause button when following', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app'] }),
      });
      useStore.setState({ selectedRow: pod, logBuffer: MOCK_LINES, following: true });
      view = render(<LogsTab />);
      expect(view.queryByText(/pause/)).not.toBeNull();
    });

    it('shows follow button when paused', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app'] }),
      });
      useStore.setState({ selectedRow: pod, logBuffer: MOCK_LINES, following: false });
      view = render(<LogsTab />);
      expect(view.queryByText(/follow/)).not.toBeNull();
    });

    it('toggles follow state on click', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app'] }),
      });
      useStore.setState({ selectedRow: pod, logBuffer: MOCK_LINES, following: true });
      view = render(<LogsTab />);
      const pauseBtn = view.queryByText(/pause/);
      expect(pauseBtn).not.toBeNull();
      view.click(pauseBtn!);
      expect(useStore.getState().following).toBe(false);
    });
  });

  describe('timestamp toggle', () => {
    it('toggles timestamp display on click', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app'] }),
      });
      useStore.setState({ selectedRow: pod, logBuffer: MOCK_LINES, showTimestamps: false });
      view = render(<LogsTab />);
      const tsBtn = view.queryByText('ts');
      expect(tsBtn).not.toBeNull();
      view.click(tsBtn!);
      expect(useStore.getState().showTimestamps).toBe(true);
    });
  });

  describe('footer', () => {
    it('displays the line count', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app'] }),
      });
      useStore.setState({ selectedRow: pod, logBuffer: MOCK_LINES });
      view = render(<LogsTab />);
      expect(view.queryByText(/4 lines/)).not.toBeNull();
    });

    it('displays the container name', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app'] }),
      });
      useStore.setState({ selectedRow: pod, logBuffer: MOCK_LINES });
      view = render(<LogsTab />);
      expect(view.queryByText(/container.*app/)).not.toBeNull();
    });

    it('displays streaming status when following', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app'] }),
      });
      useStore.setState({ selectedRow: pod, logBuffer: MOCK_LINES, following: true });
      view = render(<LogsTab />);
      expect(view.queryByText(/streaming/)).not.toBeNull();
    });

    it('displays paused status when not following', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app'] }),
      });
      useStore.setState({ selectedRow: pod, logBuffer: MOCK_LINES, following: false });
      view = render(<LogsTab />);
      expect(view.queryByText(/paused/)).not.toBeNull();
    });
  });

  describe('container cycling', () => {
    it('shows container button', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app', 'sidecar'] }),
      });
      useStore.setState({ selectedRow: pod, logBuffer: MOCK_LINES });
      view = render(<LogsTab />);
      // Should show the container cycling button
      const containerBtn = view.container.querySelector('button');
      expect(containerBtn).not.toBeNull();
    });
  });
});

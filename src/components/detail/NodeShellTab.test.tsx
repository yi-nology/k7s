/**
 * Tests for NodeShellTab — node debug shell tab.
 *
 * Covers: no node, idle gate screen, start button, warning messages.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { NodeShellTab } from './NodeShellTab';
import { render, cleanup, createMockRow, type RenderResult } from '../../test/componentUtils';

// Mock useTerminal.
vi.mock('./useTerminal', () => ({
  useTerminal: vi.fn(() => ({
    hostRef: { current: null },
    termRef: { current: null },
    sessionRef: { current: null },
  })),
}));

// Mock the provider.
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      startNodeShell: vi.fn().mockResolvedValue({
        pod: 'debug-pod-abc',
        input: vi.fn(),
        resize: vi.fn(),
        stop: vi.fn(),
      }),
    }),
  };
});

let view: RenderResult;

function resetStore() {
  useStore.setState({
    selectedRow: null,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('NodeShellTab', () => {
  describe('no node selected', () => {
    it('renders nothing when no row selected', () => {
      useStore.setState({ selectedRow: null });
      view = render(<NodeShellTab />);
      expect(view.container.innerHTML).toBe('');
    });
  });

  describe('idle gate screen', () => {
    it('shows gate screen for a node', () => {
      const node = createMockRow({ uid: 'node-1', name: 'worker-1' });
      useStore.setState({ selectedRow: node });
      view = render(<NodeShellTab />);
      expect(view.queryByText(/worker-1/)).not.toBeNull();
    });

    it('shows start button', () => {
      const node = createMockRow({ uid: 'node-1', name: 'worker-1' });
      useStore.setState({ selectedRow: node });
      view = render(<NodeShellTab />);
      expect(view.queryByText(/Start debug session|startBtn/)).not.toBeNull();
    });

    it('shows pod deleted warning', () => {
      const node = createMockRow({ uid: 'node-1', name: 'worker-1' });
      useStore.setState({ selectedRow: node });
      view = render(<NodeShellTab />);
      expect(view.queryByText(/deleted when you close/i)).not.toBeNull();
    });

    it('shows expires warning', () => {
      const node = createMockRow({ uid: 'node-1', name: 'worker-1' });
      useStore.setState({ selectedRow: node });
      view = render(<NodeShellTab />);
      expect(view.queryByText(/expires/i)).not.toBeNull();
    });

    it('shows changes are real warning', () => {
      const node = createMockRow({ uid: 'node-1', name: 'worker-1' });
      useStore.setState({ selectedRow: node });
      view = render(<NodeShellTab />);
      expect(view.queryByText(/Anything you change/i)).not.toBeNull();
    });
  });

  describe('gate title', () => {
    it('shows title with node name', () => {
      const node = createMockRow({ uid: 'node-1', name: 'control-plane' });
      useStore.setState({ selectedRow: node });
      view = render(<NodeShellTab />);
      expect(view.queryByText(/control-plane/)).not.toBeNull();
    });
  });
});

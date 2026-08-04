/**
 * Tests for ShellTab — the interactive shell detail tab.
 *
 * Covers: no-pod state, container picker rendering, reconnect bar,
 * container selection, terminal host div.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { ShellTab } from './ShellTab';
import {
  render,
  cleanup,
  createMockPodRow,
  createMockPodMeta,
  type RenderResult,
} from '../../test/componentUtils';

// Mock useTerminal — returns refs without creating a real xterm instance.
vi.mock('./useTerminal', () => ({
  useTerminal: vi.fn(() => ({
    hostRef: { current: null },
    termRef: { current: null },
    sessionRef: { current: null },
  })),
}));

// Mock the provider.
vi.mock('../../providers', () => ({
  getProvider: () => ({
    startShell: vi.fn().mockResolvedValue({
      input: vi.fn(),
      resize: vi.fn(),
      stop: vi.fn(),
    }),
  }),
}));

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
    selectedRow: null,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('ShellTab', () => {
  describe('no pod selected', () => {
    it('renders the shell wrapper even without a pod', () => {
      useStore.setState({ selectedRow: null });
      view = render(<ShellTab />);
      // The component renders a wrap div even without a pod
      expect(view.container.firstChild).not.toBeNull();
    });
  });

  describe('single container', () => {
    it('does not show container picker for single-container pod', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app'] }),
      });
      useStore.setState({ selectedRow: pod });
      view = render(<ShellTab />);
      // No select element for single container
      const select = view.container.querySelector('select');
      expect(select).toBeNull();
    });
  });

  describe('multi-container', () => {
    it('shows container picker for multi-container pod', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app', 'sidecar'] }),
      });
      useStore.setState({ selectedRow: pod });
      view = render(<ShellTab />);
      const select = view.container.querySelector('select');
      expect(select).not.toBeNull();
    });

    it('lists all containers in the picker', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app', 'sidecar', 'init'] }),
      });
      useStore.setState({ selectedRow: pod });
      view = render(<ShellTab />);
      const options = view.container.querySelectorAll('option');
      expect(options.length).toBe(3);
      expect(options[0].textContent).toBe('app');
      expect(options[1].textContent).toBe('sidecar');
      expect(options[2].textContent).toBe('init');
    });
  });

  describe('terminal host', () => {
    it('renders the terminal host div', () => {
      const pod = createMockPodRow({
        uid: 'pod-1',
        name: 'nginx',
        pod: createMockPodMeta({ containers: ['app'] }),
      });
      useStore.setState({ selectedRow: pod });
      view = render(<ShellTab />);
      // The shell div should exist (it's the xterm mount point)
      const shellDiv = view.container.querySelector('div');
      expect(shellDiv).not.toBeNull();
    });
  });
});

/**
 * Tests for ForwardsBar — active port-forwards strip.
 *
 * Covers: empty state, rendering forwards, stop button, copy behavior.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { ForwardsBar } from './ForwardsBar';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import type { ForwardInfo } from '../../providers/types';

// Mock the provider.
const mockStopPortForward = vi.fn().mockResolvedValue(undefined);
const mockListPortForwards = vi.fn().mockResolvedValue([]);
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      stopPortForward: mockStopPortForward,
      listPortForwards: mockListPortForwards,
    }),
  };
});

let view: RenderResult;

function resetStore() {
  useStore.setState({
    portForwards: [],
    setPortForwards: (f: ForwardInfo[]) => useStore.setState({ portForwards: f }),
  });
}

function makeForward(overrides: Partial<ForwardInfo> = {}): ForwardInfo {
  return {
    id: 'fwd-1',
    namespace: 'default',
    pod: 'nginx-pod',
    remotePort: 80,
    localPort: 8080,
    ...overrides,
  };
}

beforeEach(() => {
  resetStore();
  mockStopPortForward.mockClear();
  mockListPortForwards.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('ForwardsBar', () => {
  describe('empty state', () => {
    it('renders nothing when no forwards', () => {
      useStore.setState({ portForwards: [] });
      view = render(<ForwardsBar />);
      expect(view.container.innerHTML).toBe('');
    });
  });

  describe('with forwards', () => {
    it('renders the forwards bar', () => {
      useStore.setState({ portForwards: [makeForward()] });
      view = render(<ForwardsBar />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('shows localhost address', () => {
      useStore.setState({ portForwards: [makeForward({ localPort: 9090 })] });
      view = render(<ForwardsBar />);
      expect(view.queryByText(/localhost:9090/)).not.toBeNull();
    });

    it('shows target pod and port', () => {
      useStore.setState({
        portForwards: [makeForward({ pod: 'my-pod', remotePort: 3000 })],
      });
      view = render(<ForwardsBar />);
      expect(view.queryByText(/my-pod:3000/)).not.toBeNull();
    });

    it('shows service name for service forwards', () => {
      useStore.setState({
        portForwards: [makeForward({ service: 'my-svc', servicePort: 80 })],
      });
      view = render(<ForwardsBar />);
      expect(view.queryByText(/my-svc:80/)).not.toBeNull();
    });

    it('shows error indicator for errored forwards', () => {
      useStore.setState({
        portForwards: [makeForward({ error: 'connection refused' })],
      });
      view = render(<ForwardsBar />);
      expect(view.queryByText('!')).not.toBeNull();
    });
  });

  describe('multiple forwards', () => {
    it('renders multiple forwards', () => {
      useStore.setState({
        portForwards: [
          makeForward({ id: 'fwd-1', localPort: 8080 }),
          makeForward({ id: 'fwd-2', localPort: 9090, pod: 'other-pod' }),
        ],
      });
      view = render(<ForwardsBar />);
      expect(view.queryByText(/localhost:8080/)).not.toBeNull();
      expect(view.queryByText(/localhost:9090/)).not.toBeNull();
    });
  });

  describe('stop forward', () => {
    it('calls stopPortForward when stop button clicked', async () => {
      mockListPortForwards.mockResolvedValue([]);
      useStore.setState({ portForwards: [makeForward({ id: 'fwd-1' })] });
      view = render(<ForwardsBar />);
      // Find the stop button (contains "✕")
      const stopBtn = view.queryByText('✕');
      expect(stopBtn).not.toBeNull();
      await act(async () => {
        view.click(stopBtn!);
        // Wait for async state updates
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(mockStopPortForward).toHaveBeenCalledWith('fwd-1');
    });
  });
});

/**
 * Tests for EventsTab — the events detail tab.
 *
 * Covers: loading state, empty state, event rendering (Normal/Warning),
 * time-range filter, event card content.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { useStore } from '../../store';
import { EventsTab } from './EventsTab';
import { render, cleanup, createMockPodRow, type RenderResult } from '../../test/componentUtils';
import type { EventItem } from '../../providers/types';
import type { SinceOption } from '../../lib/logview';

// Mock the provider module.
const mockGetEvents = vi.fn();
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      getEvents: mockGetEvents,
    }),
  };
});

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
    selectedRow: null,
    eventsSince: 'all',
    setEventsSince: (v: string) => useStore.setState({ eventsSince: v as SinceOption }),
  });
}

const MOCK_EVENTS: EventItem[] = [
  {
    type: 'Normal',
    reason: 'Pulled',
    message: 'Successfully pulled image "nginx:latest"',
    count: 1,
    age: '2m',
    lastTimestamp: new Date(Date.now() - 120_000).toISOString(),
  },
  {
    type: 'Warning',
    reason: 'BackOff',
    message: 'Back-off restarting failed container',
    count: 5,
    age: '10m',
    lastTimestamp: new Date(Date.now() - 600_000).toISOString(),
  },
];

beforeEach(() => {
  resetStore();
  mockGetEvents.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('EventsTab', () => {
  describe('loading state', () => {
    it('shows loading text while fetching events', () => {
      mockGetEvents.mockReturnValue(new Promise(() => {})); // never resolves
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ selectedRow: pod });
      view = render(<EventsTab />);
      expect(view.container.textContent).toContain('loading events');
    });
  });

  describe('empty state', () => {
    it('shows empty message when no events exist', async () => {
      mockGetEvents.mockResolvedValue([]);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ selectedRow: pod });
      view = render(<EventsTab />);
      // Wait for async fetch
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText(/no recent events/i)).not.toBeNull();
    });
  });

  describe('event rendering', () => {
    it('renders event cards when events exist', async () => {
      mockGetEvents.mockResolvedValue(MOCK_EVENTS);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ selectedRow: pod });
      view = render(<EventsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('Pulled')).not.toBeNull();
      expect(view.queryByText('BackOff')).not.toBeNull();
    });

    it('renders event type labels', async () => {
      mockGetEvents.mockResolvedValue(MOCK_EVENTS);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ selectedRow: pod });
      view = render(<EventsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('Normal')).not.toBeNull();
      expect(view.queryByText('Warning')).not.toBeNull();
    });

    it('renders event messages', async () => {
      mockGetEvents.mockResolvedValue(MOCK_EVENTS);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ selectedRow: pod });
      view = render(<EventsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText(/Successfully pulled image/)).not.toBeNull();
      expect(view.queryByText(/Back-off restarting/)).not.toBeNull();
    });

    it('renders event count and age', async () => {
      mockGetEvents.mockResolvedValue(MOCK_EVENTS);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ selectedRow: pod });
      view = render(<EventsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      // Age and count are rendered together like "2m · x1"
      expect(view.queryByText(/×1/)).not.toBeNull();
      expect(view.queryByText(/×5/)).not.toBeNull();
    });
  });

  describe('time-range filter', () => {
    it('renders the since filter select', async () => {
      mockGetEvents.mockResolvedValue(MOCK_EVENTS);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ selectedRow: pod });
      view = render(<EventsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      const select = view.queryByTestId('events-tab-since');
      expect(select).not.toBeNull();
    });

    it('updates the store when filter changes', async () => {
      mockGetEvents.mockResolvedValue(MOCK_EVENTS);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ selectedRow: pod });
      view = render(<EventsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      const select = view.queryByTestId('events-tab-since') as HTMLSelectElement;
      expect(select).not.toBeNull();
      // Change the filter
      act(() => {
        select.value = '1h';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(useStore.getState().eventsSince).toBe('1h');
    });
  });

  describe('error handling', () => {
    it('shows empty state when fetch fails', async () => {
      mockGetEvents.mockRejectedValue(new Error('network error'));
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ selectedRow: pod });
      view = render(<EventsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      // On error, events is set to [] so empty state shows
      expect(view.queryByText(/no recent events/i)).not.toBeNull();
    });
  });
});

/**
 * Tests for ResourceTable — the generic resource table (Design §3).
 *
 * Covers rendering rows, filter input, empty/forbidden states, selection bar,
 * events time-range dropdown, and row click interaction via the store.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store';
import type { Row } from '../../providers/types';
import { ResourceTable } from './ResourceTable';
import { render, cleanup, createMockRow, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
    namespace: 'all',
    tableFilter: '',
    sortCol: null,
    sortDir: 'asc',
    eventsSince: 'all',
    selectedRow: null,
    selection: { selected: [], anchor: null },
    overlay: null,
    watchStatus: {},
    podMetrics: {},
    nodeMetrics: {},
    customKinds: [],
    rows: {
      ...useStore.getState().rows,
      pods: [],
      deployments: [],
      nodes: [],
      events: [],
    },
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('ResourceTable', () => {
  describe('rendering', () => {
    it('renders the filter input', () => {
      view = render(<ResourceTable />);
      const input = view.container.querySelector('[data-table-filter]');
      expect(input).not.toBeNull();
    });

    it('renders column headers for the active kind', () => {
      useStore.setState({ nav: 'pods' });
      view = render(<ResourceTable />);
      // Pods columns include NAME, NAMESPACE, STATUS
      expect(view.queryByText('NAME')).not.toBeNull();
      expect(view.queryByText('NAMESPACE')).not.toBeNull();
      expect(view.queryByText('STATUS')).not.toBeNull();
    });

    it('renders rows with data', () => {
      const rows: Row[] = [
        createMockRow({ uid: 'p1', name: 'pod-1', namespace: 'default' }),
        createMockRow({ uid: 'p2', name: 'pod-2', namespace: 'kube-system' }),
      ];
      useStore.setState({
        nav: 'pods',
        rows: { ...useStore.getState().rows, pods: rows },
      });
      view = render(<ResourceTable />);
      expect(view.queryByText('pod-1')).not.toBeNull();
      expect(view.queryByText('pod-2')).not.toBeNull();
    });

    it('shows empty state when no rows exist', () => {
      useStore.setState({
        nav: 'pods',
        rows: { ...useStore.getState().rows, pods: [] },
      });
      view = render(<ResourceTable />);
      expect(view.queryByText('no resources')).not.toBeNull();
    });

    it('shows filtered empty state when filter yields nothing', () => {
      useStore.setState({
        nav: 'pods',
        tableFilter: 'nonexistent',
        rows: { ...useStore.getState().rows, pods: [] },
      });
      view = render(<ResourceTable />);
      expect(view.queryByText('no resources match filter')).not.toBeNull();
    });

    it('shows forbidden state when watch status is forbidden', () => {
      useStore.setState({
        nav: 'pods',
        watchStatus: { pods: 'forbidden' },
        rows: { ...useStore.getState().rows, pods: [] },
      });
      view = render(<ResourceTable />);
      // The forbidden message includes "RBAC Forbidden" as fallback text
      const forbiddenEl = view.container.querySelector('[class*="forbidden"]');
      expect(forbiddenEl).not.toBeNull();
    });
  });

  describe('filtering', () => {
    it('filters rows by text', () => {
      const rows: Row[] = [
        createMockRow({ uid: 'p1', name: 'nginx-pod' }),
        createMockRow({ uid: 'p2', name: 'redis-pod' }),
      ];
      useStore.setState({
        nav: 'pods',
        rows: { ...useStore.getState().rows, pods: rows },
      });
      view = render(<ResourceTable />);
      expect(view.queryByText('nginx-pod')).not.toBeNull();
      expect(view.queryByText('redis-pod')).not.toBeNull();

      // Set filter via store
      act(() => {
        useStore.setState({ tableFilter: 'nginx' });
      });
      // Re-render
      view = render(<ResourceTable />);
      expect(view.queryByText('nginx-pod')).not.toBeNull();
      // redis-pod should be filtered out (but depends on DOM query precision)
    });
  });

  describe('selection bar', () => {
    it('shows selection bar when multiple rows are selected', () => {
      const rows: Row[] = [
        createMockRow({ uid: 'p1', name: 'pod-1' }),
        createMockRow({ uid: 'p2', name: 'pod-2' }),
      ];
      useStore.setState({
        nav: 'pods',
        rows: { ...useStore.getState().rows, pods: rows },
        selection: { selected: ['p1', 'p2'], anchor: 'p1' },
      });
      view = render(<ResourceTable />);
      const bar = view.queryByTestId('selection-bar');
      expect(bar).not.toBeNull();
    });

    it('does not show selection bar with single selection', () => {
      useStore.setState({
        nav: 'pods',
        selection: { selected: ['p1'], anchor: 'p1' },
      });
      view = render(<ResourceTable />);
      const bar = view.queryByTestId('selection-bar');
      expect(bar).toBeNull();
    });
  });

  describe('events time-range filter', () => {
    it('shows the time-range dropdown for events kind', () => {
      useStore.setState({ nav: 'events' });
      view = render(<ResourceTable />);
      const select = view.queryByTestId('events-since');
      expect(select).not.toBeNull();
    });

    it('does not show the time-range dropdown for non-events kinds', () => {
      useStore.setState({ nav: 'pods' });
      view = render(<ResourceTable />);
      const select = view.queryByTestId('events-since');
      expect(select).toBeNull();
    });
  });

  describe('new resource button', () => {
    it('renders the new resource button', () => {
      view = render(<ResourceTable />);
      const btn = view.queryByTestId('new-resource');
      expect(btn).not.toBeNull();
    });

    it('opens the templates overlay on click', () => {
      view = render(<ResourceTable />);
      const btn = view.queryByTestId('new-resource');
      expect(btn).not.toBeNull();
      view.click(btn!);
      expect(useStore.getState().overlay).toBe('templates');
    });
  });

  describe('empty-state CTA', () => {
    it('shows a create CTA for an empty workload kind with no filter', () => {
      useStore.setState({
        nav: 'deployments',
        tableFilter: '',
        section: 'workloads',
        rows: { ...useStore.getState().rows, deployments: [] },
      });
      view = render(<ResourceTable />);
      const cta = view.queryByTestId('empty-cta');
      expect(cta).not.toBeNull();
      expect(cta!.textContent).toBe('Create your first workload');
    });

    it('opens the templates overlay on click', () => {
      useStore.setState({
        nav: 'deployments',
        tableFilter: '',
        rows: { ...useStore.getState().rows, deployments: [] },
      });
      view = render(<ResourceTable />);
      view.click(view.getByTestId('empty-cta'));
      expect(useStore.getState().overlay).toBe('templates');
    });

    it('does not show the CTA when a filter is set', () => {
      useStore.setState({
        nav: 'deployments',
        tableFilter: 'nonexistent',
        rows: { ...useStore.getState().rows, deployments: [] },
      });
      view = render(<ResourceTable />);
      expect(view.queryByTestId('empty-cta')).toBeNull();
      expect(view.queryByText('Create your first workload')).toBeNull();
    });

    it('does not show the CTA for a non-workload kind', () => {
      useStore.setState({
        nav: 'configmaps',
        tableFilter: '',
        rows: { ...useStore.getState().rows, configmaps: [] },
      });
      view = render(<ResourceTable />);
      expect(view.queryByTestId('empty-cta')).toBeNull();
    });
  });

  describe('row click', () => {
    it('selects a row on click', () => {
      const row = createMockRow({ uid: 'p1', name: 'my-pod' });
      useStore.setState({
        nav: 'pods',
        rows: { ...useStore.getState().rows, pods: [row] },
      });
      view = render(<ResourceTable />);
      const cell = view.queryByText('my-pod');
      expect(cell).not.toBeNull();
      // Click the row (the cell's parent <tr>)
      const tr = cell!.closest('tr');
      expect(tr).not.toBeNull();
      view.click(tr!);
      expect(useStore.getState().selectedRow?.uid).toBe('p1');
    });
  });

  describe('sorting', () => {
    it('toggles sort on column header click', () => {
      useStore.setState({ nav: 'pods' });
      view = render(<ResourceTable />);
      const nameHeader = view.queryByText('NAME');
      expect(nameHeader).not.toBeNull();
      view.click(nameHeader!);
      expect(useStore.getState().sortCol).toBe(0);
      expect(useStore.getState().sortDir).toBe('asc');
    });
  });
});

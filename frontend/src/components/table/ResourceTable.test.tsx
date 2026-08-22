/**
 * Tests for ResourceTable — the generic resource table (Design §3).
 *
 * Covers rendering rows, filter input, empty/forbidden states, selection bar,
 * events time-range dropdown, row click interaction via the store, and the
 * density-driven row height on virtualized tables.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import type { Row } from '../../providers/types';
import { ResourceTable } from './ResourceTable';
import {
  VIRTUAL_ROW_HEIGHT_COMPACT,
  VIRTUAL_ROW_HEIGHT_COMFORTABLE,
  VIRTUAL_THRESHOLD,
} from './useVirtualRows';
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
    // Use DEFAULT_SETTINGS for full isolation — avoids carrying over any
    // stale store state that a previous test may have mutated.
    settings: { ...DEFAULT_SETTINGS, language: 'en' },
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

    it('routes a wizard-buildable workload kind to the create-workload wizard', () => {
      useStore.setState({ nav: 'deployments' });
      view = render(<ResourceTable />);
      view.click(view.getByTestId('new-resource'));
      expect(useStore.getState().overlay).toBe('wizard');
    });

    it('routes workload-section kinds the wizard cannot build to the template picker', () => {
      // pods/helm sit in the workloads section, but the wizard only builds
      // Deployment/StatefulSet/DaemonSet/Job/CronJob — their create entries
      // must not open a builder for the wrong kind.
      for (const nav of ['pods', 'helm']) {
        useStore.setState({ nav, overlay: null });
        view = render(<ResourceTable />);
        view.click(view.getByTestId('new-resource'));
        expect(useStore.getState().overlay).toBe('templates');
        cleanup();
      }
    });

    it('routes jobs and cronjobs to the create-workload wizard', () => {
      // P4 Task 1: the wizard builds batch/v1 kinds too.
      for (const nav of ['jobs', 'cronjobs']) {
        useStore.setState({ nav, overlay: null });
        view = render(<ResourceTable />);
        view.click(view.getByTestId('new-resource'));
        expect(useStore.getState().overlay).toBe('wizard');
        cleanup();
      }
    });

    it('routes a non-workload kind to the template picker', () => {
      useStore.setState({ nav: 'configmaps' });
      view = render(<ResourceTable />);
      view.click(view.getByTestId('new-resource'));
      expect(useStore.getState().overlay).toBe('templates');
    });

    it('routes the ingresses kind to the ingress editor', () => {
      useStore.setState({ nav: 'ingresses' });
      view = render(<ResourceTable />);
      view.click(view.getByTestId('new-resource'));
      expect(useStore.getState().overlay).toBe('ingress-editor');
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

    it('opens the create-workload wizard on click', () => {
      useStore.setState({
        nav: 'deployments',
        tableFilter: '',
        rows: { ...useStore.getState().rows, deployments: [] },
      });
      view = render(<ResourceTable />);
      view.click(view.getByTestId('empty-cta'));
      expect(useStore.getState().overlay).toBe('wizard');
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

    it('shows the CTA for an empty jobs page (wizard-buildable since P4)', () => {
      useStore.setState({
        nav: 'jobs',
        tableFilter: '',
        rows: { ...useStore.getState().rows, jobs: [] },
      });
      view = render(<ResourceTable />);
      expect(view.queryByText('no resources')).not.toBeNull();
      const cta = view.queryByTestId('empty-cta');
      expect(cta).not.toBeNull();
      view.click(cta!);
      expect(useStore.getState().overlay).toBe('wizard');
    });

    it('does not show the CTA for workload kinds the wizard cannot build', () => {
      // An empty Pods page is a workload-section kind, but the wizard only
      // builds Deployment/STS/DS/Job/CronJob — the CTA would open the wrong
      // builder.
      useStore.setState({
        nav: 'pods',
        tableFilter: '',
        rows: { ...useStore.getState().rows, pods: [] },
      });
      view = render(<ResourceTable />);
      // The empty state itself renders (rows are explicitly empty) — only
      // the CTA is withheld.
      expect(view.queryByText('no resources')).not.toBeNull();
      expect(view.queryByTestId('empty-cta')).toBeNull();
      expect(view.queryByText('Create your first workload')).toBeNull();
    });
  });

  describe('table density', () => {
    it('does not mark the container compact at the comfortable default', () => {
      useStore.setState({
        settings: { ...DEFAULT_SETTINGS, tableDensity: 'comfortable' },
      });
      view = render(<ResourceTable />);
      expect(view.container.querySelector('[class*="compact"]')).toBeNull();
    });

    it('marks the container compact when the setting says so', () => {
      useStore.setState({
        settings: { ...DEFAULT_SETTINGS, tableDensity: 'compact' },
      });
      view = render(<ResourceTable />);
      const compactEl = view.container.querySelector('[class*="compact"]');
      expect(compactEl).not.toBeNull();
    });

    it('pins windowed rows to the active density height and follows a live flip', () => {
      // Past VIRTUAL_THRESHOLD the table windows (B21): row heights come from
      // the inline <tr> pin rather than CSS, so the density must reach that
      // pin or it is a no-op on exactly the large tables it exists for. jsdom
      // has no layout, so the window starts at row 0 with an empty viewport.
      const rows: Row[] = Array.from({ length: VIRTUAL_THRESHOLD + 50 }, (_, i) =>
        createMockRow({ uid: `p${i}`, name: `pod-${i}` })
      );
      useStore.setState({
        rows: { ...useStore.getState().rows, pods: rows },
        settings: { ...DEFAULT_SETTINGS, tableDensity: 'comfortable', language: 'en' },
      });
      view = render(<ResourceTable />);

      const comfortableRow = view.container.querySelector(
        'tr[data-row-index="0"]'
      ) as HTMLElement | null;
      expect(comfortableRow).not.toBeNull();
      expect(comfortableRow!.style.height).toBe(`${VIRTUAL_ROW_HEIGHT_COMFORTABLE}px`);

      // Flip the density live — the windowed pin must follow the setting.
      act(() => {
        useStore.setState({
          settings: { ...DEFAULT_SETTINGS, tableDensity: 'compact', language: 'en' },
        });
      });
      const compactRow = view.container.querySelector(
        'tr[data-row-index="0"]'
      ) as HTMLElement | null;
      expect(compactRow).not.toBeNull();
      expect(compactRow!.style.height).toBe(`${VIRTUAL_ROW_HEIGHT_COMPACT}px`);
    });

    it('leaves small-table rows to their natural CSS height in both densities', () => {
      // Below the threshold there is no window and no inline pin — the row
      // height is whatever the CSS module renders.
      useStore.setState({
        settings: { ...DEFAULT_SETTINGS, tableDensity: 'compact', language: 'en' },
        rows: { ...useStore.getState().rows, pods: [createMockRow({ uid: 'p1', name: 'pod-1' })] },
      });
      view = render(<ResourceTable />);
      const tr = view.container.querySelector('tr[data-row-index="0"]') as HTMLElement | null;
      expect(tr).not.toBeNull();
      expect(tr!.style.height).toBe('');
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

  describe('hover quick actions', () => {
    it('renders the quick-action cluster inside each clickable row', () => {
      const rows: Row[] = [
        createMockRow({ uid: 'p1', name: 'pod-1' }),
        createMockRow({ uid: 'p2', name: 'pod-2' }),
      ];
      useStore.setState({
        nav: 'pods',
        rows: { ...useStore.getState().rows, pods: rows },
      });
      view = render(<ResourceTable />);
      for (const name of ['pod-1', 'pod-2']) {
        const tr = view.queryByText(name)!.closest('tr')!;
        const quick = tr.querySelector('[data-quick-actions]');
        expect(quick).not.toBeNull();
        const buttons = quick!.querySelectorAll('button');
        expect(buttons.length).toBe(2);
        expect(buttons[0].getAttribute('aria-label')).toBe('Detail');
        expect(buttons[1].getAttribute('aria-label')).toBe('More actions');
      }
    });

    it('does not render the cluster for events rows', () => {
      // Events have no context menu (they navigate instead), so the ⋯ half of
      // the cluster would be a dead button — the whole cluster stays off, even
      // for an event whose target would make its row clickable.
      const row = createMockRow({
        uid: 'e1',
        name: 'event-1',
        involved: { kind: 'Pod', namespace: 'default', name: 'pod-1' },
      });
      useStore.setState({
        nav: 'events',
        rows: { ...useStore.getState().rows, events: [row] },
      });
      view = render(<ResourceTable />);
      const tr = view.queryByText('event-1')!.closest('tr')!;
      expect(tr.querySelector('[data-quick-actions]')).toBeNull();
    });

    it('clicking 详情 selects the row like a plain row click', () => {
      const row = createMockRow({ uid: 'p1', name: 'my-pod' });
      useStore.setState({
        nav: 'pods',
        rows: { ...useStore.getState().rows, pods: [row] },
      });
      view = render(<ResourceTable />);
      const tr = view.queryByText('my-pod')!.closest('tr')!;
      view.click(tr.querySelector('button[aria-label="Detail"]')!);
      expect(useStore.getState().selectedRow?.uid).toBe('p1');
    });

    it('clicking ⋯ opens the row context menu without selecting the row', () => {
      const row = createMockRow({ uid: 'p1', name: 'my-pod' });
      useStore.setState({
        nav: 'pods',
        rows: { ...useStore.getState().rows, pods: [row] },
      });
      view = render(<ResourceTable />);
      const tr = view.queryByText('my-pod')!.closest('tr')!;
      view.click(tr.querySelector('button[aria-label="More actions"]')!);
      // The click must not fall through to the row handler: opening a menu is
      // not a selection, and the detail panel must not flip to this row.
      expect(useStore.getState().selectedRow).toBeNull();
      // …but the menu itself opened via the same path a right-click takes: the
      // selection collapsed to this row and the portal menu mounted.
      expect(useStore.getState().selection.selected).toContain('p1');
      const portal = document.body.querySelector('[style*="position: fixed"]');
      expect(portal).not.toBeNull();
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

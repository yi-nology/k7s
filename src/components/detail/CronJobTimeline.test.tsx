/**
 * Tests for CronJobTimeline — CronJob execution timeline.
 *
 * Covers: no selection, empty jobs, job rendering, status colors, click navigation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { CronJobTimeline } from './CronJobTimeline';
import {
  render,
  cleanup,
  createMockRow,
  createMockCell,
  type RenderResult,
} from '../../test/componentUtils';

let view: RenderResult;

function resetStore() {
  useStore.setState({
    selectedRow: null,
    rows: { ...useStore.getState().rows, jobs: [] },
    navigateTo: vi.fn(),
  });
}

function makeJobRow(overrides: Record<string, any> = {}) {
  return createMockRow({
    uid: overrides.uid ?? `job-${Math.random().toString(36).slice(2, 6)}`,
    name: overrides.name ?? 'my-cronjob-abc123',
    namespace: overrides.namespace ?? 'default',
    cells: overrides.cells ?? [
      createMockCell({ text: overrides.name ?? 'my-cronjob-abc123' }),
      createMockCell({ text: 'default', tone: 'muted' }),
      createMockCell({ text: '1/1', tone: 'ok' }),
      createMockCell({ text: '30s' }),
      createMockCell({ text: '2024-01-01T00:00:00Z', format: 'age' }),
    ],
    labels: { 'owner.cronjob': overrides.owner ?? 'my-cronjob' },
  });
}

function makeCronJobRow(overrides: Record<string, any> = {}) {
  return createMockRow({
    uid: overrides.uid ?? 'cronjob-1',
    name: overrides.name ?? 'my-cronjob',
    namespace: overrides.namespace ?? 'default',
    cells: overrides.cells ?? [
      createMockCell({ text: overrides.name ?? 'my-cronjob' }),
      createMockCell({ text: 'default', tone: 'muted' }),
      createMockCell({ text: '*/5 * * * *' }),
      createMockCell({ text: '2024-01-01T00:00:00Z', format: 'age' }),
      createMockCell({ text: '2024-01-01T00:05:00Z', format: 'age' }),
    ],
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('CronJobTimeline', () => {
  describe('no selection', () => {
    it('shows no selection message', () => {
      useStore.setState({ selectedRow: null });
      view = render(<CronJobTimeline />);
      expect(view.queryByText(/No CronJob selected/)).not.toBeNull();
    });
  });

  describe('with CronJob selected', () => {
    it('renders the timeline wrapper', () => {
      const cronJob = makeCronJobRow();
      useStore.setState({ selectedRow: cronJob });
      view = render(<CronJobTimeline />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('shows schedule info', () => {
      const cronJob = makeCronJobRow();
      useStore.setState({ selectedRow: cronJob });
      view = render(<CronJobTimeline />);
      expect(view.queryByText(/Schedule/)).not.toBeNull();
      expect(view.queryByText('*/5 * * * *')).not.toBeNull();
    });

    it('shows no jobs message when no matching jobs', () => {
      const cronJob = makeCronJobRow({ name: 'my-cronjob' });
      useStore.setState({
        selectedRow: cronJob,
        rows: { ...useStore.getState().rows, jobs: [] },
      });
      view = render(<CronJobTimeline />);
      expect(view.queryByText(/No Jobs found/)).not.toBeNull();
    });
  });

  describe('with matching jobs', () => {
    it('renders job dots when jobs exist', () => {
      const cronJob = makeCronJobRow({ name: 'my-cronjob' });
      const job = makeJobRow({ name: 'my-cronjob-abc123', owner: 'my-cronjob' });
      useStore.setState({
        selectedRow: cronJob,
        rows: { ...useStore.getState().rows, jobs: [job] },
      });
      view = render(<CronJobTimeline />);
      // Should render the job name somewhere
      expect(view.queryByText(/my-cronjob-abc123/)).not.toBeNull();
    });

    it('shows summary counts', () => {
      const cronJob = makeCronJobRow({ name: 'my-cronjob' });
      const succeededJob = makeJobRow({
        uid: 'j1',
        name: 'my-cronjob-ok',
        owner: 'my-cronjob',
        cells: [
          createMockCell({ text: 'my-cronjob-ok' }),
          createMockCell({ text: 'default', tone: 'muted' }),
          createMockCell({ text: '1/1', tone: 'ok' }),
          createMockCell({ text: '30s' }),
          createMockCell({ text: '2024-01-01T00:00:00Z', format: 'age' }),
        ],
      });
      useStore.setState({
        selectedRow: cronJob,
        rows: { ...useStore.getState().rows, jobs: [succeededJob] },
      });
      view = render(<CronJobTimeline />);
      expect(view.queryByText(/Succeeded/)).not.toBeNull();
    });

    it('shows failed count', () => {
      const cronJob = makeCronJobRow({ name: 'my-cronjob' });
      const failedJob = makeJobRow({
        uid: 'j2',
        name: 'my-cronjob-fail',
        owner: 'my-cronjob',
        cells: [
          createMockCell({ text: 'my-cronjob-fail' }),
          createMockCell({ text: 'default', tone: 'muted' }),
          createMockCell({ text: '0/1', tone: 'err' }),
          createMockCell({ text: '5s' }),
          createMockCell({ text: '2024-01-01T00:00:00Z', format: 'age' }),
        ],
      });
      useStore.setState({
        selectedRow: cronJob,
        rows: { ...useStore.getState().rows, jobs: [failedJob] },
      });
      view = render(<CronJobTimeline />);
      expect(view.queryByText(/Failed/)).not.toBeNull();
    });
  });

  describe('navigation', () => {
    it('calls navigateTo when job clicked', () => {
      const navigateTo = vi.fn();
      const cronJob = makeCronJobRow({ name: 'my-cronjob' });
      const job = makeJobRow({
        uid: 'j1',
        name: 'my-cronjob-abc123',
        namespace: 'default',
        owner: 'my-cronjob',
      });
      useStore.setState({
        selectedRow: cronJob,
        rows: { ...useStore.getState().rows, jobs: [job] },
        navigateTo,
      });
      view = render(<CronJobTimeline />);
      const jobBtn = view.queryByText('my-cronjob-abc123');
      if (jobBtn) view.click(jobBtn);
      expect(navigateTo).toHaveBeenCalled();
    });
  });
});

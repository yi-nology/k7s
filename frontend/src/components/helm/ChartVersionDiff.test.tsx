/**
 * Tests for ChartVersionDiff — two-version comparison of library charts
 * (Chart.yaml / values.yaml via the shared LCS diff engine).
 *
 * Covers: two selects defaulting to the two most recent entries, the
 * parallel localChartDetail fetches, the version metadata line, `-`/`+`
 * diff lines with per-file stat summaries, the identical-files empty
 * state, re-selection refetching, and the close handoff.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { useStore } from '../../store';
import { ChartVersionDiff } from './ChartVersionDiff';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import { createMockSettings } from '../../test/types';
import { clearProviderQueryCache } from '../../hooks/useProviderQuery';
import type { LocalChartDetail, LocalChartEntry } from '../../providers/types';

function makeEntry(id: string, version: string, modifiedAt: string): LocalChartEntry {
  return {
    id,
    kind: 'tgz',
    name: 'demo',
    version,
    appVersion: version,
    description: 'demo chart',
    icon: '',
    path: `/data/charts/${id}`,
    sizeBytes: 1024,
    modifiedAt,
  };
}

/** Library order = most recent first (as localChartsList returns it). */
const charts: LocalChartEntry[] = [
  makeEntry('demo-2.0.0.tgz', '2.0.0', '2026-08-28T00:00:00Z'),
  makeEntry('demo-1.0.0.tgz', '1.0.0', '2026-08-20T00:00:00Z'),
  makeEntry('demo-0.9.0.tgz', '0.9.0', '2026-08-01T00:00:00Z'),
];

function makeDetail(entry: LocalChartEntry, chartYaml: string, valuesYaml: string): LocalChartDetail {
  return { entry, files: [], chartYaml, valuesYaml, readme: '' };
}

const details = new Map<string, LocalChartDetail>([
  [
    'demo-2.0.0.tgz',
    makeDetail(
      charts[0],
      'apiVersion: v2\nname: demo\nversion: 2.0.0\n',
      'replicaCount: 2\n'
    ),
  ],
  [
    'demo-1.0.0.tgz',
    makeDetail(
      charts[1],
      'apiVersion: v2\nname: demo\nversion: 1.0.0\n',
      'replicaCount: 1\n'
    ),
  ],
  [
    'demo-0.9.0.tgz',
    makeDetail(
      charts[2],
      'apiVersion: v2\nname: demo\nversion: 0.9.0\n',
      'replicaCount: 1\n'
    ),
  ],
]);

// vi.hoisted so the (hoisted) vi.mock factory can reference the fn.
const mocks = vi.hoisted(() => ({
  localChartDetail: vi.fn(),
}));

vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      localChartDetail: mocks.localChartDetail,
    }),
  };
});

let view: RenderResult;

function resetStore() {
  useStore.setState({ settings: createMockSettings({ language: 'en' }) });
}

/** Async settle helper — the harness has no waitFor. */
const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms));

/** Pick an option in one of the A/B selects. */
function choose(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  resetStore();
  // The query cache is module-level; a stale hit would skip the fetches
  // under test.
  clearProviderQueryCache();
  mocks.localChartDetail.mockReset().mockImplementation(async (id: string) => {
    const d = details.get(id);
    if (!d) throw new Error(`no such chart: ${id}`);
    return d;
  });
});

afterEach(() => {
  cleanup();
});

describe('ChartVersionDiff', () => {
  it('defaults the selects to the two most recent charts and fetches both details', async () => {
    view = render(<ChartVersionDiff charts={charts} onClose={vi.fn()} />);
    await settle();
    const selects = view.querySelectorAll('select') as HTMLSelectElement[];
    expect(selects.length).toBe(2);
    expect(selects[0].value).toBe('demo-2.0.0.tgz');
    expect(selects[1].value).toBe('demo-1.0.0.tgz');
    expect(mocks.localChartDetail).toHaveBeenCalledWith('demo-2.0.0.tgz');
    expect(mocks.localChartDetail).toHaveBeenCalledWith('demo-1.0.0.tgz');
  });

  it('shows the version metadata line, per-file headings and -/+ diff lines', async () => {
    view = render(<ChartVersionDiff charts={charts} onClose={vi.fn()} />);
    await settle();
    expect(view.queryByText('v2.0.0 → v1.0.0')).not.toBeNull();
    expect(view.queryByText('Chart.yaml')).not.toBeNull();
    expect(view.queryByText('values.yaml')).not.toBeNull();
    // Row textContent concatenates prefix + line text.
    expect(view.container.textContent).toContain('-version: 2.0.0');
    expect(view.container.textContent).toContain('+version: 1.0.0');
    expect(view.container.textContent).toContain('-replicaCount: 2');
    expect(view.container.textContent).toContain('+replicaCount: 1');
    // Per-block stat summaries: one added + one removed line each.
    expect(view.container.textContent).toContain('+1');
    expect(view.container.textContent).toContain('-1');
  });

  it('shows the identical empty state and no diff lines for equal content', async () => {
    const same = makeDetail(charts[0], 'apiVersion: v2\nname: demo\n', 'replicaCount: 1\n');
    mocks.localChartDetail.mockImplementation(async (id: string) =>
      id === 'demo-2.0.0.tgz' || id === 'demo-1.0.0.tgz' ? same : details.get(id)!
    );
    view = render(<ChartVersionDiff charts={charts} onClose={vi.fn()} />);
    await settle();
    expect(view.queryByText('The two versions render identical files')).not.toBeNull();
    expect(view.container.textContent).not.toContain('+');
  });

  it('refetches when a side is re-selected', async () => {
    view = render(<ChartVersionDiff charts={charts} onClose={vi.fn()} />);
    await settle();
    const selects = view.querySelectorAll('select') as HTMLSelectElement[];
    choose(selects[1], 'demo-0.9.0.tgz');
    await settle();
    expect(mocks.localChartDetail).toHaveBeenCalledWith('demo-0.9.0.tgz');
    expect(view.queryByText('v2.0.0 → v0.9.0')).not.toBeNull();
  });

  it('calls onClose from the close button', async () => {
    const onClose = vi.fn();
    view = render(<ChartVersionDiff charts={charts} onClose={onClose} />);
    await settle();
    view.click(view.getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

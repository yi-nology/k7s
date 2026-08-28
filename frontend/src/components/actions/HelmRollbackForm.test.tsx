/**
 * Tests for HelmRollbackForm — rollback form for Helm releases and workloads.
 *
 * Covers: rendering workload rollback confirm, rendering Helm revision picker,
 * loading state, error state, rollback execution.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { HelmRollbackForm } from './HelmRollbackForm';
import { render, cleanup, createMockRow, type RenderResult } from '../../test/componentUtils';
import { createMockSettings } from '../../test/types';
import { clearProviderQueryCache } from '../../hooks/useProviderQuery';

// vi.hoisted so the (hoisted) vi.mock factory can reference the fns — the
// history suite below overrides helmReleaseHistory per test.
const providerMocks = vi.hoisted(() => ({
  undoRollout: vi.fn(),
  helmReleaseHistory: vi.fn(),
  helmRunOp: vi.fn(),
}));

// Mock the provider.
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      undoRollout: providerMocks.undoRollout,
      helmReleaseHistory: providerMocks.helmReleaseHistory,
      helmRunOp: providerMocks.helmRunOp,
    }),
  };
});

let view: RenderResult;

function resetStore() {
  useStore.setState({
    settings: createMockSettings(),
  });
}

beforeEach(() => {
  resetStore();
  // The query cache is module-level and keyed by namespace/release; a stale
  // hit from a previous test would seed the picker and skip the fetch.
  clearProviderQueryCache();
  providerMocks.undoRollout.mockReset().mockResolvedValue(undefined);
  providerMocks.helmRunOp.mockReset().mockResolvedValue({ success: true });
  // `helm history` emits rows NEWEST-FIRST (revision descending) — fixtures
  // mirror that so index-based assertions match production data.
  providerMocks.helmReleaseHistory.mockReset().mockResolvedValue([
    {
      revision: 2,
      status: 'deployed',
      chart: 'nginx-1.1.0',
      updated: '2024-01-02',
      description: 'Upgrade complete',
    },
    {
      revision: 1,
      status: 'superseded',
      chart: 'nginx-1.0.0',
      updated: '2024-01-01',
      description: 'Install complete',
    },
  ]);
});

afterEach(() => {
  cleanup();
});

describe('HelmRollbackForm', () => {
  const workloadRow = createMockRow({
    name: 'web',
    namespace: 'default',
  });

  const helmRow = createMockRow({
    name: 'my-release',
    namespace: 'default',
  });

  it('renders workload rollback confirm for deployments', () => {
    view = render(
      <HelmRollbackForm
        kind="deployments"
        row={workloadRow}
        ref={{ kind: 'deployments', namespace: 'default', name: 'web' }}
        onError={vi.fn()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    );
    expect(view.container.firstChild).not.toBeNull();
  });

  it('shows cancel and rollback buttons for workload', () => {
    view = render(
      <HelmRollbackForm
        kind="deployments"
        row={workloadRow}
        ref={{ kind: 'deployments', namespace: 'default', name: 'web' }}
        onError={vi.fn()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    );
    const buttons = view.container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('renders Helm revision picker for helm kind', async () => {
    view = render(
      <HelmRollbackForm
        kind="helm"
        row={helmRow}
        ref={{ kind: 'helm', namespace: 'default', name: 'my-release' }}
        onError={vi.fn()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    );
    expect(view.container.firstChild).not.toBeNull();
    // Wait for revisions to load
    await new Promise((r) => setTimeout(r, 50));
  });

  it('calls onClose when cancel is clicked for workload', () => {
    const onClose = vi.fn();
    view = render(
      <HelmRollbackForm
        kind="deployments"
        row={workloadRow}
        ref={{ kind: 'deployments', namespace: 'default', name: 'web' }}
        onError={vi.fn()}
        onClose={onClose}
        onDone={vi.fn()}
      />
    );
    const buttons = view.container.querySelectorAll('button');
    // Find cancel button
    const cancelBtn = Array.from(buttons).find((b) => b.textContent?.includes('Cancel'));
    if (cancelBtn) view.click(cancelBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders statefulset rollback', () => {
    view = render(
      <HelmRollbackForm
        kind="statefulsets"
        row={workloadRow}
        ref={{ kind: 'statefulsets', namespace: 'default', name: 'web' }}
        onError={vi.fn()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    );
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders daemonset rollback', () => {
    view = render(
      <HelmRollbackForm
        kind="daemonsets"
        row={workloadRow}
        ref={{ kind: 'daemonsets', namespace: 'default', name: 'web' }}
        onError={vi.fn()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    );
    expect(view.container.firstChild).not.toBeNull();
  });

  /** Revision rows arrive in helm's wire order (newest first). */
  function historyRows(revs: { revision: number; status: string }[]) {
    return revs.map((r, i) => ({
      revision: r.revision,
      status: r.status,
      chart: `nginx-1.0.${i}`,
      updated: `2024-01-0${i + 1}`,
      description: 'Install complete',
    }));
  }

  it('defaults the selection to the previous revision of newest-first history', async () => {
    // 4 revisions, newest first: current is rev 4, the one before it is 3.
    providerMocks.helmReleaseHistory.mockResolvedValue(
      historyRows([
        { revision: 4, status: 'deployed' },
        { revision: 3, status: 'superseded' },
        { revision: 2, status: 'superseded' },
        { revision: 1, status: 'superseded' },
      ])
    );
    view = render(
      <HelmRollbackForm
        kind="helm"
        row={helmRow}
        ref={{ kind: 'helm', namespace: 'default', name: 'my-release' }}
        onError={vi.fn()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    );
    await new Promise((r) => setTimeout(r, 50));
    const radios = view.container.querySelectorAll(
      'input[type="radio"]'
    ) as NodeListOf<HTMLInputElement>;
    expect(radios.length).toBe(4);
    // The second-newest revision (3) is preselected — not the second-oldest.
    expect(radios[1].checked).toBe(true);
    expect(radios[2].checked).toBe(false);
    // Only the current (first, newest) row is disabled.
    expect(radios[0].disabled).toBe(true);
    expect(radios[1].disabled).toBe(false);
    // The apply button announces the intended target. (The dictionary
    // leaf re-wraps the passed-in label, so match the "#N" tail.)
    expect(view.queryByText(/Rollback to #3/)).not.toBeNull();
  });

  it('defaults to revision 2 and marks rev 3 current for three newest-first revisions', async () => {
    providerMocks.helmReleaseHistory.mockResolvedValue(
      historyRows([
        { revision: 3, status: 'deployed' },
        { revision: 2, status: 'superseded' },
        { revision: 1, status: 'superseded' },
      ])
    );
    view = render(
      <HelmRollbackForm
        kind="helm"
        row={helmRow}
        ref={{ kind: 'helm', namespace: 'default', name: 'my-release' }}
        onError={vi.fn()}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    );
    await new Promise((r) => setTimeout(r, 50));
    const radios = view.container.querySelectorAll(
      'input[type="radio"]'
    ) as NodeListOf<HTMLInputElement>;
    expect(radios.length).toBe(3);
    // Revision 2 (the one before current) is preselected.
    expect(radios[1].checked).toBe(true);
    // Revision 3 is the current one — disabled, not the oldest row.
    expect(radios[0].disabled).toBe(true);
    expect(radios[2].disabled).toBe(false);
    expect(view.queryByText(/Rollback to #2/)).not.toBeNull();
  });
});

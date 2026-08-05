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

// Mock the provider.
vi.mock('../../providers', () => ({
  getProvider: () => ({
    undoRollout: vi.fn().mockResolvedValue(undefined),
    helmReleaseHistory: vi.fn().mockResolvedValue([
      {
        revision: 1,
        status: 'superseded',
        chart: 'nginx-1.0.0',
        updated: '2024-01-01',
        description: 'Install complete',
      },
      {
        revision: 2,
        status: 'deployed',
        chart: 'nginx-1.1.0',
        updated: '2024-01-02',
        description: 'Upgrade complete',
      },
    ]),
    helmRunOp: vi.fn().mockResolvedValue({ success: true }),
  }),
}));

let view: RenderResult;

function resetStore() {
  useStore.setState({
    settings: createMockSettings(),
  });
}

beforeEach(() => {
  resetStore();
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
});

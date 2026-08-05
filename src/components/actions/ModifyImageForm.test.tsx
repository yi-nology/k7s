/**
 * Tests for ModifyImageForm — the "Modify image…" row action form.
 *
 * Covers: loading state, rendering container image inputs, error state,
 * cancel button, apply action.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { ModifyImageForm } from './ModifyImageForm';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import { createMockSettings } from '../../test/types';

// Mock the provider — use stable mocks so we can override per-test.
const mockGetYaml = vi
  .fn()
  .mockResolvedValue(
    'apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n      - name: app\n        image: nginx:1.25\n'
  );
vi.mock('../../providers', () => ({
  getProvider: () => ({
    getYaml: mockGetYaml,
    dryRunYaml: vi.fn().mockResolvedValue(undefined),
    applyYaml: vi.fn().mockResolvedValue(undefined),
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

describe('ModifyImageForm', () => {
  const resourceRef = { kind: 'deployments' as const, namespace: 'default', name: 'web' };

  it('renders loading state initially', () => {
    view = render(<ModifyImageForm ref={resourceRef} onError={vi.fn()} onClose={vi.fn()} />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders container inputs after loading', async () => {
    view = render(<ModifyImageForm ref={resourceRef} onError={vi.fn()} onClose={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 100));
    // Should show container name label
    expect(view.queryByText('app')).not.toBeNull();
  });

  it('shows cancel button', async () => {
    view = render(<ModifyImageForm ref={resourceRef} onError={vi.fn()} onClose={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 100));
    expect(view.queryByText('Cancel')).not.toBeNull();
  });

  it('calls onClose when cancel is clicked', async () => {
    const onClose = vi.fn();
    view = render(<ModifyImageForm ref={resourceRef} onError={vi.fn()} onClose={onClose} />);
    await new Promise((r) => setTimeout(r, 100));
    const cancelBtn = view.queryByText('Cancel');
    if (cancelBtn) view.click(cancelBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders apply button', async () => {
    view = render(<ModifyImageForm ref={resourceRef} onError={vi.fn()} onClose={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 100));
    expect(view.queryByText('Apply')).not.toBeNull();
  });

  it('renders the title with resource name', async () => {
    view = render(<ModifyImageForm ref={resourceRef} onError={vi.fn()} onClose={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 100));
    // The title should contain the resource name
    expect(view.queryByText(/web/)).not.toBeNull();
  });

  it('shows error state when getYaml fails', async () => {
    mockGetYaml.mockRejectedValueOnce(new Error('RBAC denied'));
    view = render(<ModifyImageForm ref={resourceRef} onError={vi.fn()} onClose={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 100));
    expect(view.queryByText('RBAC denied')).not.toBeNull();
  });

  it('shows cancel button in error state', async () => {
    mockGetYaml.mockRejectedValueOnce(new Error('fail'));
    view = render(<ModifyImageForm ref={resourceRef} onError={vi.fn()} onClose={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 100));
    expect(view.queryByText('Cancel')).not.toBeNull();
  });
});

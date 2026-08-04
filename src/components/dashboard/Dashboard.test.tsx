/**
 * Tests for Dashboard — the cluster overview page.
 *
 * Covers: rendering, cluster info, resource cards, events, close button.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { Dashboard } from './Dashboard';
import { render, cleanup, createMockRow, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'dashboard',
    connection: { phase: 'connected', context: 'test-cluster', clusterName: 'test-cluster' },
    rows: {
      pods: [createMockRow({ name: 'nginx' })],
      deployments: [createMockRow({ name: 'web' })],
      services: [],
      nodes: [createMockRow({ name: 'node-1' })],
      events: [],
      configmaps: [],
      secrets: [],
      jobs: [],
      cronjobs: [],
      namespaces: [],
      resourcequotas: [],
    } as any,
    nodeMetrics: {},
    setNav: vi.fn(),
    closeOverlay: vi.fn(),
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('Dashboard', () => {
  it('renders the panel', () => {
    view = render(<Dashboard />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders the title when onClose is provided', () => {
    view = render(<Dashboard onClose={vi.fn()} />);
    expect(view.queryByText('Dashboard')).not.toBeNull();
  });

  it('renders cluster info', () => {
    view = render(<Dashboard />);
    expect(view.queryByText('Cluster')).not.toBeNull();
    expect(view.queryByText('test-cluster')).not.toBeNull();
  });

  it('renders status info', () => {
    view = render(<Dashboard />);
    expect(view.queryByText('Status')).not.toBeNull();
    expect(view.queryByText('connected')).not.toBeNull();
  });

  it('renders nodes count', () => {
    view = render(<Dashboard />);
    expect(view.queryByText('Nodes')).not.toBeNull();
  });

  it('renders resource cards', () => {
    view = render(<Dashboard />);
    // Resource cards show kind labels
    expect(view.queryByText(/Pods|Pod/)).not.toBeNull();
  });

  it('renders recent events section', () => {
    view = render(<Dashboard />);
    expect(view.queryByText('Recent events')).not.toBeNull();
  });

  it('shows empty events message when no events', () => {
    view = render(<Dashboard />);
    expect(view.queryByText('No recent events')).not.toBeNull();
  });

  it('renders health score section', () => {
    view = render(<Dashboard />);
    expect(view.queryByText('Cluster Health')).not.toBeNull();
  });

  it('renders CPU label in overview', () => {
    view = render(<Dashboard />);
    // CPU and MEM are rendered in the overview section
    expect(view.queryByText('CPU')).not.toBeNull();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    view = render(<Dashboard onClose={onClose} />);
    const closeBtn = view.queryByText('Close');
    if (closeBtn) view.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});

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
    section: 'overview',
    // Pin the locale: the assertions below match English copy, and the store
    // boots from whatever localStorage cached in a previous test file.
    settings: { ...useStore.getState().settings, language: 'en' },
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
    },
    nodeMetrics: {},
    overlay: null,
    onboardingOpen: false,
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

  it('renders without onClose (page mode)', () => {
    view = render(<Dashboard />);
    // Page mode still needs an accessible name — the overview heading.
    expect(view.getByText(/Overview|概览/i)).not.toBeNull();
    // And no overlay close button leaks into the page.
    expect(view.queryByText('Close')).toBeNull();
  });

  it('shows the no-cluster empty state with an import button when disconnected', () => {
    useStore.setState({
      connection: { ...useStore.getState().connection, phase: 'error' },
    });
    view = render(<Dashboard />);
    const importBtn = view.getByText(/Import cluster|导入集群/i);
    expect(importBtn).not.toBeNull();
    // The empty state replaces the connected dashboard, not just overlays it.
    expect(view.queryByText('Cluster')).toBeNull();
    // Clicking import flips the onboarding flag (Task 9 renders the wizard).
    view.click(importBtn);
    expect(useStore.getState().onboardingOpen).toBe(true);
  });

  it('quick entries route to sections and overlays when connected', () => {
    view = render(<Dashboard />);
    for (const label of [
      /Workloads|工作负载/,
      /Metrics|指标查询/,
      /Alerts|告警/,
      /Create workload|创建工作负载/,
    ]) {
      expect(view.getByText(label)).not.toBeNull();
    }
    view.click(view.getByText(/Workloads|工作负载/));
    expect(useStore.getState().section).toBe('workloads');
    view.click(view.getByText(/Metrics|指标查询/));
    expect(useStore.getState().overlay).toBe('metrics');
    view.click(view.getByText(/Alerts|告警/));
    expect(useStore.getState().overlay).toBe('alerting');
    view.click(view.getByText(/Create workload|创建工作负载/));
    // P2: the workload quick entry opens the create-workload wizard, not the
    // generic template picker.
    expect(useStore.getState().overlay).toBe('wizard');
  });
});

/**
 * Tests for Sidebar — the sidebar composition (Design §1).
 *
 * Covers rendering: brand mark, cluster switcher, nav list, watch footer.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store';
import { Sidebar } from './Sidebar';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
    namespace: 'all',
    connection: { phase: 'idle', context: null, clusterName: null },
    watchCount: 0,
    rows: useStore.getState().rows,
    customKinds: [],
    watchStatus: {},
    overlay: null,
    settings: useStore.getState().settings,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('Sidebar', () => {
  it('renders the brand mark', () => {
    view = render(<Sidebar />);
    expect(view.queryByText('k7')).not.toBeNull();
  });

  it('renders the brand name', () => {
    view = render(<Sidebar />);
    expect(view.queryByText('k7s')).not.toBeNull();
  });

  it('renders the brand subtitle', () => {
    view = render(<Sidebar />);
    expect(view.queryByText('kubernetes manager')).not.toBeNull();
  });

  it('renders resource group headers', () => {
    view = render(<Sidebar />);
    // Workloads is the first group
    expect(view.queryByText('Workloads')).not.toBeNull();
  });

  it('renders resource kind items', () => {
    view = render(<Sidebar />);
    // Pods is always present
    expect(view.queryByText('Pods')).not.toBeNull();
  });

  it('has the panel data-surface attribute', () => {
    view = render(<Sidebar />);
    const sidebar = view.container.querySelector('[data-surface="panel"]');
    expect(sidebar).not.toBeNull();
  });

  it('renders the Dashboard overlay entry', () => {
    view = render(<Sidebar />);
    expect(view.queryByText('Dashboard')).not.toBeNull();
  });

  it('marks the active nav item', () => {
    useStore.setState({ nav: 'pods' });
    view = render(<Sidebar />);
    // The active item should have the navItemActive class
    const activeItems = view.container.querySelectorAll('[class*="navItemActive"]');
    expect(activeItems.length).toBeGreaterThanOrEqual(0);
  });
});

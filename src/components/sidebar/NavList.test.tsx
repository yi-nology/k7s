/**
 * Tests for NavList — the sidebar navigation (Design §1).
 *
 * Covers: rendering groups, kind items with counts, active state,
 * click-to-navigate, custom CRD section, overlay entries, forbidden indicator.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store';
import type { CustomKind } from '../../providers/types';
import { NavList } from './NavList';
import { render, cleanup, createMockRow, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
    namespace: 'all',
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

describe('NavList', () => {
  describe('group headers', () => {
    it('renders Workloads group header', () => {
      view = render(<NavList />);
      expect(view.queryByText('Workloads')).not.toBeNull();
    });

    it('renders Network group header', () => {
      view = render(<NavList />);
      expect(view.queryByText('Network')).not.toBeNull();
    });

    it('renders Cluster group header', () => {
      view = render(<NavList />);
      expect(view.queryByText('Cluster')).not.toBeNull();
    });
  });

  describe('kind items', () => {
    it('renders Pods kind item', () => {
      view = render(<NavList />);
      expect(view.queryByText('Pods')).not.toBeNull();
    });

    it('renders Deployments kind item', () => {
      view = render(<NavList />);
      expect(view.queryByText('Deployments')).not.toBeNull();
    });

    it('shows row count for each kind', () => {
      const pods = [createMockRow({ uid: 'p1', name: 'pod-1' })];
      useStore.setState({
        rows: { ...useStore.getState().rows, pods },
      });
      view = render(<NavList />);
      // The count "1" should appear near Pods
      const countEls = view.container.querySelectorAll('[class*="navCount"]');
      expect(countEls.length).toBeGreaterThan(0);
    });

    it('shows forbidden icon for forbidden kinds', () => {
      useStore.setState({
        watchStatus: { pods: 'forbidden' },
      });
      view = render(<NavList />);
      const forbiddenEl = view.container.querySelector('[class*="navForbidden"]');
      expect(forbiddenEl).not.toBeNull();
    });
  });

  describe('navigation', () => {
    it('sets nav on item click', () => {
      useStore.setState({ nav: 'deployments' });
      view = render(<NavList />);
      const podsItem = view.queryByText('Pods');
      expect(podsItem).not.toBeNull();
      // Click the parent navItem div
      const navItem = podsItem!.closest('[class*="navItem"]');
      expect(navItem).not.toBeNull();
      view.click(navItem as HTMLElement);
      expect(useStore.getState().nav).toBe('pods');
    });

    it('highlights the active kind', () => {
      useStore.setState({ nav: 'pods' });
      view = render(<NavList />);
      // Find the Pods nav item and check it has the active class
      const podsItem = view.queryByText('Pods');
      expect(podsItem).not.toBeNull();
      const navItem = podsItem!.closest('[class*="navItem"]');
      expect(navItem).not.toBeNull();
      expect((navItem as HTMLElement).className).toContain('navItemActive');
    });
  });

  describe('overlay entries', () => {
    it('renders Dashboard overlay entry', () => {
      view = render(<NavList />);
      expect(view.queryByText('Dashboard')).not.toBeNull();
    });

    it('renders Templates in the Tools ▸ Deployment sub-group', () => {
      // Two-zone layout: overlay tools no longer live inside resource groups.
      // Templates is in the Tools section, under the Deployment sub-group —
      // which starts folded and must be clicked to reveal its items.
      view = render(<NavList />);
      expect(view.queryByText('Tools')).not.toBeNull();
      expect(view.queryByText('Deployment')).not.toBeNull();
      expect(view.queryByText('Templates')).toBeNull(); // sub-group folded
      view.click(view.getByText('Deployment'));
      expect(view.queryByText('Templates')).not.toBeNull();
    });

    it('opens overlay on click', () => {
      view = render(<NavList />);
      const dashItem = view.queryByText('Dashboard');
      expect(dashItem).not.toBeNull();
      const navItem = dashItem!.closest('[class*="navItem"]');
      expect(navItem).not.toBeNull();
      view.click(navItem as HTMLElement);
      expect(useStore.getState().overlay).toBe('dashboard');
    });

    it('closes overlay when clicking the active overlay entry', () => {
      useStore.setState({ overlay: 'dashboard' });
      view = render(<NavList />);
      const dashItem = view.queryByText('Dashboard');
      const navItem = dashItem!.closest('[class*="navItem"]');
      view.click(navItem as HTMLElement);
      expect(useStore.getState().overlay).toBeNull();
    });
  });

  describe('custom CRD section', () => {
    it('renders Custom section when customKinds are present', () => {
      const customKinds: CustomKind[] = [
        {
          id: 'argoproj.io/applications',
          kind: 'Application',
          group: 'argoproj.io',
          version: 'v1alpha1',
          namespaced: true,
          plural: 'applications',
        },
      ];
      useStore.setState({ customKinds });
      view = render(<NavList />);
      expect(view.queryByText('Custom')).not.toBeNull();
    });

    it('does not render Custom section when no custom kinds', () => {
      useStore.setState({ customKinds: [] });
      view = render(<NavList />);
      expect(view.queryByText('Custom')).toBeNull();
    });

    it('groups custom kinds by API group', () => {
      const customKinds: CustomKind[] = [
        {
          id: 'argoproj.io/applications',
          kind: 'Application',
          group: 'argoproj.io',
          version: 'v1alpha1',
          namespaced: true,
          plural: 'applications',
        },
        {
          id: 'argoproj.io/appprojects',
          kind: 'AppProject',
          group: 'argoproj.io',
          version: 'v1alpha1',
          namespaced: true,
          plural: 'appprojects',
        },
      ];
      useStore.setState({ customKinds });
      view = render(<NavList />);
      expect(view.queryByText('argoproj.io')).not.toBeNull();
    });
  });

  describe('Network extras', () => {
    it('renders Endpoints in the Tools ▸ Inspection sub-group', () => {
      // Endpoints moved from the Network resource group to Tools ▸ Inspection.
      view = render(<NavList />);
      view.click(view.getByText('Inspection'));
      expect(view.queryByText('Endpoints')).not.toBeNull();
    });

    it('renders Service Topology in the Tools ▸ Inspection sub-group', () => {
      view = render(<NavList />);
      view.click(view.getByText('Inspection'));
      expect(view.queryByText('Service Topology')).not.toBeNull();
    });
  });

  describe('collapsible groups', () => {
    it('folds low-frequency groups (Cluster) by default, expands on click', () => {
      // Cluster is a low-frequency resource group — it starts collapsed (not
      // in DEFAULT_OPEN_GROUPS) so its kinds (Nodes, Namespaces, …) are hidden
      // until the user opens it. The group header is still rendered (it's the
      // expand trigger).
      view = render(<NavList />);
      expect(view.queryByText('Cluster')).not.toBeNull();
      // Nodes lives inside Cluster; it must be hidden while folded.
      expect(view.queryByText('Nodes')).toBeNull();
      // Click the Cluster header to expand it.
      view.click(view.getByText('Cluster'));
      expect(view.queryByText('Nodes')).not.toBeNull();
    });

    it('auto-expands a group when one of its overlays becomes active', () => {
      // Opening a Cluster-group overlay (e.g. metrics) must expand Cluster so
      // the active tool is visible, not buried in a fold.
      useStore.setState({ overlay: 'metrics' });
      view = render(<NavList />);
      expect(view.queryByText('Metrics')).not.toBeNull();
    });
  });
});

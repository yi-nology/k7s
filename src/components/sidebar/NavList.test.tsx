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
import {
  render,
  cleanup,
  createMockRow,
  type RenderResult,
} from '../../test/componentUtils';

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

    it('renders Templates overlay entry', () => {
      view = render(<NavList />);
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
    it('renders Endpoints overlay entry under Network', () => {
      view = render(<NavList />);
      expect(view.queryByText('Endpoints')).not.toBeNull();
    });

    it('renders Service Topology overlay entry under Network', () => {
      view = render(<NavList />);
      expect(view.queryByText('Service Topology')).not.toBeNull();
    });
  });
});

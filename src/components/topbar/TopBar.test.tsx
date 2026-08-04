/**
 * Tests for TopBar — the top bar (Design §2).
 *
 * Covers: breadcrumb rendering, namespace picker, language switcher,
 * command palette trigger, cluster name display.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store';
import { TopBar } from './TopBar';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
    namespace: 'all',
    connection: { phase: 'connected', context: 'minikube', clusterName: 'my-cluster' },
    overlay: null,
    openMenu: null,
    customKinds: [],
    rows: {
      ...useStore.getState().rows,
      namespaces: [],
    },
    settings: useStore.getState().settings,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('TopBar', () => {
  describe('breadcrumb', () => {
    it('renders the cluster name in the breadcrumb', () => {
      view = render(<TopBar />);
      expect(view.queryByText('my-cluster')).not.toBeNull();
    });

    it('renders the group label in the breadcrumb', () => {
      view = render(<TopBar />);
      // Pods belong to Workloads group
      expect(view.queryByText('Workloads')).not.toBeNull();
    });

    it('renders the kind label in the breadcrumb', () => {
      view = render(<TopBar />);
      expect(view.queryByText('Pods')).not.toBeNull();
    });

    it('renders the overlay label when an overlay is active', () => {
      useStore.setState({ overlay: 'dashboard' });
      view = render(<TopBar />);
      expect(view.queryByText('Dashboard')).not.toBeNull();
    });

    it('falls back to k7s when no cluster name or context', () => {
      useStore.setState({
        connection: { phase: 'idle', context: null, clusterName: null },
      });
      view = render(<TopBar />);
      expect(view.queryByText('k7s')).not.toBeNull();
    });
  });

  describe('namespace picker', () => {
    it('renders the namespace button', () => {
      view = render(<TopBar />);
      const nsButton = view.container.querySelector('[class*="nsButton"]');
      expect(nsButton).not.toBeNull();
    });

    it('shows the current namespace value', () => {
      useStore.setState({ namespace: 'default' });
      view = render(<TopBar />);
      expect(view.queryByText('default')).not.toBeNull();
    });

    it('opens the namespace menu on click', () => {
      view = render(<TopBar />);
      const nsButton = view.container.querySelector('[class*="nsButton"]');
      expect(nsButton).not.toBeNull();
      view.click(nsButton as HTMLElement);
      expect(useStore.getState().openMenu).toBe('ns');
    });

    it('renders "all" option in the namespace menu', () => {
      useStore.setState({ openMenu: 'ns' });
      view = render(<TopBar />);
      expect(view.queryByText('all')).not.toBeNull();
    });
  });

  describe('language switcher', () => {
    it('renders the language button', () => {
      view = render(<TopBar />);
      const langButton = view.container.querySelector('[class*="langButton"]');
      expect(langButton).not.toBeNull();
    });

    it('opens the language menu on click', () => {
      view = render(<TopBar />);
      const langButton = view.container.querySelector('[class*="langButton"]');
      expect(langButton).not.toBeNull();
      view.click(langButton as HTMLElement);
      expect(useStore.getState().openMenu).toBe('lang');
    });

    it('shows locale options when menu is open', () => {
      useStore.setState({ openMenu: 'lang' });
      view = render(<TopBar />);
      // Should show "English" and a Chinese option
      expect(view.queryByText('English')).not.toBeNull();
    });
  });

  describe('command palette trigger', () => {
    it('renders the search bar', () => {
      view = render(<TopBar />);
      const cmdBar = view.container.querySelector('[class*="cmdBar"]');
      expect(cmdBar).not.toBeNull();
    });

    it('opens the palette on click', () => {
      view = render(<TopBar />);
      const cmdBar = view.container.querySelector('[class*="cmdBar"]');
      expect(cmdBar).not.toBeNull();
      view.click(cmdBar as HTMLElement);
      expect(useStore.getState().paletteOpen).toBe(true);
    });

    it('opens the palette on Enter key', () => {
      view = render(<TopBar />);
      const cmdBar = view.container.querySelector('[class*="cmdBar"]') as HTMLElement;
      expect(cmdBar).not.toBeNull();
      view.keyDown(cmdBar, 'Enter');
      expect(useStore.getState().paletteOpen).toBe(true);
    });
  });
});

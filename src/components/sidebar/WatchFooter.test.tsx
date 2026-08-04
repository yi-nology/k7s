/**
 * Tests for WatchFooter — sidebar footer with watch count and settings gear.
 *
 * Covers: rendering, watch count display, settings button, dot color by phase.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { WatchFooter } from './WatchFooter';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

function resetStore() {
  useStore.setState({
    watchCount: 0,
    connection: { phase: 'idle', context: null, clusterName: null },
    setSettingsOpen: (open: boolean) => useStore.setState({ settingsOpen: open }),
    settingsOpen: false,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('WatchFooter', () => {
  describe('rendering', () => {
    it('renders the footer', () => {
      view = render(<WatchFooter />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('renders watch count text', () => {
      useStore.setState({ watchCount: 5 });
      view = render(<WatchFooter />);
      expect(view.queryByText(/5/)).not.toBeNull();
    });

    it('renders zero watch count', () => {
      useStore.setState({ watchCount: 0 });
      view = render(<WatchFooter />);
      expect(view.queryByText(/0/)).not.toBeNull();
    });
  });

  describe('settings button', () => {
    it('renders settings gear button', () => {
      view = render(<WatchFooter />);
      const gearBtn = view.queryByText('⚙');
      expect(gearBtn).not.toBeNull();
    });

    it('opens settings on gear click', () => {
      view = render(<WatchFooter />);
      const gearBtn = view.queryByText('⚙');
      expect(gearBtn).not.toBeNull();
      view.click(gearBtn!);
      expect(useStore.getState().settingsOpen).toBe(true);
    });
  });

  describe('dot color', () => {
    it('renders a dot element', () => {
      view = render(<WatchFooter />);
      const dot = view.container.querySelector('[class*="footerDot"]');
      expect(dot).not.toBeNull();
    });

    it('dot has accent color when connected', () => {
      useStore.setState({
        connection: { phase: 'connected', context: 'ctx', clusterName: 'ctx' },
      });
      view = render(<WatchFooter />);
      const dot = view.container.querySelector('[class*="footerDot"]') as HTMLElement;
      expect(dot?.style.background).toContain('var(--accent)');
    });

    it('dot has warn color when connecting', () => {
      useStore.setState({
        connection: { phase: 'connecting', context: 'ctx', clusterName: 'ctx' },
      });
      view = render(<WatchFooter />);
      const dot = view.container.querySelector('[class*="footerDot"]') as HTMLElement;
      expect(dot?.style.background).toContain('var(--status-warn)');
    });

    it('dot has err color on error', () => {
      useStore.setState({
        connection: { phase: 'error', context: 'ctx', clusterName: 'ctx', error: 'fail' },
      });
      view = render(<WatchFooter />);
      const dot = view.container.querySelector('[class*="footerDot"]') as HTMLElement;
      expect(dot?.style.background).toContain('var(--status-err)');
    });
  });

  describe('pulse animation', () => {
    it('dot pulses when connected', () => {
      useStore.setState({
        connection: { phase: 'connected', context: 'ctx', clusterName: 'ctx' },
      });
      view = render(<WatchFooter />);
      const dot = view.container.querySelector('[class*="footerDot"]') as HTMLElement;
      expect(dot?.className).toContain('footerDotPulsing');
    });

    it('dot does not pulse when idle', () => {
      useStore.setState({
        connection: { phase: 'idle', context: null, clusterName: null },
      });
      view = render(<WatchFooter />);
      const dot = view.container.querySelector('[class*="footerDot"]') as HTMLElement;
      expect(dot?.className).not.toContain('footerDotPulsing');
    });
  });
});

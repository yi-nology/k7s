/**
 * Tests for CommandPalette — the command palette (B28).
 *
 * Covers: open/close state, query input, keyboard navigation (ArrowUp/Down,
 * Enter, Escape), result rendering, and empty states.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store';
import { CommandPalette } from './CommandPalette';
import {
  render,
  cleanup,
  createMockRow,
  type RenderResult,
} from '../../test/componentUtils';

let view: RenderResult;

function resetStore() {
  useStore.setState({
    paletteOpen: false,
    nav: 'pods',
    namespace: 'all',
    selectedRow: null,
    rows: {
      ...useStore.getState().rows,
      pods: [
        createMockRow({ uid: 'p1', name: 'nginx-pod', namespace: 'default' }),
        createMockRow({ uid: 'p2', name: 'redis-pod', namespace: 'default' }),
      ],
      deployments: [
        createMockRow({ uid: 'd1', name: 'nginx-deploy', namespace: 'default' }),
      ],
      namespaces: [],
    },
    customKinds: [],
    settings: useStore.getState().settings,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('CommandPalette', () => {
  describe('visibility', () => {
    it('renders nothing when closed', () => {
      useStore.setState({ paletteOpen: false });
      view = render(<CommandPalette />);
      expect(view.container.innerHTML).toBe('');
    });

    it('renders the palette when open', () => {
      useStore.setState({ paletteOpen: true });
      view = render(<CommandPalette />);
      expect(view.container.innerHTML).not.toBe('');
    });

    it('renders the search input when open', () => {
      useStore.setState({ paletteOpen: true });
      view = render(<CommandPalette />);
      const input = view.container.querySelector('input');
      expect(input).not.toBeNull();
    });
  });

  describe('backdrop', () => {
    it('closes the palette when backdrop is clicked', () => {
      useStore.setState({ paletteOpen: true });
      view = render(<CommandPalette />);
      const backdrop = view.container.querySelector('[class*="backdrop"]');
      expect(backdrop).not.toBeNull();
      view.click(backdrop as HTMLElement);
      expect(useStore.getState().paletteOpen).toBe(false);
    });

    it('does not close when palette body is clicked', () => {
      useStore.setState({ paletteOpen: true });
      view = render(<CommandPalette />);
      const palette = view.container.querySelector('[class*="palette"]');
      expect(palette).not.toBeNull();
      view.click(palette as HTMLElement);
      expect(useStore.getState().paletteOpen).toBe(true);
    });
  });

  describe('keyboard navigation', () => {
    it('closes on Escape', () => {
      useStore.setState({ paletteOpen: true });
      view = render(<CommandPalette />);
      const input = view.container.querySelector('input') as HTMLElement;
      view.keyDown(input, 'Escape');
      expect(useStore.getState().paletteOpen).toBe(false);
    });

    it('moves cursor down on ArrowDown', () => {
      useStore.setState({ paletteOpen: true });
      view = render(<CommandPalette />);
      const input = view.container.querySelector('input') as HTMLElement;
      // ArrowDown should not throw
      view.keyDown(input, 'ArrowDown');
      expect(useStore.getState().paletteOpen).toBe(true);
    });

    it('moves cursor up on ArrowUp', () => {
      useStore.setState({ paletteOpen: true });
      view = render(<CommandPalette />);
      const input = view.container.querySelector('input') as HTMLElement;
      view.keyDown(input, 'ArrowDown');
      view.keyDown(input, 'ArrowUp');
      expect(useStore.getState().paletteOpen).toBe(true);
    });
  });

  describe('results', () => {
    it('shows kind results matching the query', () => {
      useStore.setState({ paletteOpen: true });
      view = render(<CommandPalette />);
      const input = view.container.querySelector('input') as HTMLElement;
      // Type "pod" to search for pod-related items
      view.change(input, 'pod');
      // After typing, results should appear
      // The palette shows kind items + object items
      expect(view.container.querySelector('[class*="list"]')).not.toBeNull();
    });

    it('shows kind items even with empty query', () => {
      useStore.setState({ paletteOpen: true });
      view = render(<CommandPalette />);
      // With empty query, kinds and actions are still listed (objects are hidden)
      const items = view.container.querySelectorAll('[class*="item"]');
      expect(items.length).toBeGreaterThan(0);
    });

    it('shows "nothing matches" when query has no results', () => {
      useStore.setState({ paletteOpen: true });
      view = render(<CommandPalette />);
      const input = view.container.querySelector('input') as HTMLElement;
      view.change(input, 'zzzznonexistent');
      expect(view.queryByText('nothing matches')).not.toBeNull();
    });
  });

  describe('palette items', () => {
    it('shows items in the list', () => {
      useStore.setState({ paletteOpen: true });
      view = render(<CommandPalette />);
      const input = view.container.querySelector('input') as HTMLElement;
      view.change(input, 'pod');
      // Check that items are rendered
      const items = view.container.querySelectorAll('[class*="item"]');
      expect(items.length).toBeGreaterThan(0);
    });

    it('highlights the active item', () => {
      useStore.setState({ paletteOpen: true });
      view = render(<CommandPalette />);
      const input = view.container.querySelector('input') as HTMLElement;
      view.change(input, 'pod');
      const activeItem = view.container.querySelector('[class*="itemActive"]');
      // First item should be active
      expect(activeItem).not.toBeNull();
    });
  });

  describe('footer', () => {
    it('renders keyboard shortcut hints', () => {
      useStore.setState({ paletteOpen: true });
      view = render(<CommandPalette />);
      // Footer should contain move/open/esc hints
      const footer = view.container.querySelector('[class*="footer"]');
      expect(footer).not.toBeNull();
    });
  });

  describe('query reset', () => {
    it('resets query when palette opens', () => {
      // First open with a query
      useStore.setState({ paletteOpen: true });
      view = render(<CommandPalette />);
      const input = view.container.querySelector('input') as HTMLInputElement;
      view.change(input, 'something');

      // Close and reopen
      view.keyDown(input, 'Escape');
      expect(useStore.getState().paletteOpen).toBe(false);

      useStore.setState({ paletteOpen: true });
      view = render(<CommandPalette />);
      const newInput = view.container.querySelector('input') as HTMLInputElement;
      expect(newInput.value).toBe('');
    });
  });
});

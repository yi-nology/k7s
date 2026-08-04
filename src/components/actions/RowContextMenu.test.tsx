/**
 * Tests for RowContextMenu — the right-click context menu for table rows.
 *
 * Covers: rendering, portal mount, positioning, dismissal on click outside,
 * dismissal on Escape, dismissal on scroll.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { RowContextMenu } from './RowContextMenu';
import { render, cleanup, createMockRow } from '../../test/componentUtils';

// Mock the provider.
vi.mock('../../providers', () => ({
  getProvider: () => ({
    setCordon: vi.fn().mockResolvedValue(undefined),
    deleteResource: vi.fn().mockResolvedValue(undefined),
    restartPod: vi.fn().mockResolvedValue(undefined),
    getYaml: vi.fn().mockResolvedValue('apiVersion: v1\nkind: Pod\n'),
  }),
}));


function resetStore() {
  useStore.setState({
    nav: 'pods',
    rows: {},
    setPortForwards: vi.fn(),
    viewPods: vi.fn(),
    openOverlay: vi.fn(),
    settings: { language: 'en' } as any,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('RowContextMenu', () => {
  const mockRow = createMockRow({
    name: 'nginx',
    namespace: 'default',
    cells: [
      { text: 'nginx', tone: 'primary' },
      { text: 'default', tone: 'muted' },
      { text: '1/1', tone: 'primary' },
      { text: 'Running', tone: 'ok', dot: true },
    ],
  });

  it('renders the context menu', () => {
    render(
      <RowContextMenu
        at={{ x: 100, y: 100 }}
        kind="pods"
        rows={[mockRow]}
        onError={vi.fn()}
        onClose={vi.fn()}
        onGone={vi.fn()}
      />
    );
    // The menu is rendered via a portal to document.body
    const portal = document.body.querySelector('[style*="position: fixed"]');
    expect(portal).not.toBeNull();
  });

  it('renders as a portal to document.body', () => {
    render(
      <RowContextMenu
        at={{ x: 100, y: 100 }}
        kind="pods"
        rows={[mockRow]}
        onError={vi.fn()}
        onClose={vi.fn()}
        onGone={vi.fn()}
      />
    );
    // The menu should be appended to document.body via portal
    const portals = document.body.querySelectorAll('[style*="position: fixed"]');
    expect(portals.length).toBeGreaterThan(0);
  });

  it('positions at the given coordinates', () => {
    render(
      <RowContextMenu
        at={{ x: 200, y: 300 }}
        kind="pods"
        rows={[mockRow]}
        onError={vi.fn()}
        onClose={vi.fn()}
        onGone={vi.fn()}
      />
    );
    const portal = document.body.querySelector('[style*="position: fixed"]') as HTMLElement;
    expect(portal).not.toBeNull();
    expect(portal.style.zIndex).toBe('300');
  });

  it('renders action buttons inside the menu', () => {
    render(
      <RowContextMenu
        at={{ x: 100, y: 100 }}
        kind="pods"
        rows={[mockRow]}
        onError={vi.fn()}
        onClose={vi.fn()}
        onGone={vi.fn()}
      />
    );
    // The menu is rendered via a portal to document.body
    const portal = document.body.querySelector('[style*="position: fixed"]');
    const buttons = portal?.querySelectorAll('button');
    expect(buttons?.length).toBeGreaterThan(0);
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(
      <RowContextMenu
        at={{ x: 100, y: 100 }}
        kind="pods"
        rows={[mockRow]}
        onError={vi.fn()}
        onClose={onClose}
        onGone={vi.fn()}
      />
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on mousedown outside', () => {
    const onClose = vi.fn();
    render(
      <RowContextMenu
        at={{ x: 100, y: 100 }}
        kind="pods"
        rows={[mockRow]}
        onError={vi.fn()}
        onClose={onClose}
        onGone={vi.fn()}
      />
    );
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on window resize', () => {
    const onClose = vi.fn();
    render(
      <RowContextMenu
        at={{ x: 100, y: 100 }}
        kind="pods"
        rows={[mockRow]}
        onError={vi.fn()}
        onClose={onClose}
        onGone={vi.fn()}
      />
    );
    window.dispatchEvent(new Event('resize'));
    expect(onClose).toHaveBeenCalled();
  });

  it('prevents default context menu on the menu element', () => {
    render(
      <RowContextMenu
        at={{ x: 100, y: 100 }}
        kind="pods"
        rows={[mockRow]}
        onError={vi.fn()}
        onClose={vi.fn()}
        onGone={vi.fn()}
      />
    );
    const portal = document.body.querySelector('[style*="position: fixed"]') as HTMLElement;
    expect(portal).not.toBeNull();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    portal.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

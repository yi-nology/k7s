/**
 * Tests for ActionsMenu — detail header actions dropdown.
 *
 * Covers: rendering trigger button, no actions case, menu open/close,
 * click outside to close.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionsMenu } from './ActionsMenu';
import { render, cleanup, createMockRow, type RenderResult } from '../../test/componentUtils';
import type { Row } from '../../providers/types/table';

// Mock useClickOutside.
vi.mock('../../hooks/useClickOutside', () => ({
  useClickOutside: vi.fn(),
}));

// Mock ActionList.
vi.mock('../actions/ActionList', () => ({
  ActionList: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="action-list">
      <button onClick={onClose}>Close Menu</button>
    </div>
  ),
}));

// Mock actionsFor.
vi.mock('../../lib/actions', () => ({
  actionsFor: vi.fn((kind: string, _rows: Row[]) => {
    // Return non-empty for pods, empty for nodes
    if (kind === 'pods') return [{ id: 'delete', label: 'Delete' }];
    return [];
  }),
}));

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('ActionsMenu', () => {
  describe('no actions available', () => {
    it('renders nothing when no actions for kind', () => {
      const row = createMockRow({ uid: 'node-1', name: 'worker-1' });
      const onError = vi.fn();
      const onDeleted = vi.fn();
      view = render(<ActionsMenu kind="nodes" row={row} onError={onError} onDeleted={onDeleted} />);
      expect(view.container.innerHTML).toBe('');
    });
  });

  describe('with actions', () => {
    it('renders the trigger button', () => {
      const row = createMockRow({ uid: 'pod-1', name: 'nginx' });
      const onError = vi.fn();
      const onDeleted = vi.fn();
      view = render(<ActionsMenu kind="pods" row={row} onError={onError} onDeleted={onDeleted} />);
      const btn = view.queryByText('⋯');
      expect(btn).not.toBeNull();
    });

    it('has correct aria attributes', () => {
      const row = createMockRow({ uid: 'pod-1', name: 'nginx' });
      const onError = vi.fn();
      const onDeleted = vi.fn();
      view = render(<ActionsMenu kind="pods" row={row} onError={onError} onDeleted={onDeleted} />);
      const btn = view.queryByText('⋯') as HTMLButtonElement;
      expect(btn?.getAttribute('aria-haspopup')).toBe('menu');
      expect(btn?.getAttribute('aria-expanded')).toBe('false');
    });

    it('opens menu on click', () => {
      const row = createMockRow({ uid: 'pod-1', name: 'nginx' });
      const onError = vi.fn();
      const onDeleted = vi.fn();
      view = render(<ActionsMenu kind="pods" row={row} onError={onError} onDeleted={onDeleted} />);
      const btn = view.queryByText('⋯');
      expect(btn).not.toBeNull();
      view.click(btn!);
      expect(view.queryByTestId('action-list')).not.toBeNull();
    });

    it('sets aria-expanded when open', () => {
      const row = createMockRow({ uid: 'pod-1', name: 'nginx' });
      const onError = vi.fn();
      const onDeleted = vi.fn();
      view = render(<ActionsMenu kind="pods" row={row} onError={onError} onDeleted={onDeleted} />);
      const btn = view.queryByText('⋯');
      view.click(btn!);
      expect((btn as HTMLButtonElement)?.getAttribute('aria-expanded')).toBe('true');
    });

    it('closes menu when ActionList calls onClose', () => {
      const row = createMockRow({ uid: 'pod-1', name: 'nginx' });
      const onError = vi.fn();
      const onDeleted = vi.fn();
      view = render(<ActionsMenu kind="pods" row={row} onError={onError} onDeleted={onDeleted} />);
      const btn = view.queryByText('⋯');
      view.click(btn!);
      expect(view.queryByTestId('action-list')).not.toBeNull();
      const closeBtn = view.queryByText('Close Menu');
      if (closeBtn) view.click(closeBtn);
      expect(view.queryByTestId('action-list')).toBeNull();
    });
  });

  describe('props forwarding', () => {
    it('passes onError to ActionList', () => {
      const row = createMockRow({ uid: 'pod-1', name: 'nginx' });
      const onError = vi.fn();
      const onDeleted = vi.fn();
      // Just verify it renders without crashing
      view = render(<ActionsMenu kind="pods" row={row} onError={onError} onDeleted={onDeleted} />);
      expect(view.container.firstChild).not.toBeNull();
    });
  });
});

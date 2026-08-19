/**
 * Tests for RowQuickActions — the hover-revealed cluster at the tail of each
 * table row (P3 Task 3): a 详情 button that selects the row exactly like a
 * plain row click, and a ⋯ button that opens the row context menu anchored at
 * the button itself.
 *
 * Covers: two labelled buttons (i18n aria-labels), the detail callback, the
 * menu callback with the button's screen position, and that neither click
 * bubbles into the row's own click handler (which would double-fire).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Row } from '../../providers/types';
import { RowQuickActions } from './RowQuickActions';
import { render, cleanup, createMockRow } from '../../test/componentUtils';

afterEach(() => {
  cleanup();
});

describe('RowQuickActions', () => {
  const row: Row = createMockRow({ uid: 'p1', name: 'pod-1' });

  it('renders exactly two labelled icon buttons', () => {
    const view = render(<RowQuickActions row={row} onOpenDetail={vi.fn()} onOpenMenu={vi.fn()} />);
    const buttons = view.container.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    // Locale is pinned to en in the component-test setup, so the i18n keys
    // resolve to their English copy.
    expect(buttons[0].getAttribute('aria-label')).toBe('Detail');
    expect(buttons[1].getAttribute('aria-label')).toBe('More actions');
    expect(buttons[0].getAttribute('type')).toBe('button');
    expect(buttons[1].getAttribute('type')).toBe('button');
  });

  it('clicking 详情 calls onOpenDetail with the row', () => {
    const onOpenDetail = vi.fn();
    const view = render(
      <RowQuickActions row={row} onOpenDetail={onOpenDetail} onOpenMenu={vi.fn()} />
    );
    view.click(view.container.querySelector('button[aria-label="Detail"]')!);
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).toHaveBeenCalledWith(row);
  });

  it('clicking ⋯ calls onOpenMenu with the row and the button position', () => {
    const onOpenMenu = vi.fn();
    const view = render(
      <RowQuickActions row={row} onOpenDetail={vi.fn()} onOpenMenu={onOpenMenu} />
    );
    const btn = view.container.querySelector('button[aria-label="More actions"]') as HTMLButtonElement;
    // jsdom rects are all-zero; stub the two fields the handler reads so the
    // assertion proves the coordinates come from the button, not a constant.
    btn.getBoundingClientRect = () =>
      ({ left: 120, bottom: 44 }) as unknown as DOMRect;
    view.click(btn);
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    expect(onOpenMenu).toHaveBeenCalledWith(row, { x: 120, y: 44 });
  });

  it('button clicks do not bubble into the row click handler', () => {
    // The cluster lives inside the <tr>, whose onClick selects the row. A quick
    // action must fire its own handler exactly once — not also the row's.
    const onRowClick = vi.fn();
    const view = render(
      <div onClick={onRowClick}>
        <RowQuickActions row={row} onOpenDetail={vi.fn()} onOpenMenu={vi.fn()} />
      </div>
    );
    for (const btn of Array.from(view.container.querySelectorAll('button'))) {
      view.click(btn as HTMLElement);
    }
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

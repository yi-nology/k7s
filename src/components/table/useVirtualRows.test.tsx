/**
 * Tests for useVirtualRows — the windowing hook (B21) behind the resource table.
 *
 * The hook's one job is to feed `rowWindow` the ACTIVE density's row height so
 * the spacer arithmetic matches the height the component pins each windowed
 * <tr> to. These tests pin padTop to the exported constants × the window's
 * start index for BOTH densities — the exact drift the constants exist to
 * prevent (a spacer computed from one height while rows render at another
 * shows up as blank rows at the window's edges).
 */

import { afterEach } from 'vitest';
import { renderHook } from '../../hooks/testUtils';
import type { RowWindow } from '../../lib/virtual';
import {
  useVirtualRows,
  VIRTUAL_ROW_HEIGHT_COMPACT,
  VIRTUAL_ROW_HEIGHT_COMFORTABLE,
  VIRTUAL_THRESHOLD,
} from './useVirtualRows';

// Host elements appended to document.body by mountAt — removed after each test.
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const el of hosts) el.remove();
  hosts.length = 0;
});

/**
 * Mount the hook against a scroll host pinned at `scrollTop`.
 *
 * jsdom has no layout, so assigning el.scrollTop for real clamps to 0 (the
 * scroll range is empty); shadow the property with a plain value instead. The
 * hook seeds its state from it on mount, so the first computed window already
 * reflects the offset — no scroll event needed.
 */
function mountAt(scrollTop: number, total: number, rowHeight: number) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  hosts.push(el);
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true });
  const ref = { current: el };
  const holder: { value?: { virtual: boolean; window: RowWindow } } = {};
  renderHook(() => {
    holder.value = useVirtualRows(ref, total, rowHeight);
  });
  if (!holder.value) throw new Error('hook did not run');
  return holder.value;
}

describe('useVirtualRows', () => {
  it('windows lists longer than the threshold and renders shorter ones whole', () => {
    const over = mountAt(0, VIRTUAL_THRESHOLD + 1, VIRTUAL_ROW_HEIGHT_COMFORTABLE);
    expect(over.virtual).toBe(true);

    const at = mountAt(0, VIRTUAL_THRESHOLD, VIRTUAL_ROW_HEIGHT_COMFORTABLE);
    expect(at.virtual).toBe(false);
    expect(at.window).toEqual({ start: 0, end: VIRTUAL_THRESHOLD, padTop: 0, padBottom: 0 });
  });

  it.each([
    ['compact', VIRTUAL_ROW_HEIGHT_COMPACT],
    ['comfortable', VIRTUAL_ROW_HEIGHT_COMFORTABLE],
  ] as const)(
    'computes padTop from the %s height constant: spacer = start index × %spx',
    (_density, height) => {
      // Scrolled to the 51st row; the window opens OVERSCAN rows above it.
      const scrollTop = height * 50;
      const total = 500;
      const { window: win } = mountAt(scrollTop, total, height);

      expect(win.start).toBe(50 - 10); // first row - overscan
      // The pin: the spacer stands in for exactly `start` rows at the same
      // height the rendered <tr>s use — never a neighbouring constant.
      expect(win.padTop).toBe(win.start * height);
      expect(win.padBottom).toBe((total - win.end) * height);
      // Spacers + rendered rows account for the whole list at one height.
      expect(win.padTop + (win.end - win.start) * height + win.padBottom).toBe(total * height);
    }
  );
});

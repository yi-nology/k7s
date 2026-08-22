/**
 * useVirtualRows — custom hook for virtual scrolling in tables.
 *
 * Extracted to reduce ResourceTable.tsx size and improve reusability.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { rowWindow, type RowWindow } from '../../lib/virtual';

/** Lists longer than this are windowed; shorter ones render whole. */
export const VIRTUAL_THRESHOLD = 200;

/**
 * The two windowed row heights (P3 density) — the single source for every place
 * that needs the number: ResourceTable pins each windowed <tr> inline to the
 * active one, and the spacers/window below are computed from the value the
 * caller passes in. Exported so the spacer math and the real layout cannot
 * drift apart. Compact is the design's 26px row; comfortable keeps some of the
 * default density's air at 34px.
 */
export const VIRTUAL_ROW_HEIGHT_COMPACT = 26;
export const VIRTUAL_ROW_HEIGHT_COMFORTABLE = 34;

/** Number of rows to render above and below the visible area. */
const OVERSCAN = 10;

/**
 * Track scroll position and viewport height, and derive the row window from them.
 * `rowHeight` is the ACTIVE density's windowed-row height (one of the exported
 * constants above): the row window and both spacers are computed from it, so it
 * must be the same number the caller pins the rendered rows to.
 * Returns `virtual: false` for lists short enough to render whole.
 */
export function useVirtualRows(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  total: number,
  rowHeight: number
): { virtual: boolean; window: RowWindow } {
  const virtual = total > VIRTUAL_THRESHOLD;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);

  // A ref, so the scroll handler doesn't have to be re-attached when it flips.
  const virtualRef = useRef(virtual);
  virtualRef.current = virtual;

  // Seed from the DOM whenever windowing engages. While it was off the handler
  // below ignored scrolling, so the state can be stale by now — switching to a
  // short kind lets the browser clamp scrollTop to 0 unobserved, and windowing
  // around that abandoned offset would render the window behind a huge spacer,
  // i.e. a blank table.
  useEffect(() => {
    const el = scrollRef.current;
    if (virtual && el) setScrollTop(el.scrollTop);
  }, [virtual, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      // Short lists render whole; re-rendering them on every scroll event would
      // be pure waste. The effect above repairs the state when this stops.
      if (virtualRef.current) setScrollTop(el.scrollTop);
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);

    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [scrollRef]);

  const window = useMemo(
    () =>
      virtual
        ? rowWindow(total, scrollTop, viewportH, rowHeight, OVERSCAN)
        : { start: 0, end: total, padTop: 0, padBottom: 0 },
    [virtual, total, scrollTop, viewportH, rowHeight]
  );

  return { virtual, window };
}

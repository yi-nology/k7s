/**
 * Hook for zoom and pan interactions.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { clamp, MIN_ZOOM, MAX_ZOOM, MINIMAP_SIZE } from '../constants';

interface ViewTransform {
  k: number;
  x: number;
  y: number;
}

interface GraphBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Manages zoom and pan state for the topology graph canvas.
 *
 * Handles wheel zoom (cursor-centered), click-drag pan, zoom buttons
 * (+/-/fit), minimap click-to-navigate, and auto-fit on first render.
 * Tracks container size via ResizeObserver.
 *
 * @param containerRef - Ref to the graph container div.
 * @param graphBounds - Bounding box of all graph nodes (for fit-to-graph).
 * @returns View transform, container size, and event handlers for the canvas.
 *
 * @example
 * ```tsx
 * const { viewTransform, handleWheel, startPan } = useZoomPan(containerRef, bounds);
 * // <div onWheel={handleWheel} onMouseDown={startPan}>...</div>
 * ```
 */
export function useZoomPan(
  containerRef: React.RefObject<HTMLDivElement | null>,
  graphBounds: GraphBounds
) {
  const [viewTransform, setViewTransform] = useState<ViewTransform>({ k: 1, x: 0, y: 0 });
  const [containerSize, setContainerSize] = useState({ w: 800, h: 500 });
  const panRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  // Resize observer.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({
        w: Math.round(r.width) || 800,
        h: Math.round(r.height) || 500,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  // Auto-fit on first render.
  const didFitRef = useRef(false);
  const fitToGraph = useCallback(() => {
    if (didFitRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 10) return;
    const bw = graphBounds.maxX - graphBounds.minX;
    const bh = graphBounds.maxY - graphBounds.minY;
    if (bw < 1 || bh < 1) return;
    const k = clamp(Math.min(rect.width / bw, rect.height / bh) * 0.85, MIN_ZOOM, MAX_ZOOM);
    const cx = (graphBounds.minX + graphBounds.maxX) / 2;
    const cy = (graphBounds.minY + graphBounds.maxY) / 2;
    const tx = rect.width / 2 - cx * k;
    const ty = rect.height / 2 - cy * k;
    setViewTransform({ k, x: tx, y: ty });
    didFitRef.current = true;
  }, [containerRef, graphBounds]);

  // Zoom/pan handlers.
  const handleWheel = useCallback(
    (e: ReactWheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setViewTransform((v) => {
        const el = containerRef.current;
        if (!el) return v;
        const rect = el.getBoundingClientRect();
        const newK = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const graphX = (mx - v.x) / v.k;
        const graphY = (my - v.y) / v.k;
        const newX = mx - graphX * newK;
        const newY = my - graphY * newK;
        return { k: newK, x: newX, y: newY };
      });
    },
    [containerRef]
  );

  const startPan = useCallback(
    (e: ReactMouseEvent) => {
      panRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        origX: viewTransform.x,
        origY: viewTransform.y,
      };
    },
    [viewTransform.x, viewTransform.y]
  );

  const handlePanMove = useCallback((e: ReactMouseEvent): boolean => {
    if (!panRef.current.active) return false;
    const dx = e.clientX - panRef.current.startX;
    const dy = e.clientY - panRef.current.startY;
    setViewTransform((v) => ({
      ...v,
      x: panRef.current.origX + dx,
      y: panRef.current.origY + dy,
    }));
    return true;
  }, []);

  const handlePanEnd = useCallback(() => {
    panRef.current.active = false;
  }, []);

  // Zoom control buttons.
  const handleFit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const bw = graphBounds.maxX - graphBounds.minX;
    const bh = graphBounds.maxY - graphBounds.minY;
    if (bw < 1 || bh < 1) return;
    const k = clamp(Math.min(rect.width / bw, rect.height / bh) * 0.85, MIN_ZOOM, MAX_ZOOM);
    const cx = (graphBounds.minX + graphBounds.maxX) / 2;
    const cy = (graphBounds.minY + graphBounds.maxY) / 2;
    const tx = rect.width / 2 - cx * k;
    const ty = rect.height / 2 - cy * k;
    setViewTransform({ k, x: tx, y: ty });
    didFitRef.current = true;
  }, [containerRef, graphBounds]);

  const handleZoomIn = useCallback(() => {
    setViewTransform((v) => {
      const el = containerRef.current;
      if (!el) return v;
      const rect = el.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const newK = clamp(v.k * 1.3, MIN_ZOOM, MAX_ZOOM);
      const graphX = (cx - v.x) / v.k;
      const graphY = (cy - v.y) / v.k;
      return { k: newK, x: cx - graphX * newK, y: cy - graphY * newK };
    });
  }, [containerRef]);

  const handleZoomOut = useCallback(() => {
    setViewTransform((v) => {
      const el = containerRef.current;
      if (!el) return v;
      const rect = el.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const newK = clamp(v.k * 0.7, MIN_ZOOM, MAX_ZOOM);
      const graphX = (cx - v.x) / v.k;
      const graphY = (cy - v.y) / v.k;
      return { k: newK, x: cx - graphX * newK, y: cy - graphY * newK };
    });
  }, [containerRef]);

  // Minimap click-to-navigate.
  const handleMinimapClick = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      const target = e.currentTarget;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const bw = graphBounds.maxX - graphBounds.minX;
      const bh = graphBounds.maxY - graphBounds.minY;
      const minimapScale = MINIMAP_SIZE / Math.max(bw, bh, 1);
      const graphX = graphBounds.minX + mx / minimapScale;
      const graphY = graphBounds.minY + my / minimapScale;
      const k = viewTransform.k;
      const el = containerRef.current;
      if (!el) return;
      const svgRect = el.getBoundingClientRect();
      const tx = svgRect.width / 2 - graphX * k;
      const ty = svgRect.height / 2 - graphY * k;
      setViewTransform({ k, x: tx, y: ty });
    },
    [containerRef, graphBounds, viewTransform.k]
  );

  return {
    viewTransform,
    setViewTransform,
    containerSize,
    fitToGraph,
    handleWheel,
    startPan,
    handlePanMove,
    handlePanEnd,
    handleFit,
    handleZoomIn,
    handleZoomOut,
    handleMinimapClick,
  };
}

/**
 * Shared Plotly chart used by the node and pod Metrics tabs (B27).
 *
 * Both tabs draw the same kind of small, live, non-interactive line chart on the
 * inspector's dark panel surface, so the Plotly wrapper, the lazy library load,
 * and the host-surface colour resolution live here rather than being duplicated.
 */

import { useEffect, useRef } from 'react';
import styles from './PlotChart.module.css';
import { baseLayout, PLOT_CONFIG } from './plot';

/**
 * Plotly, loaded on first use.
 *
 * The library is ~1.1MB — more than half the app's bundle — and only the metrics
 * tabs need it, so it's a dynamic import that vite splits into its own chunk.
 * Someone who never opens a Metrics tab never downloads or parses it. The promise
 * is cached at module scope so many charts on one tab share one load.
 */
let plotlyPromise: Promise<typeof import('plotly.js-basic-dist-min')> | null = null;
function loadPlotly() {
  plotlyPromise ??= import('plotly.js-basic-dist-min');
  return plotlyPromise;
}

/**
 * One Plotly chart.
 *
 * `Plotly.react` rather than `newPlot`: it diffs against what's already drawn, so
 * a new point every poll updates the existing traces instead of tearing the plot
 * down and rebuilding it — which would flicker and lose any hover.
 */
export function Plot({
  title,
  data,
  layoutExtra,
  height = 150,
}: {
  title: string;
  data: unknown[];
  layoutExtra?: Record<string, unknown>;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // Resolve layout colours from the plot host so a dark panel surface wins.
    const layout = { ...baseLayout(title, height, ref.current), ...layoutExtra };
    void loadPlotly().then((Plotly) => {
      // The tab can close while the chunk is in flight.
      if (cancelled || !ref.current) return;
      void Plotly.react(ref.current, data as never, layout as never, PLOT_CONFIG as never);
    });
    return () => {
      cancelled = true;
    };
  });

  // Purge on unmount only: Plotly attaches listeners and DOM that leak if the
  // node is simply dropped.
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) void loadPlotly().then((Plotly) => Plotly.purge(el));
    };
  }, []);

  return <div className={styles.plot} ref={ref} />;
}

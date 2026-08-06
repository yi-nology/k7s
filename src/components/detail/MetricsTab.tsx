/**
 * Metrics tab: live CPU / memory plots for a node.
 *
 * Two data paths, picked by environment:
 *   - Desktop (Tauri): the rich node-exporter series — CPU rates, network,
 *     load, filesystems — scraped via a port-forward to the node's exporter
 *     (B27). Needs node-exporter running on the cluster.
 *   - Browser (web): a CPU/MEM series accumulated from the `nodeMetrics` store
 *     slice (fed by metrics.k8s.io, which the Dashboard already uses). No
 *     node-exporter required, at the cost of the network/load/filesystem panels
 *     (metrics.k8s.io doesn't carry those).
 *
 * Both paths are live-only and start empty; the first point takes one poll.
 */

import React, { useRef } from 'react';
import styles from './MetricsTab.module.css';
import { useStore } from '../../store';
import { useNodeStats } from '../../hooks/useNodeStats';
import { useNodeMetricsSeries } from '../../hooks/useNodeMetricsSeries';
import { useTranslation } from '../../hooks/useI18n';
import { IS_TAURI } from '../../providers';
import { humanBytes, humanBps, plotColors } from './plot';
import { Plot, useHostPlotColors } from './PlotChart';
import { withAlpha } from '../../lib/theme';
import type { NodeSample } from '../../providers/types';

export function MetricsTab() {
  // Desktop keeps the node-exporter path; the browser uses metrics.k8s.io.
  // Splitting here (rather than in DetailPanel) keeps one component owning the
  // tab's layout, so the two paths can share the Plot/theme helpers.
  if (IS_TAURI) return <NodeExporterMetrics />;
  return <KubeMetricsIoMetrics />;
}

/** Desktop path — the original node-exporter series (B27). Unchanged. */
function NodeExporterMetrics() {
  const row = useStore((s) => s.selectedRow);
  const node = row?.name;
  const samples = useStore((s) => (node ? (s.nodeSamples[node] ?? EMPTY) : EMPTY));
  const error = useStore((s) => (node ? s.nodeStatsErrors[node] : undefined));
  const wrapRef = useRef<HTMLDivElement>(null);
  const PLOT_COLORS = useHostPlotColors(wrapRef);
  const { t } = useTranslation();

  useNodeStats(node);

  if (!node) return null;

  if (error) {
    return (
      <div className={styles.wrap} ref={wrapRef}>
        <div className={styles.state}>
          <div className={styles.stateTitle}>{t('metrics.noMetrics', node)}</div>
          <div className={styles.stateBody}>{error}</div>
        </div>
      </div>
    );
  }

  if (samples.length === 0) {
    return (
      <div className={styles.wrap} ref={wrapRef}>
        <div className={styles.state}>
          <div className={styles.stateTitle}>{t('metrics.waitingSamples')}</div>
          <div className={styles.stateBody}>
            Rates need two scrapes to compare, so the first point takes a couple of polls. The
            history starts now — node-exporter reports counters, not the past.
          </div>
        </div>
      </div>
    );
  }

  const tArr = samples.map((s) => new Date(s.ts));
  const latest = samples[samples.length - 1];

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <Plot
        title={t('metrics.cpuTitle', latest.cpuPercent.toFixed(1))}
        data={[
          {
            x: tArr,
            y: samples.map((s) => s.cpuPercent),
            type: 'scatter',
            mode: 'lines',
            line: { color: PLOT_COLORS.accent, width: 1.5, shape: 'spline', smoothing: 0.4 },
            fill: 'tozeroy',
            fillcolor: withAlpha(PLOT_COLORS.accent, 0.12),
            hovertemplate: '%{y:.1f}%<extra></extra>',
          },
        ]}
        layoutExtra={{ yaxis: { range: [0, 100], ticksuffix: '%', gridcolor: PLOT_COLORS.grid } }}
      />

      <Plot
        title={t(
          'metrics.memTitle',
          humanBytes(latest.memUsedBytes),
          humanBytes(latest.memTotalBytes),
          pct(latest.memUsedBytes, latest.memTotalBytes)
        )}
        data={[
          {
            x: tArr,
            y: samples.map((s) => s.memUsedBytes),
            type: 'scatter',
            mode: 'lines',
            line: { color: PLOT_COLORS.ok, width: 1.5 },
            fill: 'tozeroy',
            fillcolor: withAlpha(PLOT_COLORS.ok, 0.12),
            hovertemplate: '%{y:.3s}B<extra></extra>',
          },
        ]}
        layoutExtra={{
          yaxis: {
            range: [0, latest.memTotalBytes],
            tickformat: '.3s',
            ticksuffix: 'B',
            gridcolor: PLOT_COLORS.grid,
          },
        }}
      />

      <Plot
        title={t('metrics.netTitle', humanBps(latest.netRxBps), humanBps(latest.netTxBps))}
        data={[
          {
            x: tArr,
            y: samples.map((s) => s.netRxBps),
            name: 'rx',
            type: 'scatter',
            mode: 'lines',
            line: { color: PLOT_COLORS.accent, width: 1.5 },
            hovertemplate: '↓ %{y:.3s}B/s<extra></extra>',
          },
          {
            x: tArr,
            y: samples.map((s) => s.netTxBps),
            name: 'tx',
            type: 'scatter',
            mode: 'lines',
            line: { color: PLOT_COLORS.warn, width: 1.5 },
            hovertemplate: '↑ %{y:.3s}B/s<extra></extra>',
          },
        ]}
        layoutExtra={{
          showlegend: true,
          legend: { orientation: 'h', y: 1.16, x: 1, xanchor: 'right', font: { size: 9 } },
          yaxis: {
            rangemode: 'tozero',
            tickformat: '.3s',
            ticksuffix: 'B/s',
            gridcolor: PLOT_COLORS.grid,
          },
        }}
      />

      <Plot
        title={t(
          'metrics.loadTitle',
          latest.load1.toFixed(2),
          latest.load5.toFixed(2),
          latest.load15.toFixed(2)
        )}
        data={[
          {
            x: tArr,
            y: samples.map((s) => s.load1),
            name: '1m',
            type: 'scatter',
            mode: 'lines',
            line: { color: PLOT_COLORS.accent, width: 1.5 },
          },
          {
            x: tArr,
            y: samples.map((s) => s.load5),
            name: '5m',
            type: 'scatter',
            mode: 'lines',
            line: { color: PLOT_COLORS.accent2, width: 1.2 },
          },
          {
            x: tArr,
            y: samples.map((s) => s.load15),
            name: '15m',
            type: 'scatter',
            mode: 'lines',
            line: { color: PLOT_COLORS.axis, width: 1, dash: 'dot' },
          },
        ]}
        layoutExtra={{
          showlegend: true,
          legend: { orientation: 'h', y: 1.16, x: 1, xanchor: 'right', font: { size: 9 } },
          yaxis: { rangemode: 'tozero', gridcolor: PLOT_COLORS.grid },
        }}
      />

      <Filesystems
        sample={latest}
        colors={PLOT_COLORS}
        title={t('metrics.filesystemsTitle', latest.filesystems.length)}
      />
    </div>
  );
}

/**
 * Browser path — CPU/MEM from metrics.k8s.io, accumulated into a live series.
 * Network/load/filesystem aren't available from this source; a footnote says
 * so rather than silently omitting them.
 */
function KubeMetricsIoMetrics() {
  const row = useStore((s) => s.selectedRow);
  const node = row?.name;
  const series = useNodeMetricsSeries(node);
  const wrapRef = useRef<HTMLDivElement>(null);
  const PLOT_COLORS = useHostPlotColors(wrapRef);
  const { t } = useTranslation();

  if (!node) return null;

  if (series.length === 0) {
    return (
      <div className={styles.wrap} ref={wrapRef}>
        <div className={styles.state}>
          <div className={styles.stateTitle}>{t('metrics.waitingSamples')}</div>
          <div className={styles.stateBody}>{t('metrics.waitingSamplesBody')}</div>
        </div>
      </div>
    );
  }

  const tArr = series.map((s) => new Date(s.ts));
  const latest = series[series.length - 1];
  const memTotal = latest.memTotalBytes || 1;

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <Plot
        title={t('metrics.cpuTitle', latest.cpuPercent.toFixed(1))}
        data={[
          {
            x: tArr,
            y: series.map((s) => s.cpuPercent),
            type: 'scatter',
            mode: 'lines',
            line: { color: PLOT_COLORS.accent, width: 1.5, shape: 'spline', smoothing: 0.4 },
            fill: 'tozeroy',
            fillcolor: withAlpha(PLOT_COLORS.accent, 0.12),
            hovertemplate: '%{y:.1f}%<extra></extra>',
          },
        ]}
        layoutExtra={{ yaxis: { range: [0, 100], ticksuffix: '%', gridcolor: PLOT_COLORS.grid } }}
      />

      <Plot
        title={t(
          'metrics.memTitle',
          humanBytes(latest.memBytes),
          humanBytes(latest.memTotalBytes),
          pct(latest.memBytes, memTotal)
        )}
        data={[
          {
            x: tArr,
            y: series.map((s) => s.memBytes),
            type: 'scatter',
            mode: 'lines',
            line: { color: PLOT_COLORS.ok, width: 1.5 },
            fill: 'tozeroy',
            fillcolor: withAlpha(PLOT_COLORS.ok, 0.12),
            hovertemplate: '%{y:.3s}B<extra></extra>',
          },
        ]}
        layoutExtra={{
          yaxis: {
            range: [0, memTotal],
            tickformat: '.3s',
            ticksuffix: 'B',
            gridcolor: PLOT_COLORS.grid,
          },
        }}
      />

      <div className={styles.footnote}>{t('metrics.kubeMetricsFootnote')}</div>
    </div>
  );
}

/** Current filesystem usage as a horizontal bar per mount. (Desktop path only.)
 *  Memoized: filesystem data only changes on node-exporter scrape intervals. */
const Filesystems = React.memo(function Filesystems({
  sample,
  colors: PLOT_COLORS,
  title,
}: {
  sample: NodeSample;
  colors: ReturnType<typeof plotColors>;
  title: string;
}) {
  if (sample.filesystems.length === 0) return null;

  const fs = [...sample.filesystems]
    .map((f) => ({ ...f, pct: (100 * f.usedBytes) / Math.max(f.sizeBytes, 1) }))
    .sort((a, b) => a.pct - b.pct);

  const color = (p: number) =>
    p >= 90 ? PLOT_COLORS.err : p >= 75 ? PLOT_COLORS.warn : PLOT_COLORS.accent;

  return (
    <Plot
      title={title}
      height={Math.max(120, 26 * fs.length + 40)}
      data={[
        {
          type: 'bar',
          orientation: 'h',
          x: fs.map((f) => f.pct),
          y: fs.map((f) => f.mountpoint),
          marker: { color: fs.map((f) => color(f.pct)) },
          text: fs.map((f) => `${humanBytes(f.usedBytes)} / ${humanBytes(f.sizeBytes)}`),
          textposition: 'auto',
          insidetextfont: { color: PLOT_COLORS.surface, size: 9 },
          outsidetextfont: { color: PLOT_COLORS.axis, size: 9 },
          hovertemplate: '%{y}: %{x:.1f}%<extra></extra>',
        },
      ]}
      layoutExtra={{
        xaxis: { range: [0, 100], ticksuffix: '%', gridcolor: PLOT_COLORS.grid },
        yaxis: { automargin: true, gridcolor: 'rgba(0,0,0,0)' },
        margin: { l: 8, r: 12, t: 26, b: 28 },
        bargap: 0.35,
      }}
    />
  );
});

/** "42%" for a used/total pair. */
function pct(used: number, total: number): string {
  return `${((100 * used) / Math.max(total, 1)).toFixed(0)}%`;
}

/** Stable empty array so the selector doesn't churn renders. */
const EMPTY: NodeSample[] = [];

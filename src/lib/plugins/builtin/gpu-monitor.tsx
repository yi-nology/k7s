/**
 * GPU Monitor — built-in plugin that surfaces NVIDIA GPU metrics on the
 * dashboard. Queries `nvidia_gpu_*` Prometheus metrics via the provider's
 * metricsQuery API and renders a compact card showing GPU count, average
 * utilization, and memory usage.
 *
 * Graceful degradation:
 *   - No Prometheus configured -> "No Prometheus instance configured"
 *   - Prometheus configured but no GPU metrics -> "No GPU resources detected"
 *   - Query error -> "GPU metrics unavailable"
 *
 * The card is registered as a DashboardCardDef so it appears automatically
 * in the dashboard's plugin-cards section once the plugin manager activates
 * this plugin.
 */

import { useEffect, useState } from 'react';
import type { K7sPlugin, PluginAPI } from '../types';
import { getProvider } from '../../../providers';

// ---------------------------------------------------------------------------
// Prometheus query helpers
// ---------------------------------------------------------------------------

/** Try an instant PromQL query; returns null on any error (missing instance,
 *  query failure, empty resultset). */
async function tryQuery(promql: string): Promise<string | null> {
  try {
    const instances = await getProvider().metricsList();
    if (instances.length === 0) return null;
    const result = await getProvider().metricsQuery(instances[0].name, promql);
    // Instant results carry `series[0]?.samples[0]?.value` as the scalar.
    const val = result.series?.[0]?.samples?.[0]?.value;
    return val != null ? String(val) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dashboard card component
// ---------------------------------------------------------------------------

interface GpuState {
  loading: boolean;
  available: boolean; // GPU metrics exist at all
  prometheusConfigured: boolean;
  count: string;
  utilAvg: string;
  memUsed: string;
  memTotal: string;
}

const INITIAL_STATE: GpuState = {
  loading: true,
  available: false,
  prometheusConfigured: true,
  count: '0',
  utilAvg: '0%',
  memUsed: '0 MiB',
  memTotal: '0 MiB',
};

function GpuDashboardCard() {
  const [state, setState] = useState<GpuState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // 1. Check if Prometheus is configured.
      let instances;
      try {
        instances = await getProvider().metricsList();
      } catch {
        if (!cancelled) setState({ ...INITIAL_STATE, loading: false, prometheusConfigured: false });
        return;
      }
      if (cancelled) return;
      if (instances.length === 0) {
        setState({ ...INITIAL_STATE, loading: false, prometheusConfigured: false });
        return;
      }

      // 2. Probe for GPU count — the simplest DCGM/nvidia query.
      const countStr = await tryQuery(
        'count(DCGM_FI_DEV_GPU_TEMP) or count(nvidia_gpu_utilization_gpu)'
      );
      if (cancelled) return;

      if (!countStr || countStr === '0') {
        // No GPU metrics at all — the NVIDIA device plugin is not installed.
        setState({ ...INITIAL_STATE, loading: false, available: false });
        return;
      }

      // 3. GPU metrics exist — pull the three headline numbers.
      const [utilStr, memUsedStr, memTotalStr] = await Promise.all([
        tryQuery('avg(DCGM_FI_DEV_GPU_UTIL or nvidia_gpu_utilization_gpu)'),
        tryQuery('sum(DCGM_FI_DEV_FB_USED or nvidia_gpu_memory_used_bytes) / 1024 / 1024'),
        tryQuery(
          'sum(DCGM_FI_DEV_FB_FREE or nvidia_gpu_memory_free_bytes + DCGM_FI_DEV_FB_USED or nvidia_gpu_memory_used_bytes) / 1024 / 1024'
        ),
      ]);
      if (cancelled) return;

      const formatMiB = (v: string | null) => {
        const n = parseFloat(v ?? '0');
        if (n >= 1024) return `${(n / 1024).toFixed(1)} GiB`;
        return `${Math.round(n)} MiB`;
      };

      setState({
        loading: false,
        available: true,
        prometheusConfigured: true,
        count: countStr,
        utilAvg: `${Math.round(parseFloat(utilStr ?? '0'))}%`,
        memUsed: formatMiB(memUsedStr),
        memTotal: formatMiB(memTotalStr),
      });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- render ----
  const cardStyle: React.CSSProperties = {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    fontSize: '13px',
    color: 'var(--text-primary, #e0e0e0)',
    minWidth: '200px',
  };
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };
  const labelStyle: React.CSSProperties = {
    color: 'var(--text-muted, #888)',
    fontSize: '12px',
  };
  const valueStyle: React.CSSProperties = {
    fontWeight: 600,
    fontFamily: 'var(--font-mono, monospace)',
  };
  const mutedStyle: React.CSSProperties = {
    padding: '16px',
    color: 'var(--text-muted, #888)',
    fontSize: '13px',
    textAlign: 'center' as const,
  };

  if (state.loading) {
    return { type: 'div', props: { style: mutedStyle, children: 'Loading GPU metrics...' } } as any;
  }
  if (!state.prometheusConfigured) {
    return {
      type: 'div',
      props: { style: mutedStyle, children: 'No Prometheus instance configured.' },
    } as any;
  }
  if (!state.available) {
    return {
      type: 'div',
      props: {
        style: mutedStyle,
        children: 'No GPU resources detected. Install the NVIDIA device plugin to see GPU metrics.',
      },
    } as any;
  }

  const rows = [
    { label: 'GPUs', value: state.count },
    { label: 'Avg Utilization', value: state.utilAvg },
    { label: 'Memory Used', value: state.memUsed },
    { label: 'Memory Total', value: state.memTotal },
  ];

  return {
    type: 'div',
    props: {
      style: cardStyle,
      children: rows.map((r) => ({
        type: 'div',
        props: {
          style: rowStyle,
          children: [
            { type: 'span', props: { style: labelStyle, children: r.label }, key: r.label },
            { type: 'span', props: { style: valueStyle, children: r.value }, key: r.label + '-v' },
          ],
        },
        key: r.label,
      })),
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export const gpuMonitorPlugin: K7sPlugin = {
  id: 'gpu-monitor',
  name: 'GPU Monitor',
  version: '0.1.0',
  description:
    'Cluster-wide GPU utilisation overview. Queries NVIDIA DCGM / device-plugin metrics via Prometheus.',
  author: 'k7s',

  activate(api: PluginAPI) {
    api.registerDashboardCard({
      id: 'gpu-overview',
      title: 'GPU Overview',
      component: GpuDashboardCard,
    });
  },
};

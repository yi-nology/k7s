/**
 * GPU Monitor — built-in plugin that surfaces NVIDIA GPU metrics on the
 * dashboard. The card component lives in ./GpuDashboardCard (extracted so this
 * file only exports the plugin definition — react-refresh).
 *
 * The card is registered as a DashboardCardDef so it appears automatically in
 * the dashboard's plugin-cards section once the plugin manager activates this
 * plugin.
 */

import type { K7sPlugin, PluginAPI } from '../types';
import { GpuDashboardCard } from './GpuDashboardCard';

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

/**
 * Built-in example plugins that ship with k7s.
 *
 * These demonstrate the plugin API surface. They are lightweight stubs —
 * real functionality would require backend support — but they exercise every
 * extension point: sidebar items, detail tabs, dashboard cards, and the
 * PluginAPI for resource access and navigation.
 */

import type { K7sPlugin } from './types';
import { gpuMonitorPlugin } from './builtin/gpu-monitor';

// ---------------------------------------------------------------------------
// Network Policy Viewer stub
// ---------------------------------------------------------------------------

/**
 * Adds a "Network Policies" tab to the detail panel when viewing a Pod or
 * Namespace, showing the policies that select that resource. A production
 * version would call the backend for the actual policy list.
 */
export const netpolViewerPlugin: K7sPlugin = {
  id: 'netpol-viewer',
  name: 'Network Policy Viewer',
  version: '0.1.0',
  description: 'Shows network policies affecting a pod or namespace (stub).',
  author: 'k7s',

  activate(api) {
    api.registerDetailTab({
      id: 'netpol-tab',
      label: 'Net Policies',
      kinds: ['pods', 'namespaces'],
      component: NetPolTab,
    });
  },
};

function NetPolTab({ row }: { row: any }) {
  // Placeholder: a real version would fetch policies from the store or provider.
  return {
    type: 'div',
    props: {
      style: { padding: '16px', color: 'var(--text-muted)', fontSize: '13px' },
      children: `Network policies for ${row?.namespace ?? 'cluster'}/${row?.name ?? '?'}: (stub — install the backend plugin to list policies).`,
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/** All built-in plugins, in registration order. */
export const BUILTIN_PLUGINS: K7sPlugin[] = [gpuMonitorPlugin, netpolViewerPlugin];

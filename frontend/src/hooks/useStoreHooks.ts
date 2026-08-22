/**
 * Common store hooks to reduce repetitive useStore patterns.
 * These hooks provide a cleaner API for frequently accessed store values.
 */

import { useStore } from '../store';
import type { CustomKind, KindId } from '../providers/types';
import type { Settings } from '../lib/settings';
import type { ConnectionState } from '../store/types';

/**
 * Hook to get the currently selected row.
 * Usage: const selectedRow = useSelectedRow();
 */
export function useSelectedRow() {
  return useStore((s) => s.selectedRow);
}

/**
 * Hook to get the current navigation kind.
 * Usage: const nav = useNav();
 */
export function useNav(): KindId {
  return useStore((s) => s.nav);
}

/**
 * Hook to get the current settings.
 * Usage: const settings = useSettings();
 */
export function useSettings(): Settings {
  return useStore((s) => s.settings);
}

/**
 * Hook to get the current connection state.
 * Usage: const connection = useConnection();
 */
export function useConnection(): ConnectionState {
  return useStore((s) => s.connection);
}

/**
 * Hook to get the custom kinds.
 * Usage: const customKinds = useCustomKinds();
 */
export function useCustomKinds(): CustomKind[] {
  return useStore((s) => s.customKinds);
}

/**
 * Hook to get the current namespace filter.
 * Usage: const namespace = useNamespace();
 */
export function useNamespace(): string {
  return useStore((s) => s.namespace);
}

/**
 * Hook to get the current rows for a specific kind.
 * Usage: const rows = useRows('pods');
 */
export function useRows(kind: string) {
  return useStore((s) => s.rows[kind] ?? []);
}

/**
 * Hook to get the current pod metrics.
 * Usage: const podMetrics = usePodMetrics();
 */
export function usePodMetrics() {
  return useStore((s) => s.podMetrics);
}

/**
 * Hook to get the current node metrics.
 * Usage: const nodeMetrics = useNodeMetrics();
 */
export function useNodeMetrics() {
  return useStore((s) => s.nodeMetrics);
}

/**
 * Hook to get the current selection state.
 * Usage: const selection = useSelection();
 */
export function useSelection() {
  return useStore((s) => s.selection);
}

/**
 * Hook to get the current sort state.
 * Usage: const { sortCol, sortDir, toggleSort } = useSort();
 */
export function useSort() {
  const sortCol = useStore((s) => s.sortCol);
  const sortDir = useStore((s) => s.sortDir);
  const toggleSort = useStore((s) => s.toggleSort);
  return { sortCol, sortDir, toggleSort };
}

/**
 * Hook to get the current filter state.
 * Usage: const { tableFilter, setTableFilter } = useTableFilter();
 */
export function useTableFilter() {
  const tableFilter = useStore((s) => s.tableFilter);
  const setTableFilter = useStore((s) => s.setTableFilter);
  return { tableFilter, setTableFilter };
}

/**
 * Hook to get the current events since state.
 * Usage: const { eventsSince, setEventsSince } = useEventsSince();
 */
export function useEventsSince() {
  const eventsSince = useStore((s) => s.eventsSince);
  const setEventsSince = useStore((s) => s.setEventsSince);
  return { eventsSince, setEventsSince };
}

/**
 * Table utility functions for ResourceTable.
 *
 * Extracted to reduce ResourceTable.tsx size and improve reusability.
 */

import type { Cell, KindId, NodeMetricsMap, PodMetricsMap, Row } from '../../providers/types';
import { formatAge, formatCpu, formatMem } from '../../lib/format';
import { isRolloutKind } from '../../lib/kinds';
import { localizeStatus } from '../../lib/statusLabels';
import styles from './ResourceTable.module.css';

/** The sticky header's height, so a row isn't scrolled to sit behind it. */
export function headerHeight(scrollEl: HTMLElement): number {
  return scrollEl.querySelector('thead')?.getBoundingClientRect().height ?? 0;
}

/**
 * Width for a column, keyed by header name (B21).
 *
 * `table-layout: fixed` sizes columns from `<col>` and splits the width
 * *equally* when there are none — so without this, a pod name would get the
 * same share as its restart count. NAME and MESSAGE use `"auto"` so they fill
 * whatever space remains after the fixed-percentage columns.
 *
 * Names and free text get the room; short, bounded values get only what they
 * need. Anything unlisted (including CRD columns) falls back to a middling share.
 */
export function columnWidth(header: string): string {
  switch (header) {
    case 'NAME':
    case 'MESSAGE':
      return 'auto';
    case 'OBJECT':
    case 'HOSTS':
    case 'IMAGE':
      return '16%';
    case 'NAMESPACE':
    case 'REASON':
    case 'PORTS':
    case 'CLUSTER-IP':
    case 'SCHEDULE':
      return '12%';
    case 'AGE':
    case 'READY':
    case 'COUNT':
    case 'TYPE':
    case 'STATUS':
    case 'RESTARTS':
    case 'CPU':
    case 'MEM':
      return '8%';
    default:
      return '10%';
  }
}

/**
 * Render a cell's text: format age timestamps, prefix a status dot when set.
 *
 * @param cell - The cell to render
 * @param now - Current timestamp for age formatting
 * @param locale - When set, a known status word is localized (zh) and the pill
 *   gets a `title` tooltip of "raw — cause hint". Omitted, the pill shows the
 *   raw backend string — the behavior every pre-locale caller relied on.
 * @returns React node with formatted text and optional status dot
 */
export function renderCell(cell: Cell, now: number, locale?: 'en' | 'zh'): React.ReactNode {
  const text = cell.format === 'age' ? formatAge(cell.text, now) : cell.text;
  if (!cell.dot) return text;
  // Tone-classed pill: the dot gets a halo and a one-character label, the text
  // is colored by its tone. Map the cell's tone to the corresponding status* class.
  const toneCls =
    cell.tone === 'ok'
      ? styles.statusRunning
      : cell.tone === 'warn'
        ? styles.statusPending
        : cell.tone === 'err'
          ? styles.statusFailed
          : '';
  // Known status + locale → localized label; the raw string stays one hover
  // away in the tooltip, and unknown statuses keep showing the raw text.
  const loc = locale ? localizeStatus(text, locale) : null;
  return (
    <span
      className={`${styles.status} ${toneCls}`}
      title={loc ? `${loc.raw} — ${loc.hint}` : text}
    >
      <span className={styles.statusDot} aria-hidden="true" />
      {loc?.label ?? text}
    </span>
  );
}

/**
 * Overlay live values that aren't carried on the row itself:
 *  - pods CPU/MEM and node CPU/MEMORY from the metrics feed (real mode; demo keeps
 *    the baked-in values), and
 *  - the Namespaces PODS count, derived from the live pods list (B12).
 */
export function overlayMetrics(
  kind: KindId,
  rows: Row[],
  podMetrics: PodMetricsMap,
  nodeMetrics: NodeMetricsMap,
  podRows: Row[]
): Row[] {
  if (kind === 'pods') {
    return rows.map((r) => {
      const m = podMetrics[`${r.namespace}/${r.name}`];
      if (!m) return r;
      const cells = r.cells.slice();
      // Pods columns: NAME,NAMESPACE,READY,RESTARTS,CPU(4),MEM(5),AGE,STATUS.
      // Carry the raw numbers as sort keys (units aren't lexically comparable).
      cells[4] = { ...cells[4], text: formatCpu(m.cpuMillis), sort: m.cpuMillis };
      cells[5] = { ...cells[5], text: formatMem(m.memBytes), sort: m.memBytes };
      return { ...r, cells };
    });
  }
  if (kind === 'nodes') {
    return rows.map((r) => {
      const m = nodeMetrics[r.name];
      if (!m) return r;
      const cells = r.cells.slice();
      // Nodes columns: NAME,STATUS,ROLES,CPU(3),MEMORY(4),VERSION
      cells[3] = { ...cells[3], text: `${Math.round(m.cpuPercent)}%` };
      cells[4] = { ...cells[4], text: `${Math.round(m.memPercent)}%` };
      return { ...r, cells };
    });
  }
  // Workloads: aggregate pod metrics by matching selector.
  // Columns: NAME,NAMESPACE,...,CPU(last-2),MEM(last-1),AGE(last).
  if (isRolloutKind(kind)) {
    // Build a selector → aggregated metrics map. A pod matches a workload when
    // all the workload's selector labels appear in the pod's labels.
    const aggMap = new Map<string, { cpu: number; mem: number }>();
    for (const pod of podRows) {
      if (!pod.selector) continue;
      const m = podMetrics[`${pod.namespace}/${pod.name}`];
      if (!m) continue;
      // Find all workloads whose selector matches this pod's labels.
      // We key by "namespace/selectorLabels" for namespaced uniqueness.
      for (const r of rows) {
        if (!r.selector) continue;
        if (r.namespace !== pod.namespace) continue;
        const labels = pod.labels ?? {};
        const matches = Object.entries(r.selector).every(([k, v]) => labels[k] === v);
        if (!matches) continue;
        const key = `${r.namespace}/${r.name}`;
        const agg = aggMap.get(key) ?? { cpu: 0, mem: 0 };
        agg.cpu += m.cpuMillis;
        agg.mem += m.memBytes;
        aggMap.set(key, agg);
      }
    }
    return rows.map((r) => {
      const agg = aggMap.get(`${r.namespace}/${r.name}`);
      if (!agg) return r;
      const cells = r.cells.slice();
      // CPU and MEM are the last two columns before AGE.
      const cpuIdx = cells.length - 3;
      const memIdx = cells.length - 2;
      cells[cpuIdx] = { ...cells[cpuIdx], text: formatCpu(agg.cpu), sort: agg.cpu };
      cells[memIdx] = { ...cells[memIdx], text: formatMem(agg.mem), sort: agg.mem };
      return { ...r, cells };
    });
  }
  if (kind === 'namespaces') {
    // Count pods per namespace across all watched pods (watchers are cluster-wide,
    // so this is the true count). Row name is the namespace name.
    const counts = new Map<string, number>();
    for (const p of podRows) {
      counts.set(p.namespace ?? '', (counts.get(p.namespace ?? '') ?? 0) + 1);
    }
    return rows.map((r) => {
      const cells = r.cells.slice();
      // Namespaces columns: NAME,STATUS,PODS(2),AGE
      const count = counts.get(r.name) ?? 0;
      cells[2] = { ...cells[2], text: String(count), sort: count };
      return { ...r, cells };
    });
  }
  return rows;
}

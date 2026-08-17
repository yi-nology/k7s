/**
 * CSV export utility for the resource table.
 *
 * Converts the current (filtered, sorted, metrics-overlaid) row set into a
 * CSV file and triggers a browser download. Uses the same column contract as
 * the table itself — `kindMeta(kind).columns` — so the CSV mirrors exactly
 * what the user sees on screen.
 */

import type { Row } from '../providers/types/table';

/**
 * Convert resource table rows to a CSV string.
 *
 * Each row's `cells[]` is aligned to `columns[]` by index (the same contract
 * the table renderer uses). The row's `name` and `namespace` are included only
 * when the kind's column list does not already contain NAME / NAMESPACE — most
 * namespaced kinds list both explicitly, but events use OBJECT instead of NAME.
 *
 * @param columns - Column headers from kindMeta (e.g. ['NAME','NAMESPACE','READY', …]).
 * @param rows    - Filtered/sorted/metrics-overlaid rows (the `rows` variable in ResourceTable).
 */
export function toCsv(columns: string[], rows: Row[]): string {
  const hasName = columns.includes('NAME');
  const hasNs = columns.includes('NAMESPACE');

  const header: string[] = [];
  if (!hasName) header.push('NAME');
  if (!hasNs) header.push('NAMESPACE');
  header.push(...columns);

  const lines: string[] = [header.map(escapeCsv).join(',')];

  for (const row of rows) {
    const cells: string[] = [];
    if (!hasName) cells.push(row.name);
    if (!hasNs) cells.push(row.namespace ?? '');
    for (let i = 0; i < columns.length; i++) {
      cells.push(row.cells[i]?.text ?? '');
    }
    lines.push(cells.map(escapeCsv).join(','));
  }

  return lines.join('\n');
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Trigger a browser download of CSV content.
 *
 * Uses the same `URL.createObjectURL` + synthetic `<a download>` click
 * pattern as ActionList's `downloadText` — the only client-side save path
 * that works in both the Tauri webview and the `k7s-web` server build
 * without a backend round-trip.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Action utility functions for ActionList.
 *
 * Extracted to reduce ActionList.tsx size and improve reusability.
 */

import type { KindId, Row } from '../../providers/types';

/** Replicas shown as the starting value: the desired count from a "3/3" cell. */
export function currentReplicas(row: Row): number {
  for (const cell of row.cells) {
    const m = /^(\d+)\/(\d+)$/.exec(cell.text.trim());
    if (m) return Number(m[2]);
  }
  return 1;
}

/** A sensible default port: the service's first, else the usual HTTP guess. */
export function defaultPort(row: Row, kind: KindId): number {
  if (kind === 'services') {
    for (const cell of row.cells) {
      const m = /(\d{2,5})/.exec(cell.text);
      if (m) return Number(m[1]);
    }
  }
  return 8080;
}

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard unavailable — the forward still works, it just isn't copied */
  }
}

/**
 * Trigger a browser download of `text` as `filename`. The pod-files panel does
 * the same dance with `URL.createObjectURL` + a synthetic `<a download>` click
 * (B47) — the only client-side save path that works in both the Tauri webview
 * and the `k7s-web` server build without a backend round-trip.
 *
 * Revokes the object URL on the next tick so the click has time to register
 * but the URL doesn't leak. Synchronous click because `URL.revokeObjectURL`
 * is permitted to invalidate the URL immediately after the click handler
 * returns — the browser has already snapshotted the blob reference.
 */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/x-yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Filename for a single resource: `kind-namespace-name.yaml` for namespaced
 *  kinds, `kind-name.yaml` for cluster-scoped ones. Mirrors the path scheme
 *  YamlTab uses (kinds.ts), so the file a user downloads matches the path
 *  they see in the Yaml editor. */
export function yamlFilename(kind: KindId, row: Row): string {
  return row.namespace ? `${kind}/${row.namespace}/${row.name}.yaml` : `${kind}/${row.name}.yaml`;
}

/**
 * Get confirmation label for an action.
 *
 * @param id - The action ID
 * @param locale - The current locale
 * @returns Confirmation label text
 */
export function confirmLabel(id: string, locale: string): string {
  const labels: Record<string, Record<string, string>> = {
    delete: { en: 'Delete', zh: '删除' },
    scale: { en: 'Scale', zh: '扩缩容' },
    cordon: { en: 'Cordon', zh: '封锁' },
    uncordon: { en: 'Uncordon', zh: '解封' },
    restart: { en: 'Restart', zh: '重启' },
    drain: { en: 'Drain', zh: '驱逐' },
    exportYaml: { en: 'Export YAML', zh: '导出 YAML' },
    copyName: { en: 'Copy Name', zh: '复制名称' },
    portForward: { en: 'Port Forward', zh: '端口转发' },
  };
  return labels[id]?.[locale] || labels[id]?.en || id;
}

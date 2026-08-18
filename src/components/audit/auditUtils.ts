/**
 * Audit utility functions for AuditPanel.
 *
 * Extracted to reduce AuditPanel.tsx size and improve reusability.
 */

export function formatTimestamp(ts: string): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString();
  } catch {
    return ts.slice(11, 19);
  }
}

export function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function verbStyle(verb: string): React.CSSProperties {
  const lc = verb.toLowerCase();
  const color =
    lc === 'create'
      ? 'var(--status-ok)'
      : lc === 'delete'
        ? 'var(--status-err)'
        : lc === 'update' || lc === 'patch'
          ? 'var(--status-warn)'
          : 'var(--text-body)';
  return { color, fontWeight: 500 };
}

export function statusStyle(code: number): React.CSSProperties {
  const color =
    code >= 200 && code < 300
      ? 'var(--status-ok)'
      : code >= 400 && code < 500
        ? 'var(--status-warn)'
        : code >= 500
          ? 'var(--status-err)'
          : 'var(--text-body)';
  return { color };
}

/**
 * LogRow — a single log line row component.
 *
 * Memoized: log streams render hundreds of lines and only the
 * showTs/showContainer/query/isCurrentMatch toggles change between renders.
 */

import React from 'react';
import type { LogLine } from '../../providers/types';
import { msgColor } from './logUtils';
import styles from './LogsTab.module.css';

const LEVEL_COLOR: Record<string, string> = {
  ERROR: 'var(--status-err)',
  WARN: 'var(--status-warn)',
  INFO: 'var(--accent)',
  DEBUG: 'var(--text-muted)',
};

/** Highlight all occurrences of `query` within `text` using <mark>. */
function highlightMatches(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const idx = lower.indexOf(ql);
  if (idx === -1) return text;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  let pos = lower.indexOf(ql, last);
  while (pos !== -1) {
    if (pos > last) parts.push(text.slice(last, pos));
    parts.push(
      <mark key={i++} className={styles.highlight}>
        {text.slice(pos, pos + q.length)}
      </mark>
    );
    last = pos + q.length;
    pos = lower.indexOf(ql, last);
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length > 0 ? parts : text;
}

export const LogRow = React.memo(function LogRow({
  line,
  showTs,
  showContainer,
  query,
  isCurrentMatch,
}: {
  line: LogLine;
  showTs: boolean;
  showContainer: boolean;
  query: string;
  isCurrentMatch: boolean;
}) {
  return (
    <div className={`${styles.line} ${isCurrentMatch ? styles.lineActive : ''}`}>
      {showTs && <span className={styles.lineTs}>{line.ts}</span>}
      {showContainer && <span className={styles.lineContainer}>{line.container}</span>}
      <span
        className={styles.lineLevel}
        style={{ color: LEVEL_COLOR[line.level] ?? 'var(--text-muted)' }}
      >
        {line.level}
      </span>
      <span className={styles.lineMsg} style={{ color: msgColor(line.level) }}>
        {highlightMatches(line.msg, query)}
      </span>
    </div>
  );
});

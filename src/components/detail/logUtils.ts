/**
 * Log utility functions for LogsTab.
 *
 * Extracted to reduce LogsTab.tsx size and improve reusability.
 */

/** Message tint: ERROR/WARN get soft tints, everything else is secondary. */
export function msgColor(level: string): string {
  if (level === 'ERROR') return 'var(--status-err-msg)';
  if (level === 'WARN') return 'var(--status-warn-msg)';
  return 'var(--text-secondary)';
}

/** All known log levels for the filter chips. */
export const LOG_LEVELS = ['ALL', 'INFO', 'WARN', 'ERROR', 'DEBUG'] as const;

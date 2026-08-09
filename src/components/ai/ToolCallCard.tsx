/**
 * ToolCallCard — collapsible card showing a tool invocation.
 *
 * Default: collapsed row showing icon + tool name + status pill + duration.
 * Click to expand: shows formatted arguments and result.
 * Write tools in 'pending' state show Approve/Deny buttons inline.
 */
import { useState } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import styles from './AiChat.module.css';

const STATUS_ICONS: Record<string, string> = {
  running: '⏳',
  ok: '✓',
  err: '✗',
  pending: '⚠',
  denied: '⊘',
};

interface Props {
  name: string;
  args: unknown;
  isWrite: boolean;
  state: 'running' | 'ok' | 'err' | 'pending' | 'denied';
  result?: unknown;
  onApprove?: (approved: boolean) => void;
}

export function ToolCallCard({ name, args, isWrite, state, result, onApprove }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(state === 'pending');

  const STATUS_LABELS: Record<string, string> = {
    running: t('ai.toolCall.running'),
    ok: t('ai.toolCall.done'),
    err: t('ai.toolCall.failed'),
    pending: t('ai.toolCall.needsApproval'),
    denied: t('ai.toolCall.denied'),
  };

  const stateClass =
    state === 'ok'
      ? styles.toolOk
      : state === 'err'
        ? styles.toolErr
        : state === 'pending'
          ? styles.toolPending
          : state === 'denied'
            ? styles.toolDenied
            : styles.toolRunning;

  // Format args as key: value pairs instead of raw JSON.
  const argsDisplay = formatArgs(args);
  const resultDisplay = result !== undefined ? formatResult(result) : null;

  return (
    <div className={`${styles.toolCard} ${stateClass}`}>
      {/* Collapsed header — always visible */}
      <button
        type="button"
        className={styles.toolHeader}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={styles.toolIcon}>{isWrite ? '✎' : '🔍'}</span>
        <span className={styles.toolName}>{formatToolName(name)}</span>
        <span className={styles.toolStatusPill}>
          <span>{STATUS_ICONS[state]}</span>
          <span>{STATUS_LABELS[state]}</span>
        </span>
        <span className={styles.toolExpandChevron}>{expanded ? '▾' : '▸'}</span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className={styles.toolBody}>
          {argsDisplay && (
            <div className={styles.toolSection}>
              <div className={styles.toolSectionLabel}>{t('ai.toolCall.parameters')}</div>
              <pre className={styles.toolPre}>{argsDisplay}</pre>
            </div>
          )}
          {state === 'pending' && onApprove && (
            <div className={styles.approvalBar}>
              <button
                type="button"
                className={styles.approveBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onApprove(true);
                }}
              >
                {t('ai.toolCall.approve')}
              </button>
              <button
                type="button"
                className={styles.denyBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onApprove(false);
                }}
              >
                {t('ai.toolCall.deny')}
              </button>
            </div>
          )}
          {resultDisplay && (
            <div className={styles.toolSection}>
              <div className={styles.toolSectionLabel}>
                {state === 'err' ? t('ai.toolCall.error') : t('ai.toolCall.result')}
              </div>
              <pre className={styles.toolPre}>{resultDisplay}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Convert tool name to human-readable label. */
function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format tool arguments as readable key: value pairs. */
function formatArgs(args: unknown): string | null {
  if (!args || (typeof args === 'object' && Object.keys(args).length === 0)) {
    return null;
  }
  if (typeof args === 'string') return args;
  try {
    const obj = args as Record<string, unknown>;
    return Object.entries(obj)
      .map(([k, v]) => {
        const val = typeof v === 'string' ? v : JSON.stringify(v);
        return `${k}: ${val}`;
      })
      .join('\n');
  } catch {
    return JSON.stringify(args, null, 2);
  }
}

/** Format tool result — compact for large arrays, readable for objects. */
function formatResult(result: unknown): string {
  if (typeof result === 'string') return result;
  try {
    const str = JSON.stringify(result, null, 2);
    // Truncate very large results.
    if (str.length > 2000) {
      return str.slice(0, 2000) + '\n…[truncated]';
    }
    return str;
  } catch {
    return String(result);
  }
}

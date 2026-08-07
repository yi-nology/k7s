/**
 * Resource Diff — side-by-side YAML comparison tool.
 *
 * Lets the user compare two YAML documents: the left side can be a live
 * resource (fetched by ref), the right side is pasted text or another
 * resource. The diff view uses the existing LCS-based diff engine from
 * lib/diff.ts and renders a unified view with green/red highlighting.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore, rowsFor, selectKindCounts } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '../../hooks/useI18n';
import { formatError, getProvider } from '../../providers';
import { diffLines, diffStat, type DiffLine } from '../../lib/diff';
import { cx } from '../../lib/cx';
import type { KindId, ResourceRef } from '../../providers/types';
import styles from './ResourceDiff.module.css';

/** Build a ResourceRef from a kind + namespace + name triple. */
function toRef(kind: KindId, namespace: string, name: string): ResourceRef {
  return {
    kind,
    namespace: namespace || undefined,
    name,
  };
}

export function ResourceDiff({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const provider = getProvider();
  // The diff panel needs: (a) which kinds have rows at all (for the kind
  // pickers), and (b) the actual rows of the two currently-selected kinds.
  // Subscribe to a counts map (shallow) + the two dynamic kinds individually,
  // so an unrelated kind's mutation doesn't re-render the diff panel. The
  // kind pickers are local state, captured in the selector closures.
  const counts = useStore(useShallow((s) => selectKindCounts(s.rows)));

  // --- Left side state (resource selector) ---
  const [leftKind, setLeftKind] = useState<KindId>('deployments');
  const [leftNs, setLeftNs] = useState('');
  const [leftName, setLeftName] = useState('');
  const [leftYaml, setLeftYaml] = useState('');
  const [leftLoading, setLeftLoading] = useState(false);

  // --- Right side state (free text or resource) ---
  const [rightMode, setRightMode] = useState<'text' | 'resource'>('text');
  const [rightText, setRightText] = useState('');
  const [rightKind, setRightKind] = useState<KindId>('deployments');
  const [rightNs, setRightNs] = useState('');
  const [rightName, setRightName] = useState('');
  const [rightYaml, setRightYaml] = useState('');
  const [rightLoading, setRightLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Subscribe to just the two selected kinds' rows (not the whole rows map).
  // The selector closures capture leftKind/rightKind; Zustand re-runs them on
  // every store update and on re-render (when the kind pickers change).
  const leftKindRows = useStore((s) => rowsFor(s.rows, leftKind));
  const rightKindRows = useStore((s) => rowsFor(s.rows, rightKind));

  // Available kinds that have rows.
  const availableKinds = useMemo(
    () =>
      Object.entries(counts)
        .filter(([, c]) => c > 0)
        .map(([k]) => k as KindId)
        .sort(),
    [counts]
  );

  // Namespaces for the selected left kind.
  const leftNsList = useMemo(() => {
    const ns = new Set<string>();
    for (const r of leftKindRows) {
      if (r.namespace) ns.add(r.namespace);
    }
    return [...ns].sort();
  }, [leftKindRows]);

  // Names for the selected left kind+ns.
  const leftNameList = useMemo(() => {
    return leftKindRows
      .filter((r) => !leftNs || r.namespace === leftNs)
      .map((r) => r.name)
      .sort();
  }, [leftKindRows, leftNs]);

  // Same for right side.
  const rightNsList = useMemo(() => {
    const ns = new Set<string>();
    for (const r of rightKindRows) {
      if (r.namespace) ns.add(r.namespace);
    }
    return [...ns].sort();
  }, [rightKindRows]);

  const rightNameList = useMemo(() => {
    return rightKindRows
      .filter((r) => !rightNs || r.namespace === rightNs)
      .map((r) => r.name)
      .sort();
  }, [rightKindRows, rightNs]);

  // Fetch YAML for the left side.
  const fetchLeft = useCallback(async () => {
    if (!leftName) return;
    setLeftLoading(true);
    setError(null);
    try {
      const yaml = await provider.getYaml(toRef(leftKind, leftNs, leftName));
      setLeftYaml(yaml);
    } catch (e: unknown) {
      setError(formatError(e));
    } finally {
      setLeftLoading(false);
    }
  }, [provider, leftKind, leftNs, leftName]);

  // Fetch YAML for the right side (resource mode).
  const fetchRight = useCallback(async () => {
    if (!rightName) return;
    setRightLoading(true);
    setError(null);
    try {
      const yaml = await provider.getYaml(toRef(rightKind, rightNs, rightName));
      setRightYaml(yaml);
    } catch (e: unknown) {
      setError(formatError(e));
    } finally {
      setRightLoading(false);
    }
  }, [provider, rightKind, rightNs, rightName]);

  // Auto-fetch when selection changes.
  useEffect(() => {
    if (leftName) fetchLeft();
  }, [leftName, fetchLeft]);

  useEffect(() => {
    if (rightMode === 'resource' && rightName) fetchRight();
  }, [rightMode, rightName, fetchRight]);

  // Compute the diff.
  const effectiveRight = rightMode === 'text' ? rightText : rightYaml;
  const diffResult = useMemo(
    () => (leftYaml && effectiveRight ? diffLines(leftYaml, effectiveRight) : []),
    [leftYaml, effectiveRight]
  );
  const stat = useMemo(() => diffStat(diffResult), [diffResult]);

  return (
    <div className={styles.diff}>
      <header className={styles.header}>
        <h2>{t('diff.title', 'Resource Diff')}</h2>
        <button className={styles.closeBtn} onClick={onClose}>
          {t('diff.close', 'Close')}
        </button>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.selectors}>
        {/* Left selector */}
        <div className={styles.selectorCol}>
          <div className={styles.selectorLabel}>{t('diff.left', 'Left (current)')}</div>
          <div className={styles.selectorRow}>
            <select
              className={styles.select}
              value={leftKind}
              onChange={(e) => {
                setLeftKind(e.target.value as KindId);
                setLeftNs('');
                setLeftName('');
                setLeftYaml('');
              }}
            >
              {availableKinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              value={leftNs}
              onChange={(e) => {
                setLeftNs(e.target.value);
                setLeftName('');
                setLeftYaml('');
              }}
            >
              <option value="">all ns</option>
              {leftNsList.map((ns) => (
                <option key={ns} value={ns}>
                  {ns}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              value={leftName}
              onChange={(e) => setLeftName(e.target.value)}
            >
              <option value="">{t('diff.selectResource', 'Select resource...')}</option>
              {leftNameList.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Right selector */}
        <div className={styles.selectorCol}>
          <div className={styles.selectorLabel}>{t('diff.right', 'Right (comparison)')}</div>
          <div className={styles.modeToggle}>
            <button
              className={cx(styles.modeBtn, rightMode === 'text' && styles.modeBtnActive)}
              onClick={() => setRightMode('text')}
            >
              {t('diff.modeText', 'Paste YAML')}
            </button>
            <button
              className={cx(styles.modeBtn, rightMode === 'resource' && styles.modeBtnActive)}
              onClick={() => setRightMode('resource')}
            >
              {t('diff.modeResource', 'Resource')}
            </button>
          </div>
          {rightMode === 'resource' && (
            <div className={styles.selectorRow}>
              <select
                className={styles.select}
                value={rightKind}
                onChange={(e) => {
                  setRightKind(e.target.value as KindId);
                  setRightNs('');
                  setRightName('');
                  setRightYaml('');
                }}
              >
                {availableKinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <select
                className={styles.select}
                value={rightNs}
                onChange={(e) => {
                  setRightNs(e.target.value);
                  setRightName('');
                  setRightYaml('');
                }}
              >
                <option value="">all ns</option>
                {rightNsList.map((ns) => (
                  <option key={ns} value={ns}>
                    {ns}
                  </option>
                ))}
              </select>
              <select
                className={styles.select}
                value={rightName}
                onChange={(e) => setRightName(e.target.value)}
              >
                <option value="">{t('diff.selectResource', 'Select resource...')}</option>
                {rightNameList.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Right-side text editor (text mode) */}
      {rightMode === 'text' && (
        <textarea
          className={styles.textArea}
          value={rightText}
          onChange={(e) => setRightText(e.target.value)}
          placeholder={t(
            'diff.placeholder',
            'Paste YAML here to compare against the left resource...'
          )}
          spellCheck={false}
        />
      )}

      {/* Loading indicators */}
      {(leftLoading || rightLoading) && (
        <div className={styles.loading}>{t('diff.loading', 'Fetching YAML...')}</div>
      )}

      {/* Diff output */}
      {diffResult.length > 0 && (
        <div className={styles.diffOutput}>
          <div className={styles.diffStats}>
            <span className={styles.statAdd}>+{stat.added}</span>
            <span className={styles.statDel}>-{stat.removed}</span>
            {stat.added === 0 && stat.removed === 0 && (
              <span className={styles.statSame}>
                {t('diff.identical', 'Documents are identical')}
              </span>
            )}
          </div>
          <div className={styles.diffView}>
            {diffResult.map((line, i) => (
              <DiffLineRow key={i} line={line} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {leftYaml && !effectiveRight && (
        <div className={styles.emptyState}>
          {t('diff.emptyHint', 'Select a resource on the right or paste YAML to see the diff.')}
        </div>
      )}
    </div>
  );
}

/** A single diff line with line numbers and syntax highlighting. */
function DiffLineRow({ line }: { line: DiffLine }) {
  const cls =
    line.op === 'add' ? styles.lineAdd : line.op === 'del' ? styles.lineDel : styles.lineSame;
  const prefix = line.op === 'add' ? '+' : line.op === 'del' ? '-' : ' ';
  return (
    <div className={`${styles.diffLine} ${cls}`}>
      <span className={styles.lineNumLeft}>{line.before ?? ''}</span>
      <span className={styles.lineNumRight}>{line.after ?? ''}</span>
      <span className={styles.linePrefix}>{prefix}</span>
      <span className={styles.lineText}>{line.text}</span>
    </div>
  );
}

/**
 * HelmDiff — compare two revisions of a Helm release side by side.
 *
 * Fetches the revision history and rendered manifests via the provider,
 * then diffs them with the existing LCS engine from lib/diff.ts. Renders
 * a unified diff view with green/red highlighting.
 */

import { useEffect, useMemo, useState } from 'react';
import { getProvider } from '../../providers';
import { diffLines, diffStat, type DiffLine } from '../../lib/diff';
import { useTranslation } from '../../hooks/useI18n';
import { formatError } from '../../providers';
import type { HelmRevisionEntry } from '../../providers/types/helm';
import styles from './HelmDiff.module.css';

interface HelmDiffProps {
  namespace: string;
  name: string;
}

export function HelmDiff({ namespace, name }: HelmDiffProps) {
  const { t } = useTranslation();
  const [revisions, setRevisions] = useState<HelmRevisionEntry[]>([]);
  const [revA, setRevA] = useState<number | null>(null);
  const [revB, setRevB] = useState<number | null>(null);
  const [manifestA, setManifestA] = useState('');
  const [manifestB, setManifestB] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch revision history on mount.
  useEffect(() => {
    const provider = getProvider();
    provider
      .helmReleaseHistory(name, namespace)
      .then((revs) => {
        setRevisions(revs);
        if (revs.length >= 2) {
          setRevB(revs[0].revision);
          setRevA(revs[1].revision);
        } else if (revs.length === 1) {
          setRevA(revs[0].revision);
        }
      })
      .catch((e: unknown) => setError(formatError(e)));
  }, [namespace, name]);

  // Fetch manifests when both revisions are selected.
  useEffect(() => {
    if (revA === null || revB === null) return;
    setLoading(true);
    setError(null);
    const provider = getProvider();
    Promise.all([
      provider.helmManifestRevision(namespace, name, revA),
      provider.helmManifestRevision(namespace, name, revB),
    ])
      .then(([a, b]) => {
        setManifestA(a);
        setManifestB(b);
      })
      .catch((e: unknown) => {
        setError(formatError(e));
        setManifestA('');
        setManifestB('');
      })
      .finally(() => setLoading(false));
  }, [namespace, name, revA, revB]);

  // Compute the diff.
  const diffResult = useMemo(
    () => (manifestA && manifestB ? diffLines(manifestA, manifestB) : []),
    [manifestA, manifestB],
  );
  const stat = useMemo(() => diffStat(diffResult), [diffResult]);

  // Swap the two sides.
  const swap = () => {
    setRevA(revB);
    setRevB(revA);
    setManifestA(manifestB);
    setManifestB(manifestA);
  };

  if (revisions.length === 0 && !error) {
    return <div className={styles.loading}>{t('helm.diff.loading', 'Fetching manifests...')}</div>;
  }

  return (
    <div className={styles.diff}>
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.selectors}>
        <div className={styles.selectorCol}>
          <div className={styles.selectorLabel}>{t('helm.diff.selectRevA', 'From revision')}</div>
          <select
            className={styles.select}
            value={revA ?? ''}
            onChange={(e) => setRevA(Number(e.target.value))}
          >
            <option value="" disabled>
              {t('helm.diff.pickRevision', 'Select revision...')}
            </option>
            {revisions.map((r) => (
              <option key={r.revision} value={r.revision} disabled={r.revision === revB}>
                #{r.revision} &mdash; {r.status} ({r.chart})
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className={styles.swapBtn}
          onClick={swap}
          title={t('helm.diff.swap', 'Swap')}
          aria-label={t('helm.diff.swap', 'Swap')}
        >
          ⇄
        </button>

        <div className={styles.selectorCol}>
          <div className={styles.selectorLabel}>{t('helm.diff.selectRevB', 'To revision')}</div>
          <select
            className={styles.select}
            value={revB ?? ''}
            onChange={(e) => setRevB(Number(e.target.value))}
          >
            <option value="" disabled>
              {t('helm.diff.pickRevision', 'Select revision...')}
            </option>
            {revisions.map((r) => (
              <option key={r.revision} value={r.revision} disabled={r.revision === revA}>
                #{r.revision} &mdash; {r.status} ({r.chart})
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && <div className={styles.loading}>{t('helm.diff.loading', 'Fetching manifests...')}</div>}

      {diffResult.length > 0 && (
        <div className={styles.diffOutput}>
          <div className={styles.diffStats}>
            <span className={styles.statAdd}>+{stat.added}</span>
            <span className={styles.statDel}>-{stat.removed}</span>
            {stat.added === 0 && stat.removed === 0 && (
              <span className={styles.statSame}>
                {t('helm.diff.identical', 'Manifests are identical')}
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

      {!loading && revA !== null && revB !== null && diffResult.length === 0 && !error && (
        <div className={styles.emptyState}>
          {t('helm.diff.emptyHint', 'Select two revisions to compare their rendered manifests.')}
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

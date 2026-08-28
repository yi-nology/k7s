/**
 * ChartVersionDiff — two-version comparison of charts in the local library.
 *
 * Two selects (defaulting to the two most recent entries, i.e. the head of
 * the list as the provider returns it) drive parallel `localChartDetail`
 * fetches; the shared LCS engine from lib/diff.ts then diffs the payloads'
 * Chart.yaml and values.yaml. Both files are covered because they are the
 * two the detail pane renders inline — Chart.yaml is what a version bump
 * actually is, values.yaml is where defaults drift. Line styling reuses
 * the HelmDiff css module so release-diff and library-diff read the same.
 */
import { useMemo, useState } from 'react';
import { getProvider } from '../../providers';
import { useProviderQuery } from '../../hooks/useProviderQuery';
import { useTranslation } from '../../hooks/useI18n';
import { diffLines, diffStat, type DiffLine } from '../../lib/diff';
import type { LocalChartDetail, LocalChartEntry } from '../../providers/types';
import styles from './HelmMarket.module.css';
import diffStyles from './HelmDiff.module.css';

interface ChartVersionDiffProps {
  charts: LocalChartEntry[];
  onClose: () => void;
}

export function ChartVersionDiff({ charts, onClose }: ChartVersionDiffProps) {
  const { t } = useTranslation();
  // Defaults = the two most recent entries, i.e. the first two in the list
  // order the provider already sorted by modifiedAt.
  const [idA, setIdA] = useState(charts[0]?.id ?? '');
  const [idB, setIdB] = useState(charts[1]?.id ?? '');

  const ready = idA !== '' && idB !== '' && idA !== idB;
  const detailsQuery = useProviderQuery<{ a: LocalChartDetail; b: LocalChartDetail } | null>({
    query: () => {
      if (!ready) return null;
      // Parallel: both payloads are independent reads.
      return Promise.all([
        getProvider().localChartDetail(idA),
        getProvider().localChartDetail(idB),
      ]).then(([a, b]) => ({ a, b }));
    },
    deps: [idA, idB],
    ttlMs: 0,
  });

  const detailA = detailsQuery.data?.a;
  const detailB = detailsQuery.data?.b;
  const entryA = charts.find((c) => c.id === idA);
  const entryB = charts.find((c) => c.id === idB);

  const chartDiff = useMemo(
    () => (detailA && detailB ? diffLines(detailA.chartYaml, detailB.chartYaml) : []),
    [detailA, detailB]
  );
  const valuesDiff = useMemo(
    () => (detailA && detailB ? diffLines(detailA.valuesYaml, detailB.valuesYaml) : []),
    [detailA, detailB]
  );
  const chartStat = useMemo(() => diffStat(chartDiff), [chartDiff]);
  const valuesStat = useMemo(() => diffStat(valuesDiff), [valuesDiff]);
  // No +/- lines anywhere means the two payloads carry the same files
  // (also true when both are empty — diffLines([]) then, stats still 0).
  const identical =
    chartStat.added + chartStat.removed === 0 && valuesStat.added + valuesStat.removed === 0;

  if (charts.length < 2) {
    return (
      <div className={styles.localDetail}>
        <div className={styles.empty}>
          {t('helm.local.empty', 'No local charts — upload a .tgz to get started')}
        </div>
      </div>
    );
  }

  const optionLabel = (c: LocalChartEntry) => `${c.name} v${c.version}`;

  return (
    <div className={styles.localDetail}>
      <header className={styles.wizardHeader}>
        <h2>{t('helm.local.diff.title', 'Compare versions')}</h2>
      </header>

      <div className={diffStyles.selectors}>
        <div className={diffStyles.selectorCol}>
          <div className={diffStyles.selectorLabel}>{t('helm.local.diff.pickA', 'Select version A…')}</div>
          <select
            className={diffStyles.select}
            value={idA}
            onChange={(e) => setIdA(e.target.value)}
          >
            {charts.map((c) => (
              <option key={c.id} value={c.id} disabled={c.id === idB}>
                {optionLabel(c)}
              </option>
            ))}
          </select>
        </div>
        <div className={diffStyles.selectorCol}>
          <div className={diffStyles.selectorLabel}>{t('helm.local.diff.pickB', 'Select version B…')}</div>
          <select
            className={diffStyles.select}
            value={idB}
            onChange={(e) => setIdB(e.target.value)}
          >
            {charts.map((c) => (
              <option key={c.id} value={c.id} disabled={c.id === idA}>
                {optionLabel(c)}
              </option>
            ))}
          </select>
        </div>
        <div className={diffStyles.selectorCol}>
          <button className={styles.close} onClick={onClose}>
            {t('helm.close', 'Close')}
          </button>
        </div>
      </div>

      {detailsQuery.error && <div className={styles.error}>{detailsQuery.error}</div>}
      {detailsQuery.loading && !detailA && (
        <div className={diffStyles.loading}>{t('helm.diff.loading', 'Fetching manifests...')}</div>
      )}

      {detailA && detailB && (
        <>
          {entryA && entryB && (
            <div className={styles.reviewRow}>{`v${entryA.version} → v${entryB.version}`}</div>
          )}
          {identical ? (
            <div className={diffStyles.emptyState}>
              {t('helm.local.diff.identical', 'The two versions render identical files')}
            </div>
          ) : (
            <>
              <section>
                <h3>Chart.yaml</h3>
                <div className={diffStyles.diffStats}>
                  <span className={diffStyles.statAdd}>+{chartStat.added}</span>
                  <span className={diffStyles.statDel}>-{chartStat.removed}</span>
                </div>
                <div className={diffStyles.diffView}>
                  {chartDiff.map((line, i) => (
                    <DiffLineRow key={i} line={line} />
                  ))}
                </div>
              </section>
              <section>
                <h3>values.yaml</h3>
                <div className={diffStyles.diffStats}>
                  <span className={diffStyles.statAdd}>+{valuesStat.added}</span>
                  <span className={diffStyles.statDel}>-{valuesStat.removed}</span>
                </div>
                <div className={diffStyles.diffView}>
                  {valuesDiff.map((line, i) => (
                    <DiffLineRow key={i} line={line} />
                  ))}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** A single diff line with line numbers and +/- prefix — mirrors the row
 * layout in HelmDiff.tsx so both diff surfaces read identically. */
function DiffLineRow({ line }: { line: DiffLine }) {
  const cls =
    line.op === 'add'
      ? diffStyles.lineAdd
      : line.op === 'del'
        ? diffStyles.lineDel
        : diffStyles.lineSame;
  const prefix = line.op === 'add' ? '+' : line.op === 'del' ? '-' : ' ';
  return (
    <div className={`${diffStyles.diffLine} ${cls}`}>
      <span className={diffStyles.lineNumLeft}>{line.before ?? ''}</span>
      <span className={diffStyles.lineNumRight}>{line.after ?? ''}</span>
      <span className={diffStyles.linePrefix}>{prefix}</span>
      <span className={diffStyles.lineText}>{line.text}</span>
    </div>
  );
}

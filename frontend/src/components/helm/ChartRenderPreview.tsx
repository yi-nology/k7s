/**
 * ChartRenderPreview — offline `helm template` for a local chart.
 *
 * The values editor starts from the chart's defaults (the detail payload
 * already carries values.yaml) and every user edit is preserved; Render
 * sends the current editor text to `helmRenderPreview` (version '' — a
 * local package is exactly one version) and shows the manifest read-only
 * with per-`kind` resource stats. Nothing is applied and no cluster is
 * contacted, so the empty state says so before the first run.
 */
import { useMemo, useState } from 'react';
import { formatError, getProvider } from '../../providers';
import { useTranslation } from '../../hooks/useI18n';
import type { LocalChartDetail } from '../../providers/types';
import { EditorCore } from '../editor/EditorCore';
import styles from './HelmMarket.module.css';

/** One rendered resource kind and how many times it appears. */
export interface KindStat {
  kind: string;
  count: number;
}

/**
 * Count `kind:` declarations across every YAML document in a rendered
 * manifest. Rendered manifests only need a line-level scan: helm emits one
 * document per resource with `kind:` at column 0, so `^kind:\s*(\S+)` per
 * line is exact for anything helm template produces. Sorted by count
 * descending (then name) so the busiest kind leads the badge row.
 */
export function kindStats(manifest: string): KindStat[] {
  const counts = new Map<string, number>();
  for (const line of manifest.split('\n')) {
    const m = /^kind:\s*(\S+)\s*$/.exec(line);
    if (!m) continue;
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

export function ChartRenderPreview({ detail }: { detail: LocalChartDetail }) {
  const { t } = useTranslation();
  // Seeded once per chart; LocalCharts keys this component by entry id, so
  // picking another chart remounts with its defaults (EditorCore also only
  // reads `value` at mount).
  const [values, setValues] = useState(detail.valuesYaml);
  const [rendering, setRendering] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // EditorCore reads `value` only at mount, so the output editor is keyed
  // by this counter — a second Render (after editing values) must remount
  // it with the fresh manifest, not keep the first one's text.
  const [renderSeq, setRenderSeq] = useState(0);
  const [error, setError] = useState('');

  const stats = useMemo(() => (result === null ? [] : kindStats(result)), [result]);

  const onRender = async () => {
    setRendering(true);
    setError('');
    try {
      // Keep the previous manifest visible on failure — the error banner
      // explains why a re-render is needed.
      setResult(await getProvider().helmRenderPreview(detail.entry.path, '', values));
      setRenderSeq((n) => n + 1);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className={styles.renderPreview}>
      <div className={styles.renderValues}>
        <EditorCore value={values} language="yaml" editable onChange={setValues} />
      </div>
      <div className={styles.wizardActions}>
        <button className={styles.primary} disabled={rendering} onClick={() => void onRender()}>
          {t('helm.local.render.button', 'Render')}
        </button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {result === null ? (
        !error && (
          <div className={styles.empty}>
            {t(
              'helm.local.render.empty',
              'Press Render to preview the chart’s rendered manifests — nothing is applied to the cluster'
            )}
          </div>
        )
      ) : (
        <>
          {stats.length > 0 && (
            <div className={styles.renderStats}>
              <span className={styles.renderStatsLabel}>
                {t('helm.local.render.stats', 'Resource stats')}
              </span>
              {stats.map((s) => (
                <span key={s.kind} className={styles.statBadge}>
                  {s.kind} ×{s.count}
                </span>
              ))}
            </div>
          )}
          <div className={styles.localFileView}>
            <EditorCore
              key={renderSeq}
              value={result}
              language="yaml"
              editable={false}
              hideToolbar
            />
          </div>
        </>
      )}
    </div>
  );
}

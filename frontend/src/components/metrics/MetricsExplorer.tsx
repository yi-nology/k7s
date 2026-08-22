/**
 * MetricsExplorer — the PromQL query panel (Phase 1 Tier-2 of KubePi parity).
 *
 * Two modes:
 *   - Instant: one sample, table form
 *   - Range: a time series, Plotly line chart
 *
 * The user picks a configured Prometheus instance (or the auto-discovered
 * in-cluster one), types a query, and the result renders. Errors come
 * back inline — the bar at the top shows the Prometheus error message,
 * so a typo in PromQL doesn't vanish into a black Plotly box.
 */
import { useEffect, useState } from 'react';
import { formatError, getProvider } from '../../providers';
import type { MetricsConfig, PromQueryResult, SavedQuery } from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import { useProviderQuery } from '../../hooks/useProviderQuery';
import { Plot } from '../detail/PlotChart';
import { ConfirmDialog } from '../common/ConfirmDialog';
import styles from './MetricsExplorer.module.css';
import { InstantTable } from './InstantTable';

type Mode = 'instant' | 'range';

/** What to run next: the typed PromQL, or a saved query (cached run). */
type RunSpec =
  | { kind: 'promql'; nonce: number }
  | { kind: 'saved'; nonce: number; q: SavedQuery; force: boolean };

const RANGE_PRESETS: Array<{ label: string; minutes: number }> = [
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
  { label: '6h', minutes: 360 },
  { label: '24h', minutes: 1440 },
];

export function MetricsExplorer({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [instance, setInstance] = useState<string>('');
  const [mode, setMode] = useState<Mode>('range');
  const [promql, setPromql] = useState('up');
  const [rangeMinutes, setRangeMinutes] = useState(60);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveNote, setSaveNote] = useState('');
  const [cacheBust, setCacheBust] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  // "saving" guards the save action button during the in-flight
  // `savedQueriesUpsert` so a double-click can't queue a second
  // write. Pre-fix (pass-11), the button was always enabled
  // once `saveName.trim()` was non-empty and had no in-flight
  // text — the same defect class pass-18 fixed for HelmMarket
  // add-repo and the ActionList scale / forward forms.
  const [saving, setSaving] = useState(false);
  // "idle" | "ok" — transient feedback after a successful
  // `savedQueriesClearCache()`. The button text reverts on its
  // own (1.5s). Same `ok / err / idle` pattern as the
  // McpPanel CopyButton. Pre-fix (pass-11), the click handler
  // fired the provider method with no state change, so the user
  // had no idea whether anything happened.
  const [cacheState, setCacheState] = useState<'idle' | 'ok'>('idle');

  // Load configured instances.
  const instancesQuery = useProviderQuery<MetricsConfig[]>({
    query: () => getProvider().metricsList(),
    deps: [],
    key: 'metrics:instances',
  });
  const instances = instancesQuery.data ?? [];

  useEffect(() => {
    if (instances.length > 0 && !instance) {
      setInstance(instances[0].name);
    }
  }, [instances, instance]);

  // Load saved queries (cacheBust bumps after every save/remove).
  const savedQuery = useProviderQuery<SavedQuery[]>({
    query: () => getProvider().savedQueriesList(),
    deps: [cacheBust],
    key: 'metrics:saved',
  });
  const saved = savedQuery.data ?? [];

  // Which query to run. Bumping `nonce` re-runs; the auto-run effect below
  // resets it to the promql kind whenever the source controls change.
  const [runSpec, setRunSpec] = useState<RunSpec>({ kind: 'promql', nonce: 0 });

  // Auto-run when the user switches instance or mode. Adjusting during render
  // (the React-sanctioned pattern) instead of in an effect.
  const srcKey = `${mode}:${rangeMinutes}:${instance ?? ''}`;
  const [prevSrcKey, setPrevSrcKey] = useState(srcKey);
  if (prevSrcKey !== srcKey) {
    setPrevSrcKey(srcKey);
    setRunSpec((s) => ({ kind: 'promql', nonce: s.nonce + 1 }));
  }

  const runQuery = useProviderQuery<PromQueryResult>({
    query: () => {
      if (runSpec.kind === 'saved') {
        return instance
          ? getProvider().savedQueriesRun(runSpec.q, instance, runSpec.force)
          : null;
      }
      if (!instance || !promql.trim()) return null;
      if (mode === 'instant') {
        return getProvider().metricsQuery(instance, promql);
      }
      const endMs = Date.now();
      const startMs = endMs - rangeMinutes * 60 * 1000;
      return getProvider().metricsQueryRange(
        instance,
        promql,
        startMs,
        endMs,
        Math.max(15, Math.floor((rangeMinutes * 60) / 240)),
      );
    },
    deps: [runSpec],
    ttlMs: 0, // query results are never served from cache
  });
  const loading = runQuery.loading;
  // A failed run clears the chart, exactly like the pre-hook code did.
  const result = runQuery.error ? null : (runQuery.data ?? null);
  const error =
    actionError ?? instancesQuery.error ?? savedQuery.error ?? runQuery.error ?? null;

  const run = () => setRunSpec((s) => ({ kind: 'promql', nonce: s.nonce + 1 }));

  const runSaved = (q: SavedQuery, forceRefresh = false) => {
    if (!instance) return;
    setPromql(q.promql);
    setRunSpec((s) => ({ kind: 'saved', nonce: s.nonce + 1, q, force: forceRefresh }));
  };

  const saveCurrent = async () => {
    if (!saveName.trim() || !promql.trim() || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      await getProvider().savedQueriesUpsert({
        name: saveName.trim(),
        promql: promql,
        note: saveNote,
        cacheSeconds: 30,
      });
      setShowSave(false);
      setSaveName('');
      setSaveNote('');
      setCacheBust((c) => c + 1);
    } catch (e) {
      setActionError(formatError(e));
    } finally {
      setSaving(false);
    }
  };

  const [pendingRemoveQuery, setPendingRemoveQuery] = useState<string | null>(null);

  const removeSaved = (name: string) => {
    setPendingRemoveQuery(name);
  };

  const confirmRemoveQuery = async () => {
    if (!pendingRemoveQuery) return;
    await getProvider().savedQueriesRemove(pendingRemoveQuery);
    setCacheBust((c) => c + 1);
    setPendingRemoveQuery(null);
  };

  // Clear-cache handler. The button's text briefly flips to
  // `clearCacheOk` (en: "Cleared", zh: "已清空") for 1.5s so the
  // user gets feedback that the click landed. The provider's
  // `savedQueriesClearCache()` is fire-and-forget here — even a
  // slow backend gives the user a visible "yes, that worked"
  // signal, and the timeout-based revert is the same pattern
  // the McpPanel CopyButton uses.
  const clearCache = () => {
    void getProvider().savedQueriesClearCache();
    setCacheState('ok');
    setTimeout(() => setCacheState('idle'), 1500);
  };

  // The save bar's typed name matches an existing saved query
  // (case-insensitive, trim-insensitive) → the action button
  // labels itself "Update" / "更新" and a small inline hint
  // surfaces the overwrite. Pre-fix (pass-11), the save bar
  // gave no visual hint that a same-name save would overwrite
  // a query the user might have forgotten they had.
  const trimmedName = saveName.trim();
  const isOverwrite =
    trimmedName.length > 0 && saved.some((q) => q.name.toLowerCase() === trimmedName.toLowerCase());

  return (
    <>
    <ConfirmDialog
      open={!!pendingRemoveQuery}
      onClose={() => setPendingRemoveQuery(null)}
      onConfirm={() => void confirmRemoveQuery()}
      title={t('metricsExplorer.saved.removeTitle', 'Delete query')}
      body={t('metricsExplorer.saved.confirmRemove', `Delete saved query "${pendingRemoveQuery}"?`)}
      danger
    />
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2>{t('metricsExplorer.title', 'Metrics Explorer')}</h2>
        {onClose && (
          <button className={styles.btn} onClick={onClose}>
            {t('metricsExplorer.close', 'Close')}
          </button>
        )}
      </header>
      {error && <div className={styles.error}>{error}</div>}

      {/* Source + time window — the "what to query" controls, grouped apart
          from the query itself so the two read as separate concerns. */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>{t('metricsExplorer.source', 'Source')}</div>
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>{t('metricsExplorer.instance', 'Prometheus')}</span>
            <select value={instance} onChange={(e) => setInstance(e.target.value)}>
              {instances.length === 0 && <option value="">— none configured —</option>}
              {instances.map((i) => (
                <option key={i.name} value={i.name}>
                  {i.name} ({i.url})
                </option>
              ))}
            </select>
          </label>
          <div className={styles.modeToggle}>
            <button
              className={mode === 'instant' ? styles.activeTab : styles.tab}
              onClick={() => setMode('instant')}
            >
              {t('metricsExplorer.instant', 'Instant')}
            </button>
            <button
              className={mode === 'range' ? styles.activeTab : styles.tab}
              onClick={() => setMode('range')}
            >
              {t('metricsExplorer.range', 'Range')}
            </button>
          </div>
          {mode === 'range' && (
            <div className={styles.rangePresets}>
              {RANGE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={rangeMinutes === p.minutes ? styles.activeRange : styles.rangePreset}
                  onClick={() => setRangeMinutes(p.minutes)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Query bar — the "what to ask" row. Save/Refresh are secondary to Run. */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>{t('metricsExplorer.query', 'Query')}</div>
        <div className={styles.queryBar}>
          <input
            className={styles.queryInput}
            spellCheck={false}
            value={promql}
            onChange={(e) => setPromql(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run();
            }}
            placeholder={t('metricsExplorer.placeholder', 'PromQL expression…')}
          />
          <button
            className={styles.primary}
            onClick={run}
            disabled={loading || !instance || !promql.trim()}
          >
            {loading ? t('metricsExplorer.running', 'Running…') : t('metricsExplorer.run', 'Run')}
          </button>
          <button
            className={styles.btn}
            onClick={() => setShowSave(!showSave)}
            disabled={!promql.trim()}
            title={t('metricsExplorer.saved.saveTitle', 'Save this query')}
          >
            {t('metricsExplorer.saved.save', 'Save')}
          </button>
          <button
            className={styles.btn}
            onClick={() => run()}
            disabled={!result}
            title={t('metricsExplorer.refreshTitle', 'Re-run the current query')}
          >
            {t('metricsExplorer.refresh', 'Refresh')}
          </button>
        </div>

        {showSave && (
          <div className={styles.saveBarWrap}>
            <div className={styles.saveBar}>
              <input
                placeholder={t('metricsExplorer.saved.namePlaceholder', 'Name')}
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveCurrent();
                }}
                disabled={saving}
              />
              <input
                placeholder={t('metricsExplorer.saved.notePlaceholder', 'Note (optional)')}
                value={saveNote}
                onChange={(e) => setSaveNote(e.target.value)}
                disabled={saving}
              />
              <button
                type="button"
                className={styles.primary}
                onClick={saveCurrent}
                disabled={!saveName.trim() || saving}
              >
                {saving
                  ? t('metricsExplorer.saved.saving', 'Saving…')
                  : isOverwrite
                    ? t('metricsExplorer.saved.updateAction', 'Update')
                    : t('metricsExplorer.saved.saveAction', 'Save')}
              </button>
            </div>
            {isOverwrite && (
              <div className={styles.overwriteHint}>
                {t(
                  'metricsExplorer.saved.overwriteHint',
                  'Will overwrite the existing query with this name.'
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {saved.length > 0 && (
        <section className={styles.section}>
          <div className={styles.savedHeader}>
            {t('metricsExplorer.saved.title', 'Saved queries')}
            <button
              type="button"
              className={
                cacheState === 'ok' ? `${styles.btnSmall} ${styles.btnSmallOk}` : styles.btnSmall
              }
              onClick={clearCache}
              title={t('metricsExplorer.saved.clearCache', 'Wipe the in-memory query cache')}
            >
              {cacheState === 'ok'
                ? t('metricsExplorer.saved.clearCacheOk', 'Cleared')
                : t('metricsExplorer.saved.clearCacheBtn', 'Clear cache')}
            </button>
          </div>
          {saved.map((q) => (
            <div key={q.name} className={styles.savedRow}>
              <button
                className={styles.savedName}
                onClick={() => runSaved(q)}
                title={q.note || q.promql}
              >
                {q.name}
              </button>
              <span className={styles.savedPromql}>{q.promql}</span>
              <button
                className={styles.savedAction}
                onClick={() => runSaved(q, true)}
                title={t('metricsExplorer.saved.refreshHint', 'Run, ignoring the cache')}
              >
                ↻
              </button>
              <button
                className={styles.savedAction}
                onClick={() => removeSaved(q.name)}
                title={t('metricsExplorer.saved.removeHint', 'Delete saved query')}
              >
                ×
              </button>
            </div>
          ))}
        </section>
      )}

      {/* Result — chart (range) or table (instant). Bordered so it reads as
          the output of the query above, distinct from the controls. */}
      <section className={`${styles.section} ${styles.resultSection}`}>
        <div className={styles.sectionHeader}>{t('metricsExplorer.result', 'Result')}</div>
        <div className={styles.results}>
          {result && result.series.length > 0 ? (
            mode === 'range' ? (
              <Plot
                title={promql}
                data={result.series.map((s) => ({
                  x: s.samples.map((p) => new Date(p.ts)),
                  y: s.samples.map((p) => p.value),
                  type: 'scatter' as const,
                  mode: 'lines' as const,
                  name:
                    Object.entries(s.metric)
                      .filter(([k]) => k !== '__name__')
                      .map(([k, v]) => `${k}=${v}`)
                      .join(',') ||
                    s.metric.__name__ ||
                    '',
                }))}
                layoutExtra={{
                  showlegend: true,
                  legend: {
                    orientation: 'h' as const,
                    x: 0,
                    y: -0.15,
                    font: { color: 'var(--text-secondary)', size: 11 },
                  },
                  yaxis: {
                    title: {
                      text: '',
                      font: { color: 'var(--text-muted)', size: 10 },
                    },
                  },
                }}
                height={320}
              />
            ) : (
              <InstantTable series={result.series} />
            )
          ) : result && result.series.length === 0 ? (
            <div className={styles.empty}>{t('metricsExplorer.empty', 'No series returned.')}</div>
          ) : (
            <div className={styles.emptyState}>
              <span>{t('metricsExplorer.emptyState', 'Run a query to see metrics')}</span>
            </div>
          )}
        </div>
      </section>
    </div>
    </>
  );
}

// InstantTable component extracted to ./InstantTable.tsx

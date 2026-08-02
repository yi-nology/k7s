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
import { useEffect, useState } from "react";
import { getProvider } from "../../providers";
import type {
  MetricsConfig,
  PromQueryResult,
  SavedQuery,
} from "../../providers/types";
import { useTranslation } from "../../hooks/useI18n";
import { Plot } from "../detail/PlotChart";
import styles from "./MetricsExplorer.module.css";

type Mode = "instant" | "range";

const RANGE_PRESETS: Array<{ label: string; minutes: number }> = [
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
];

export function MetricsExplorer({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [instances, setInstances] = useState<MetricsConfig[]>([]);
  const [instance, setInstance] = useState<string>("");
  const [mode, setMode] = useState<Mode>("range");
  const [promql, setPromql] = useState("up");
  const [rangeMinutes, setRangeMinutes] = useState(60);
  const [result, setResult] = useState<PromQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [cacheBust, setCacheBust] = useState(0);

  // Load configured instances.
  useEffect(() => {
    getProvider()
      .metricsList()
      .then((rows) => {
        setInstances(rows);
        if (rows.length > 0 && !instance) {
          setInstance(rows[0].name);
        }
      })
      .catch((e: unknown) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load saved queries.
  useEffect(() => {
    getProvider()
      .savedQueriesList()
      .then(setSaved)
      .catch((e: unknown) => setError(String(e)));
  }, [cacheBust]);

  const run = async () => {
    if (!instance || !promql.trim()) return;
    setLoading(true);
    setError(null);
    try {
      let r: PromQueryResult;
      if (mode === "instant") {
        r = await getProvider().metricsQuery(instance, promql);
      } else {
        const endMs = Date.now();
        const startMs = endMs - rangeMinutes * 60 * 1000;
        r = await getProvider().metricsQueryRange(
          instance,
          promql,
          startMs,
          endMs,
          Math.max(15, Math.floor(rangeMinutes * 60 / 240)),
        );
      }
      setResult(r);
    } catch (e) {
      setError(String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const runSaved = async (q: SavedQuery, forceRefresh = false) => {
    if (!instance) return;
    setPromql(q.promql);
    setLoading(true);
    setError(null);
    try {
      const r = await getProvider().savedQueriesRun(q, instance, forceRefresh);
      setResult(r);
    } catch (e) {
      setError(String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const saveCurrent = async () => {
    if (!saveName.trim() || !promql.trim()) return;
    try {
      await getProvider().savedQueriesUpsert({
        name: saveName.trim(),
        promql: promql,
        note: saveNote,
        cacheSeconds: 30,
      });
      setShowSave(false);
      setSaveName("");
      setSaveNote("");
      setCacheBust((c) => c + 1);
    } catch (e) {
      setError(String(e));
    }
  };

  const removeSaved = async (name: string) => {
    if (!confirm(t("metricsExplorer.saved.confirmRemove", `Delete saved query "${name}"?`))) {
      return;
    }
    await getProvider().savedQueriesRemove(name);
    setCacheBust((c) => c + 1);
  };

  // Auto-run when the user switches instance or mode.
  useEffect(() => {
    if (instance && promql) {
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, rangeMinutes, instance]);

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2>{t("metricsExplorer.title", "Metrics Explorer")}</h2>
        {onClose && (
          <button className={styles.btn} onClick={onClose}>
            {t("metricsExplorer.close", "Close")}
          </button>
        )}
      </header>
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.controls}>
        <label className={styles.field}>
          <span>{t("metricsExplorer.instance", "Prometheus")}</span>
          <select
            value={instance}
            onChange={(e) => setInstance(e.target.value)}
          >
            {instances.length === 0 && (
              <option value="">— none configured —</option>
            )}
            {instances.map((i) => (
              <option key={i.name} value={i.name}>
                {i.name} ({i.url})
              </option>
            ))}
          </select>
        </label>
        <div className={styles.modeToggle}>
          <button
            className={mode === "instant" ? styles.activeTab : styles.tab}
            onClick={() => setMode("instant")}
          >
            {t("metricsExplorer.instant", "Instant")}
          </button>
          <button
            className={mode === "range" ? styles.activeTab : styles.tab}
            onClick={() => setMode("range")}
          >
            {t("metricsExplorer.range", "Range")}
          </button>
        </div>
        {mode === "range" && (
          <div className={styles.rangePresets}>
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.label}
                className={
                  rangeMinutes === p.minutes
                    ? styles.activeRange
                    : styles.rangePreset
                }
                onClick={() => setRangeMinutes(p.minutes)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.queryBar}>
        <input
          className={styles.queryInput}
          spellCheck={false}
          value={promql}
          onChange={(e) => setPromql(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
          placeholder={t("metricsExplorer.placeholder", "PromQL expression…")}
        />
        <button
          className={styles.primary}
          onClick={run}
          disabled={loading || !instance || !promql.trim()}
        >
          {loading
            ? t("metricsExplorer.running", "Running…")
            : t("metricsExplorer.run", "Run")}
        </button>
        <button
          className={styles.btn}
          onClick={() => setShowSave(!showSave)}
          disabled={!promql.trim()}
          title={t("metricsExplorer.saved.saveTitle", "Save this query")}
        >
          {t("metricsExplorer.saved.save", "Save")}
        </button>
        <button
          className={styles.btn}
          onClick={() => run()}
          disabled={!result}
          title={t("metricsExplorer.refreshTitle", "Re-run the current query")}
        >
          {t("metricsExplorer.refresh", "Refresh")}
        </button>
      </div>

      {showSave && (
        <div className={styles.saveBar}>
          <input
            placeholder={t("metricsExplorer.saved.namePlaceholder", "Name")}
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveCurrent();
            }}
          />
          <input
            placeholder={t("metricsExplorer.saved.notePlaceholder", "Note (optional)")}
            value={saveNote}
            onChange={(e) => setSaveNote(e.target.value)}
          />
          <button
            className={styles.primary}
            onClick={saveCurrent}
            disabled={!saveName.trim()}
          >
            {t("metricsExplorer.saved.saveAction", "Save")}
          </button>
        </div>
      )}

      {saved.length > 0 && (
        <div className={styles.savedList}>
          <div className={styles.savedHeader}>
            {t("metricsExplorer.saved.title", "Saved queries")}
            <button
              className={styles.btnSmall}
              onClick={() => {
                void getProvider().savedQueriesClearCache();
              }}
              title={t("metricsExplorer.saved.clearCache", "Wipe the in-memory query cache")}
            >
              {t("metricsExplorer.saved.clearCacheBtn", "Clear cache")}
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
                className={styles.btnSmall}
                onClick={() => runSaved(q, true)}
                title={t("metricsExplorer.saved.refreshHint", "Run, ignoring the cache")}
              >
                ↻
              </button>
              <button
                className={styles.btnSmallDanger}
                onClick={() => removeSaved(q.name)}
                title={t("metricsExplorer.saved.removeHint", "Delete saved query")}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.results}>
        {result && result.series.length > 0 ? (
          mode === "range" ? (
            <Plot
              title={promql}
              data={result.series.map((s) => ({
                x: s.samples.map((p) => new Date(p.ts)),
                y: s.samples.map((p) => p.value),
                type: "scatter" as const,
                mode: "lines" as const,
                name: Object.entries(s.metric)
                  .filter(([k]) => k !== "__name__")
                  .map(([k, v]) => `${k}=${v}`)
                  .join(",") || s.metric.__name__ || "",
              }))}
              height={320}
            />
          ) : (
            <InstantTable series={result.series} />
          )
        ) : result && result.series.length === 0 ? (
          <div className={styles.empty}>
            {t("metricsExplorer.empty", "No series returned.")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InstantTable({ series }: { series: PromQueryResult["series"] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Series</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {series.map((s, i) => {
          const label = Object.entries(s.metric)
            .filter(([k]) => k !== "__name__")
            .map(([k, v]) => `${k}=${v}`)
            .join(", ");
          const value = s.samples.at(-1)?.value ?? 0;
          return (
            <tr key={i}>
              <td className={styles.mono}>
                {s.metric.__name__ ?? ""}
                {label ? ` {${label}}` : ""}
              </td>
              <td className={styles.mono}>{value}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

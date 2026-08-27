/**
 * GrafanaPanel — manage Grafana instances and embed dashboards.
 *
 * Three things in one file:
 *   - left: list of configured Grafana instances (add/test/remove)
 *   - center: list of preset dashboards for the selected instance
 *   - right: an iframe rendering the selected dashboard
 *
 * The iframe is sandboxed (`sandbox="allow-same-origin allow-scripts"`) so
 * a dashboard's broken JS can't escape the iframe and reach the rest of
 * the app. We deliberately don't `allow-same-origin` to cookies — the
 * iframe's origin is the Grafana host, which is the only place that
 * needs its own auth.
 */
import { useCallback, useEffect, useState } from 'react';
import { formatError, getProvider } from '../../providers';
import type {
  DashboardPreset,
  GrafanaConfig,
  GrafanaDashboardSearchResult,
} from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import { useProviderQuery } from '../../hooks/useProviderQuery';
import { useFirstInstance, mergeErrors } from '../../hooks/useAutoSelect';
import { ConfirmDialog } from '../common/ConfirmDialog';
import styles from './GrafanaPanel.module.css';

function getRangeOptions(t: (key: string) => string) {
  return [
    { label: t('grafanaRange.last1h'), minutes: 60 },
    { label: t('grafanaRange.last6h'), minutes: 360 },
    { label: t('grafanaRange.last24h'), minutes: 1440 },
    { label: t('grafanaRange.last7d'), minutes: 10080 },
  ];
}

export function GrafanaPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [rangeMinutes, setRangeMinutes] = useState(60);
  const [actionError, setActionError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Dashboard search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GrafanaDashboardSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const instancesQuery = useProviderQuery<GrafanaConfig[]>({
    query: () => getProvider().grafanaList(),
    deps: [],
    key: 'grafana:instances',
  });
  const instances = instancesQuery.data ?? [];
  const reload = instancesQuery.reload;
  const [selected, setSelected] = useFirstInstance(instances);

  // Preset dashboards are static; failures stay silent (as before).
  const presetsQuery = useProviderQuery<DashboardPreset[]>({
    query: () => getProvider().grafanaPresets(),
    deps: [],
    key: 'grafana:presets',
  });
  const presets = presetsQuery.data ?? [];

  useEffect(() => {
    if (presets.length > 0 && !activePreset) setActivePreset(presets[0].uid);
  }, [presets, activePreset]);

  const dashboardUrlQuery = useProviderQuery<string>({
    query: () => {
      if (!selected || !activePreset) return null;
      const endMs = Date.now();
      const startMs = endMs - rangeMinutes * 60 * 1000;
      return getProvider().grafanaDashboardUrl(selected, activePreset, startMs, endMs);
    },
    deps: [selected, activePreset, rangeMinutes],
    key: `grafana:url:${selected ?? 'none'}:${activePreset ?? 'none'}:${rangeMinutes}`,
  });
  const iframeUrl =
    selected && activePreset ? dashboardUrlQuery.data ?? null : null;

  const error = mergeErrors(actionError, instancesQuery.error, dashboardUrlQuery.error);

  const handleSearch = useCallback(
    (q: string) => {
      setSearchQuery(q);
      if (!selected || !q.trim()) {
        setSearchResults([]);
        return;
      }
      setSearching(true);
      getProvider()
        .grafanaSearchDashboards(selected, q.trim())
        .then((results) => {
          setSearchResults(results);
          setSearching(false);
        })
        .catch((e: unknown) => {
          setActionError(formatError(e));
          setSearching(false);
        });
    },
    [selected]
  );
  const [form, setForm] = useState({
    name: '',
    url: '',
    username: '',
    password: '',
    apiToken: '',
    defaultDatasource: 'Prometheus',
    description: '',
  });

  return (
    <>
    <ConfirmDialog
      open={!!pendingRemove}
      onClose={() => setPendingRemove(null)}
      onConfirm={async () => {
        if (!pendingRemove) return;
        await getProvider().grafanaRemove(pendingRemove);
        setSelected(null);
        reload();
        setPendingRemove(null);
      }}
      title={t('grafana.removeTitle', 'Remove Grafana instance')}
      body={t('grafana.confirmRemove', 'Remove this instance?')}
      danger
    />
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2>{t('grafana.title', 'Grafana')}</h2>
        {onClose && (
          <button className={styles.btn} onClick={onClose}>
            {t('grafana.close', 'Close')}
          </button>
        )}
      </header>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.body}>
        <aside className={styles.side}>
          {instances.length === 0 ? (
            <div className={styles.empty}>{t('grafana.none', 'No Grafana instances yet')}</div>
          ) : (
            <ul className={styles.list}>
              {instances.map((i) => (
                <li
                  key={i.name}
                  className={selected === i.name ? styles.itemActive : styles.item}
                  onClick={() => setSelected(i.name)}
                >
                  <div className={styles.itemName}>{i.name}</div>
                  <div className={styles.itemUrl}>{i.url}</div>
                </li>
              ))}
            </ul>
          )}
          {selected && (
            <div className={styles.sideActions}>
              <button
                className={styles.btn}
                onClick={async () => {
                  try {
                    await getProvider().grafanaTest(selected);
                    reload();
                  } catch (e) {
                    setActionError(formatError(e));
                    reload();
                  }
                }}
              >
                {t('grafana.test', 'Test')}
              </button>
              <button
                className={styles.btnDanger}
                onClick={() => setPendingRemove(selected)}
              >
                {t('grafana.remove', 'Remove')}
              </button>
            </div>
          )}
          <button
            className={styles.primary}
            onClick={() => {
              setForm({
                name: '',
                url: '',
                username: '',
                password: '',
                apiToken: '',
                defaultDatasource: 'Prometheus',
                description: '',
              });
              setAdding(true);
            }}
          >
            {t('grafana.add', 'Add instance')}
          </button>
        </aside>

        <main className={styles.main}>
          {adding ? (
            <form
              className={styles.form}
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await getProvider().grafanaUpsert({ ...form });
                  setAdding(false);
                  reload();
                } catch (err) {
                  setActionError(formatError(err));
                }
              }}
            >
              <h3>{t('grafana.form.title', 'Grafana instance')}</h3>
              <label>
                <span>{t('grafana.form.name', 'Name')}</span>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                <span>{t('grafana.form.url', 'URL')}</span>
                <input
                  required
                  placeholder="https://grafana.example.com"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                />
              </label>
              <label>
                <span>{t('grafana.form.apiToken', 'API token (optional)')}</span>
                <input
                  type="password"
                  value={form.apiToken}
                  onChange={(e) => setForm({ ...form, apiToken: e.target.value })}
                />
              </label>
              <label>
                <span>{t('grafana.form.ds', 'Default datasource')}</span>
                <input
                  value={form.defaultDatasource}
                  onChange={(e) => setForm({ ...form, defaultDatasource: e.target.value })}
                />
              </label>
              <div className={styles.formActions}>
                <button className={styles.primary} type="submit">
                  {t('grafana.form.save', 'Save')}
                </button>
                <button type="button" onClick={() => setAdding(false)} className={styles.btn}>
                  {t('grafana.form.cancel', 'Cancel')}
                </button>
              </div>
            </form>
          ) : selected ? (
            <>
              <div className={styles.dashHeader}>
                <h3>{t('grafana.dashboards', 'Preset dashboards')}</h3>
                <div className={styles.rangePresets}>
                  {getRangeOptions(t).map((r) => (
                    <button
                      key={r.label}
                      className={
                        rangeMinutes === r.minutes ? styles.activeRange : styles.rangePreset
                      }
                      onClick={() => setRangeMinutes(r.minutes)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <ul className={styles.presetList}>
                {presets.map((p) => (
                  <li
                    key={p.uid}
                    className={activePreset === p.uid ? styles.presetActive : styles.preset}
                    onClick={() => setActivePreset(p.uid)}
                  >
                    <div className={styles.presetTitle}>{p.title}</div>
                    <div className={styles.presetDesc}>{p.description}</div>
                  </li>
                ))}
              </ul>
              {/* Dashboard search */}
              <div style={{ margin: '8px 0' }}>
                <input
                  type="text"
                  placeholder={t('grafana.searchPlaceholder', 'Search dashboards…')}
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-terminal)',
                    border: '1px solid var(--border-control)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-body)',
                    padding: '4px 8px',
                    fontSize: 12,
                  }}
                />
                {searching && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>
                    {t('grafana.searching', 'Searching…')}
                  </div>
                )}
                {searchResults.length > 0 && (
                  <ul className={styles.presetList} style={{ marginTop: 4 }}>
                    {searchResults.map((d) => (
                      <li
                        key={d.uid}
                        className={activePreset === d.uid ? styles.presetActive : styles.preset}
                        onClick={() => setActivePreset(d.uid)}
                      >
                        <div className={styles.presetTitle}>{d.title}</div>
                        <div className={styles.presetDesc}>
                          {d.tags.length > 0 && `[${d.tags.join(', ')}]`}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {iframeUrl && (
                <iframe
                  className={styles.iframe}
                  src={iframeUrl}
                  title="Grafana"
                  sandbox="allow-same-origin allow-scripts"
                />
              )}
            </>
          ) : (
            <div className={styles.empty}>
              {t('grafana.pick', 'Add a Grafana instance to get started')}
            </div>
          )}
        </main>
      </div>
    </div>
    </>
  );
}

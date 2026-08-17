/**
 * AlertsPanel — list active alerts, silences, and alert rules from
 * configured AlertManager / Prometheus instances.
 *
 * Supports creating and expiring silences, and viewing Prometheus
 * alerting rules (read-only).
 */
import { useCallback, useEffect, useState } from 'react';
import { formatError, getProvider } from '../../providers';
import type {
  Alert,
  AlertManager,
  CreateSilenceRequest,
  RuleGroup,
  Silence,
  SilenceMatcher,
} from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import styles from './AlertsPanel.module.css';

export function AlertsPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [instances, setInstances] = useState<AlertManager[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [silences, setSilences] = useState<Silence[]>([]);
  const [ruleGroups, setRuleGroups] = useState<RuleGroup[]>([]);
  const [tab, setTab] = useState<'alerts' | 'silences' | 'rules'>('alerts');
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    getProvider()
      .alertManagerList()
      .then((rows) => {
        setInstances(rows);
        if (rows.length > 0 && !selected) {
          setSelected(rows[0].name);
        }
      })
      .catch((e: unknown) => setError(formatError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(() => {
    if (!selected) return;
    setError(null);
    if (tab === 'alerts') {
      getProvider()
        .alertManagerAlerts(selected)
        .then(setAlerts)
        .catch((e: unknown) => setError(formatError(e)));
    } else if (tab === 'silences') {
      getProvider()
        .alertManagerSilences(selected)
        .then(setSilences)
        .catch((e: unknown) => setError(formatError(e)));
    }
  }, [selected, tab]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Fetch rules from Prometheus when switching to rules tab.
  useEffect(() => {
    if (tab !== 'rules') return;
    if (instances.length === 0) return;
    // Use the first Prometheus instance (by convention the instance name
    // matches the AlertManager name; if not, we just try the first one).
    const promInstance = selected ?? instances[0]?.name;
    if (!promInstance) return;
    setError(null);
    getProvider()
      .prometheusRules(promInstance)
      .then(setRuleGroups)
      .catch((e: unknown) => setError(formatError(e)));
  }, [tab, selected, instances]);

  const handleExpireSilence = useCallback(
    async (silenceId: string) => {
      if (!selected) return;
      setError(null);
      try {
        await getProvider().alertManagerDeleteSilence(selected, silenceId);
        refresh();
      } catch (e: unknown) {
        setError(formatError(e));
      }
    },
    [selected, refresh]
  );

  const handleCreateSilence = useCallback(
    async (request: CreateSilenceRequest) => {
      if (!selected) return;
      setError(null);
      try {
        await getProvider().alertManagerCreateSilence(selected, request);
        setShowCreateForm(false);
        setTab('silences');
        refresh();
      } catch (e: unknown) {
        setError(formatError(e));
      }
    },
    [selected, refresh]
  );

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2>{t('alerts.title', 'Alerts')}</h2>
        {onClose && (
          <button className={styles.btn} onClick={onClose}>
            {t('alerts.close', 'Close')}
          </button>
        )}
      </header>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.body}>
        <aside className={styles.side}>
          {instances.length === 0 ? (
            <div className={styles.empty}>{t('alerts.none', 'No AlertManager instances yet')}</div>
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
        </aside>
        <main className={styles.main}>
          {selected ? (
            <>
              <div className={styles.tabs}>
                <button
                  className={tab === 'alerts' ? styles.activeTab : styles.tab}
                  onClick={() => setTab('alerts')}
                >
                  {t('alerts.tabs.alerts', 'Alerts')} ({alerts.length})
                </button>
                <button
                  className={tab === 'silences' ? styles.activeTab : styles.tab}
                  onClick={() => setTab('silences')}
                >
                  {t('alerts.tabs.silences', 'Silences')} ({silences.length})
                </button>
                <button
                  className={tab === 'rules' ? styles.activeTab : styles.tab}
                  onClick={() => setTab('rules')}
                >
                  {t('alerts.tabs.rules', 'Rules')}
                </button>
              </div>
              {tab === 'alerts' && <AlertList alerts={alerts} />}
              {tab === 'silences' && (
                <SilenceList
                  silences={silences}
                  onExpire={handleExpireSilence}
                  onCreate={() => setShowCreateForm(true)}
                />
              )}
              {tab === 'rules' && <RuleList groups={ruleGroups} />}
              {showCreateForm && (
                <CreateSilenceForm
                  onSubmit={handleCreateSilence}
                  onCancel={() => setShowCreateForm(false)}
                />
              )}
            </>
          ) : (
            <div className={styles.empty}>
              {t('alerts.pick', 'Add an AlertManager instance to get started')}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alert list
// ---------------------------------------------------------------------------

function AlertList({ alerts }: { alerts: Alert[] }) {
  const { t } = useTranslation();
  if (alerts.length === 0) {
    return <div className={styles.empty}>{t('alerts.empty.alerts', 'No active alerts')}</div>;
  }
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{t('alerts.cols.alert', 'Alert')}</th>
          <th>{t('alerts.cols.severity', 'Severity')}</th>
          <th>{t('alerts.cols.state', 'State')}</th>
          <th>{t('alerts.cols.summary', 'Summary')}</th>
          <th>{t('alerts.cols.activeSince', 'Active since')}</th>
        </tr>
      </thead>
      <tbody>
        {alerts.map((a) => (
          <tr key={a.fingerprint}>
            <td>
              <div className={styles.alertName}>{a.name}</div>
              <div className={styles.alertLabels}>
                {Object.entries(a.labels)
                  .filter(([k]) => k !== 'alertname')
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' ')}
              </div>
            </td>
            <td>
              <span
                className={
                  a.severity === 'critical'
                    ? styles.critical
                    : a.severity === 'warning'
                      ? styles.warning
                      : styles.info
                }
              >
                {a.severity}
              </span>
            </td>
            <td>{a.state}</td>
            <td>{a.summary}</td>
            <td className={styles.mono}>{a.activeAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Silence list with expire + create
// ---------------------------------------------------------------------------

function SilenceList({
  silences,
  onExpire,
  onCreate,
}: {
  silences: Silence[];
  onExpire: (id: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <button type="button" className={styles.btn} onClick={onCreate}>
          {t('alerts.silences.create', 'Create Silence…')}
        </button>
      </div>
      {silences.length === 0 ? (
        <div className={styles.empty}>{t('alerts.empty.silences', 'No silences')}</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('alerts.cols.matchers', 'Matchers')}</th>
              <th>{t('alerts.cols.comment', 'Comment')}</th>
              <th>{t('alerts.cols.createdBy', 'Created by')}</th>
              <th>{t('alerts.cols.starts', 'Starts')}</th>
              <th>{t('alerts.cols.ends', 'Ends')}</th>
              <th>{t('alerts.cols.status', 'Status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {silences.map((s) => (
              <tr key={s.id}>
                <td className={styles.mono}>{s.matchers.join(', ')}</td>
                <td>{s.comment}</td>
                <td>{s.createdBy}</td>
                <td className={styles.mono}>{s.startsAt}</td>
                <td className={styles.mono}>{s.endsAt}</td>
                <td>{s.status}</td>
                <td>
                  {s.status === 'active' && (
                    <button type="button" className={styles.btn} onClick={() => onExpire(s.id)}>
                      {t('alerts.silences.expire', 'Expire')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create silence form
// ---------------------------------------------------------------------------

function CreateSilenceForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (req: CreateSilenceRequest) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [matchers, setMatchers] = useState<SilenceMatcher[]>([
    { name: 'alertname', value: '', isRegex: false },
  ]);
  const [comment, setComment] = useState('');
  const [createdBy, setCreatedBy] = useState('k7s');
  const [durationHours, setDurationHours] = useState(4);

  const addMatcher = () =>
    setMatchers((prev) => [...prev, { name: '', value: '', isRegex: false }]);

  const updateMatcher = (i: number, field: keyof SilenceMatcher, val: string | boolean) =>
    setMatchers((prev) => prev.map((m, j) => (j === i ? { ...m, [field]: val } : m)));

  const removeMatcher = (i: number) => setMatchers((prev) => prev.filter((_, j) => j !== i));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const endsAt = new Date(Date.now() + durationHours * 3600 * 1000).toISOString();
    onSubmit({
      matchers: matchers.filter((m) => m.name && m.value),
      comment,
      createdBy,
      startsAt: '',
      endsAt,
    });
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--bg-overlay, rgba(0,0,0,0.5))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-control)',
          borderRadius: 'var(--radius-md)',
          padding: 16,
          width: 480,
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
      >
        <h3 style={{ margin: '0 0 12px' }}>{t('alerts.silences.createTitle', 'Create Silence')}</h3>

        {/* Matchers */}
        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
          <legend style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
            {t('alerts.silences.matchers', 'Matchers')}
          </legend>
          {matchers.map((m, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 4,
                marginBottom: 4,
                alignItems: 'center',
              }}
            >
              <input
                placeholder="name"
                value={m.name}
                onChange={(e) => updateMatcher(i, 'name', e.target.value)}
                style={inputStyle}
              />
              <select
                value={m.isRegex ? '=~' : '='}
                onChange={(e) => updateMatcher(i, 'isRegex', e.target.value === '=~')}
                style={{ ...inputStyle, width: 48 }}
              >
                <option value="=">=</option>
                <option value="=~">=~</option>
              </select>
              <input
                placeholder="value"
                value={m.value}
                onChange={(e) => updateMatcher(i, 'value', e.target.value)}
                style={inputStyle}
              />
              {matchers.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeMatcher(i)}
                  style={{ ...inputStyle, width: 28, cursor: 'pointer' }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={addMatcher} className={styles.btn}>
            + {t('alerts.silences.addMatcher', 'Add Matcher')}
          </button>
        </fieldset>

        {/* Duration */}
        <label style={labelStyle}>
          {t('alerts.silences.duration', 'Duration (hours)')}
          <input
            type="number"
            min={1}
            max={720}
            value={durationHours}
            onChange={(e) => setDurationHours(Number(e.target.value) || 1)}
            style={{ ...inputStyle, width: 80 }}
          />
        </label>

        {/* Comment */}
        <label style={labelStyle}>
          {t('alerts.silences.comment', 'Comment')}
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('alerts.silences.commentPlaceholder', 'Reason for silence')}
            style={inputStyle}
          />
        </label>

        {/* Created by */}
        <label style={labelStyle}>
          {t('alerts.silences.createdBy', 'Created by')}
          <input
            value={createdBy}
            onChange={(e) => setCreatedBy(e.target.value)}
            style={inputStyle}
          />
        </label>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className={styles.btn} onClick={onCancel}>
            {t('chrome.common.cancel', 'Cancel')}
          </button>
          <button
            type="submit"
            className={styles.btn}
            disabled={!matchers.some((m) => m.name && m.value)}
          >
            {t('alerts.silences.createBtn', 'Create')}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule list (from Prometheus /api/v1/rules)
// ---------------------------------------------------------------------------

function RuleList({ groups }: { groups: RuleGroup[] }) {
  const { t } = useTranslation();
  if (groups.length === 0) {
    return <div className={styles.empty}>{t('alerts.rules.empty', 'No alerting rules found')}</div>;
  }
  return (
    <div>
      {groups.map((g) => (
        <div key={g.name} style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-muted)',
              marginBottom: 4,
            }}
          >
            {g.name}
            {g.file && <span style={{ fontWeight: 400, marginLeft: 8 }}>{g.file}</span>}
          </div>
          {g.rules.length === 0 ? (
            <div className={styles.empty} style={{ fontSize: 11 }}>
              {t('alerts.rules.noRules', 'No alerting rules in this group')}
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('alerts.rules.cols.name', 'Name')}</th>
                  <th>{t('alerts.rules.cols.severity', 'Severity')}</th>
                  <th>{t('alerts.rules.cols.state', 'State')}</th>
                  <th>{t('alerts.rules.cols.for', 'For')}</th>
                  <th>{t('alerts.rules.cols.query', 'Query')}</th>
                </tr>
              </thead>
              <tbody>
                {g.rules.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>
                      <span
                        className={
                          r.severity === 'critical'
                            ? styles.critical
                            : r.severity === 'warning'
                              ? styles.warning
                              : styles.info
                        }
                      >
                        {r.severity || '—'}
                      </span>
                    </td>
                    <td>{r.state}</td>
                    <td>{r.duration > 0 ? `${r.duration}s` : '—'}</td>
                    <td
                      className={styles.mono}
                      style={{
                        maxWidth: 300,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={r.query}
                    >
                      {r.query}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-terminal)',
  border: '1px solid var(--border-control)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-body)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11.5,
  padding: '4px 6px',
  flex: 1,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 12,
  color: 'var(--text-muted)',
  marginBottom: 8,
};

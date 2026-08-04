/**
 * AuditPanel — K8s audit log viewer via Loki.
 *
 * Lists Loki instances (CRUD), queries kube-apiserver audit events,
 * and renders them in a filterable table.
 */
import { useCallback, useEffect, useState } from 'react';
import { getProvider } from '../../providers';
import type { AuditEvent, AuditQuery, LokiConfig } from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';

export function AuditPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [instances, setInstances] = useState<LokiConfig[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Filters
  const [namespace, setNamespace] = useState('');
  const [resource, setResource] = useState('');
  const [user, setUser] = useState('');
  const [sinceSeconds, setSinceSeconds] = useState(3600);

  // Add instance form
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addUser, setAddUser] = useState('');
  const [addPass, setAddPass] = useState('');

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    getProvider()
      .lokiList()
      .then((rows) => {
        setInstances(rows);
        if (rows.length > 0 && !selected) setSelected(rows[0].name);
      })
      .catch((e: unknown) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchEvents = useCallback(() => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    const query: AuditQuery = {
      instance: selected,
      namespace,
      resource,
      user,
      sinceSeconds,
      limit: 200,
    };
    getProvider()
      .auditEvents(query)
      .then((evts) => {
        setEvents(evts);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(String(e));
        setLoading(false);
      });
  }, [selected, namespace, resource, user, sinceSeconds]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleAddInstance = async () => {
    try {
      await getProvider().lokiUpsert({
        name: addName,
        url: addUrl,
        username: addUser,
        password: addPass,
        description: '',
      });
      const rows = await getProvider().lokiList();
      setInstances(rows);
      setSelected(addName);
      setShowAdd(false);
      setAddName('');
      setAddUrl('');
      setAddUser('');
      setAddPass('');
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const handleRemoveInstance = async (name: string) => {
    try {
      await getProvider().lokiRemove(name);
      const rows = await getProvider().lokiList();
      setInstances(rows);
      if (selected === name) setSelected(rows[0]?.name ?? null);
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const sinceOptions = [
    { label: '15m', value: 900 },
    { label: '1h', value: 3600 },
    { label: '6h', value: 21600 },
    { label: '24h', value: 86400 },
  ];

  return (
    <div style={panelStyle}>
      <header style={headerStyle}>
        <h2 style={{ margin: 0, fontSize: 14 }}>{t('audit.title', 'Audit Log')}</h2>
        {onClose && (
          <button type="button" style={btnStyle} onClick={onClose}>
            {t('chrome.common.close', 'Close')}
          </button>
        )}
      </header>
      {error && <div style={errorStyle}>{error}</div>}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar — Loki instances */}
        <aside style={sideStyle}>
          <div
            style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: 'var(--text-muted)' }}
          >
            {t('audit.instances', 'Loki Instances')}
          </div>
          {instances.map((inst) => (
            <div
              key={inst.name}
              style={{
                ...itemStyle,
                background: selected === inst.name ? 'var(--bg-selected)' : undefined,
              }}
              onClick={() => setSelected(inst.name)}
            >
              <div style={{ fontSize: 12 }}>{inst.name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{inst.url}</div>
              <button
                type="button"
                style={{ ...btnStyle, fontSize: 10, padding: '1px 4px' }}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleRemoveInstance(inst.name);
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            style={{ ...btnStyle, marginTop: 4 }}
            onClick={() => setShowAdd(!showAdd)}
          >
            {showAdd ? t('chrome.common.cancel', 'Cancel') : t('audit.add', 'Add Loki…')}
          </button>
          {showAdd && (
            <div style={{ marginTop: 4 }}>
              <input
                placeholder="Name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                style={inputStyle}
              />
              <input
                placeholder="URL"
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                style={inputStyle}
              />
              <input
                placeholder="Username"
                value={addUser}
                onChange={(e) => setAddUser(e.target.value)}
                style={inputStyle}
              />
              <input
                placeholder="Password"
                type="password"
                value={addPass}
                onChange={(e) => setAddPass(e.target.value)}
                style={inputStyle}
              />
              <button type="button" style={btnStyle} onClick={() => void handleAddInstance()}>
                {t('chrome.common.apply', 'Apply')}
              </button>
            </div>
          )}
        </aside>

        {/* Main area */}
        <main style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          {/* Filters */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              marginBottom: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <input
              placeholder={t('audit.filter.namespace', 'Namespace')}
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              style={{ ...inputStyle, width: 120 }}
            />
            <input
              placeholder={t('audit.filter.resource', 'Resource')}
              value={resource}
              onChange={(e) => setResource(e.target.value)}
              style={{ ...inputStyle, width: 120 }}
            />
            <input
              placeholder={t('audit.filter.user', 'User')}
              value={user}
              onChange={(e) => setUser(e.target.value)}
              style={{ ...inputStyle, width: 120 }}
            />
            {sinceOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                style={{
                  ...btnStyle,
                  background: sinceSeconds === opt.value ? 'var(--bg-selected)' : undefined,
                }}
                onClick={() => setSinceSeconds(opt.value)}
              >
                {opt.label}
              </button>
            ))}
            <button type="button" style={btnStyle} onClick={fetchEvents}>
              {t('audit.refresh', 'Refresh')}
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {loading ? t('audit.loading', 'Loading…') : `${events.length} events`}
            </span>
          </div>

          {/* Events table */}
          {events.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 16 }}>
              {t('audit.empty', 'No audit events found')}
            </div>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('audit.cols.timestamp', 'Time')}</th>
                  <th style={thStyle}>{t('audit.cols.verb', 'Verb')}</th>
                  <th style={thStyle}>{t('audit.cols.resource', 'Resource')}</th>
                  <th style={thStyle}>{t('audit.cols.namespace', 'NS')}</th>
                  <th style={thStyle}>{t('audit.cols.name', 'Name')}</th>
                  <th style={thStyle}>{t('audit.cols.user', 'User')}</th>
                  <th style={thStyle}>{t('audit.cols.status', 'Status')}</th>
                  <th style={thStyle}>{t('audit.cols.sourceIp', 'Source IP')}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((evt) => (
                  <>
                    <tr
                      key={evt.auditId || evt.timestamp}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setExpandedId(expandedId === evt.auditId ? null : evt.auditId)}
                    >
                      <td style={tdStyle}>{formatTimestamp(evt.timestamp)}</td>
                      <td style={tdStyle}>
                        <span style={verbStyle(evt.verb)}>{evt.verb}</span>
                      </td>
                      <td style={tdStyle}>
                        {evt.resource}
                        {evt.subresource ? `/${evt.subresource}` : ''}
                      </td>
                      <td style={tdStyle}>{evt.namespace || '—'}</td>
                      <td style={tdStyle}>{evt.name || '—'}</td>
                      <td style={tdStyle}>{evt.user}</td>
                      <td style={tdStyle}>
                        <span style={statusStyle(evt.statusCode)}>{evt.statusCode}</span>
                      </td>
                      <td style={tdStyle}>{evt.sourceIp || '—'}</td>
                    </tr>
                    {expandedId === evt.auditId && (
                      <tr key={`${evt.auditId}-detail`}>
                        <td colSpan={8} style={{ padding: 4, background: 'var(--bg-terminal)' }}>
                          <pre style={preStyle}>{formatJson(evt.raw)}</pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </main>
      </div>
    </div>
  );
}

function formatTimestamp(ts: string): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString();
  } catch {
    return ts.slice(11, 19);
  }
}

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function verbStyle(verb: string): React.CSSProperties {
  const lc = verb.toLowerCase();
  const color =
    lc === 'create'
      ? 'var(--status-ok)'
      : lc === 'delete'
        ? 'var(--status-err)'
        : lc === 'update' || lc === 'patch'
          ? 'var(--status-warn)'
          : 'var(--text-body)';
  return { color, fontWeight: 500 };
}

function statusStyle(code: number): React.CSSProperties {
  const color =
    code >= 200 && code < 300
      ? 'var(--status-ok)'
      : code >= 400 && code < 500
        ? 'var(--status-warn)'
        : code >= 500
          ? 'var(--status-err)'
          : 'var(--text-body)';
  return { color };
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: 'var(--bg-panel)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-subtle)',
};

const sideStyle: React.CSSProperties = {
  width: 200,
  borderRight: '1px solid var(--border-subtle)',
  padding: 8,
  overflowY: 'auto',
  flexShrink: 0,
};

const itemStyle: React.CSSProperties = {
  padding: '4px 6px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  marginBottom: 2,
};

const btnStyle: React.CSSProperties = {
  background: 'var(--bg-control)',
  border: '1px solid var(--border-control)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-body)',
  fontSize: 11,
  padding: '3px 8px',
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-terminal)',
  border: '1px solid var(--border-control)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-body)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  padding: '3px 6px',
  width: '100%',
  marginBottom: 4,
};

const errorStyle: React.CSSProperties = {
  color: 'var(--status-err)',
  fontSize: 11,
  padding: '4px 12px',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 6px',
  borderBottom: '1px solid var(--border-control)',
  color: 'var(--text-muted)',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '3px 6px',
  borderBottom: '1px solid var(--border-subtle)',
  whiteSpace: 'nowrap',
};

const preStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-body)',
  maxHeight: 300,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

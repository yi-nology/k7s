/**
 * AuditPanel — K8s audit log viewer via Loki.
 *
 * Lists Loki instances (CRUD), queries kube-apiserver audit events,
 * and renders them in a filterable table.
 */
import { Fragment, useState } from 'react';
import { formatError, getProvider } from '../../providers';
import type { AuditEvent, AuditQuery, LokiConfig } from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import { useProviderQuery } from '../../hooks/useProviderQuery';
import { useFirstInstance, mergeErrors } from '../../hooks/useAutoSelect';
import { formatTimestamp, formatJson, verbStyle, statusStyle } from './auditUtils';

export function AuditPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  // Errors from the add/remove instance handlers (the fetches below carry
  // their own error state through the query hook).
  const [actionError, setActionError] = useState<string | null>(null);

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

  const instancesQuery = useProviderQuery<LokiConfig[]>({
    query: () => getProvider().lokiList(),
    deps: [],
    key: 'audit:instances',
  });
  const instances = instancesQuery.data ?? [];
  const [selected, setSelected] = useFirstInstance(instances);

  const eventsQuery = useProviderQuery<AuditEvent[]>({
    query: () => {
      if (!selected) return null;
      const query: AuditQuery = {
        instance: selected,
        namespace,
        resource,
        user,
        sinceSeconds,
        limit: 200,
      };
      return getProvider().auditEvents(query);
    },
    deps: [selected, namespace, resource, user, sinceSeconds],
    key: `audit:events:${selected ?? 'none'}:${namespace}:${resource}:${user}:${sinceSeconds}`,
  });
  const events = eventsQuery.data ?? [];
  const error = mergeErrors(actionError, instancesQuery.error, eventsQuery.error);
  const loading = eventsQuery.loading;
  const fetchEvents = () => eventsQuery.reload();

  const handleAddInstance = async () => {
    setActionError(null);
    try {
      await getProvider().lokiUpsert({
        name: addName,
        url: addUrl,
        username: addUser,
        password: addPass,
        description: '',
      });
      setSelected(addName);
      setShowAdd(false);
      setAddName('');
      setAddUrl('');
      setAddUser('');
      setAddPass('');
      instancesQuery.reload();
    } catch (e: unknown) {
      setActionError(formatError(e));
    }
  };

  const handleRemoveInstance = async (name: string) => {
    setActionError(null);
    try {
      await getProvider().lokiRemove(name);
      if (selected === name) setSelected(null);
      instancesQuery.reload();
    } catch (e: unknown) {
      setActionError(formatError(e));
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
                placeholder={t('auditExtra.namePlaceholder')}
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                style={inputStyle}
              />
              <input
                placeholder={t('auditExtra.urlPlaceholder')}
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                style={inputStyle}
              />
              <input
                placeholder={t('auditExtra.usernamePlaceholder')}
                value={addUser}
                onChange={(e) => setAddUser(e.target.value)}
                style={inputStyle}
              />
              <input
                placeholder={t('auditExtra.passwordPlaceholder')}
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
              {loading ? t('audit.loading', 'Loading…') : t('auditExtra.eventsCount', events.length)}
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
                  <Fragment key={evt.auditId || evt.timestamp}>
                    <tr
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
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </main>
      </div>
    </div>
  );
}

// Utility functions extracted to ./auditUtils.ts:
// - formatTimestamp, formatJson, verbStyle, statusStyle

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

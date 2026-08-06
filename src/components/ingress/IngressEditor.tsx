/**
 * IngressEditor — visual editor for creating/editing Kubernetes Ingress resources.
 *
 * Structured form for rules, TLS, annotations, then generates YAML and applies
 * via the existing dryRunYaml → applyYaml path.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatError, getProvider } from '../../providers';
import { useTranslation } from '../../hooks/useI18n';
import { useStore } from '../../store';
import { isValidK8sName, isValidNamespace } from '../../lib/security';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IngressPath {
  path: string;
  pathType: 'Prefix' | 'Exact' | 'ImplementationSpecific';
  serviceName: string;
  servicePort: number;
}

interface IngressRule {
  host: string;
  paths: IngressPath[];
}

interface IngressTls {
  secretName: string;
  hosts: string[];
}

interface Annotation {
  key: string;
  value: string;
}

interface IngressForm {
  name: string;
  namespace: string;
  ingressClass: string;
  rules: IngressRule[];
  tls: IngressTls[];
  annotations: Annotation[];
}

const emptyPath = (): IngressPath => ({
  path: '/',
  pathType: 'Prefix',
  serviceName: '',
  servicePort: 80,
});

const emptyRule = (): IngressRule => ({
  host: '',
  paths: [emptyPath()],
});

const emptyForm: IngressForm = {
  name: '',
  namespace: 'default',
  ingressClass: '',
  rules: [emptyRule()],
  tls: [],
  annotations: [],
};

// ---------------------------------------------------------------------------
// YAML generation
// ---------------------------------------------------------------------------

function generateYaml(form: IngressForm): string {
  const lines: string[] = [];
  lines.push('apiVersion: networking.k8s.io/v1');
  lines.push('kind: Ingress');
  lines.push('metadata:');
  lines.push(`  name: ${form.name || 'my-ingress'}`);
  if (form.namespace && form.namespace !== 'default') {
    lines.push(`  namespace: ${form.namespace}`);
  }
  if (form.annotations.length > 0 || form.ingressClass) {
    lines.push('  annotations:');
    if (form.ingressClass) {
      lines.push(`    kubernetes.io/ingress.class: "${form.ingressClass}"`);
    }
    for (const a of form.annotations) {
      if (a.key) lines.push(`    ${a.key}: "${a.value}"`);
    }
  }
  lines.push('spec:');
  if (form.ingressClass) {
    lines.push(`  ingressClassName: ${form.ingressClass}`);
  }
  if (form.tls.length > 0) {
    lines.push('  tls:');
    for (const t of form.tls) {
      lines.push(`  - secretName: ${t.secretName || 'tls-secret'}`);
      if (t.hosts.length > 0) {
        lines.push('    hosts:');
        for (const h of t.hosts) {
          if (h) lines.push(`    - ${h}`);
        }
      }
    }
  }
  if (form.rules.length > 0) {
    lines.push('  rules:');
    for (const r of form.rules) {
      if (r.host) {
        lines.push(`  - host: ${r.host}`);
      }
      lines.push('    http:');
      lines.push('      paths:');
      for (const p of r.paths) {
        lines.push(`      - path: ${p.path || '/'}`);
        lines.push(`        pathType: ${p.pathType}`);
        lines.push('        backend:');
        lines.push('          service:');
        lines.push(`            name: ${p.serviceName || 'my-service'}`);
        lines.push(`            port:`);
        lines.push(`              number: ${p.servicePort || 80}`);
      }
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IngressEditor({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<IngressForm>({ ...emptyForm });
  const [yamlMode, setYamlMode] = useState(false);
  const [yaml, setYaml] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<string | null>(null);

  // Pre-fill from existing ingress if editing
  const editIngress = useStore((s) => s.overlayPodRef);

  useEffect(() => {
    if (editIngress?.name) {
      setForm((f) => ({
        ...f,
        name: editIngress.name ?? '',
        namespace: editIngress.namespace ?? 'default',
      }));
    }
  }, [editIngress]);

  const generatedYaml = useMemo(() => generateYaml(form), [form]);

  useEffect(() => {
    if (yamlMode) setYaml(generatedYaml);
  }, [yamlMode, generatedYaml]);

  const handleDryRun = useCallback(async () => {
    setBusy(true);
    setError(null);
    setDryRunResult(null);
    try {
      const y = yamlMode ? yaml : generatedYaml;
      const results = await getProvider().dryRunYamlBundle(y);
      const summary = results
        .map((r) => `${r.kind}/${r.namespace}/${r.name}: ${r.error || 'ok'}`)
        .join('\n');
      setDryRunResult(summary || 'Dry run passed');
    } catch (e: unknown) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }, [yamlMode, yaml, generatedYaml]);

  const handleApply = useCallback(async () => {
    // Validate form inputs before applying
    if (!yamlMode) {
      if (form.name && !isValidK8sName(form.name)) {
        setError(
          t(
            'ingressEditor.invalidName',
            'Invalid ingress name: must be lowercase alphanumeric with hyphens'
          )
        );
        return;
      }
      if (form.namespace && !isValidNamespace(form.namespace)) {
        setError(t('ingressEditor.invalidNamespace', 'Invalid namespace name'));
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const y = yamlMode ? yaml : generatedYaml;
      await getProvider().applyYamlBundle(y);
      onClose?.();
    } catch (e: unknown) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }, [yamlMode, yaml, generatedYaml, onClose, form.name, form.namespace, t]);

  // Form mutation helpers
  const update = <K extends keyof IngressForm>(key: K, val: IngressForm[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  return (
    <div style={panelStyle}>
      <header style={headerStyle}>
        <h2 style={{ margin: 0, fontSize: 14 }}>{t('ingressEditor.title', 'Ingress Editor')}</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" style={btnStyle} onClick={() => setYamlMode(!yamlMode)}>
            {yamlMode ? t('ingressEditor.form', 'Form') : t('ingressEditor.yaml', 'YAML')}
          </button>
          {onClose && (
            <button type="button" style={btnStyle} onClick={onClose}>
              {t('chrome.common.close', 'Close')}
            </button>
          )}
        </div>
      </header>
      {error && <div style={errorStyle}>{error}</div>}

      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {yamlMode ? (
          /* YAML mode */
          <textarea value={yaml} onChange={(e) => setYaml(e.target.value)} style={textareaStyle} />
        ) : (
          /* Form mode */
          <div style={{ maxWidth: 720 }}>
            {/* Basic info */}
            <fieldset style={fieldsetStyle}>
              <legend style={legendStyle}>{t('ingressEditor.basic', 'Basic')}</legend>
              <div style={rowStyle}>
                <label style={labelColStyle}>
                  {t('ingressEditor.name', 'Name')}
                  <input
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                    style={inputStyle}
                  />
                </label>
                <label style={labelColStyle}>
                  {t('ingressEditor.namespace', 'Namespace')}
                  <input
                    value={form.namespace}
                    onChange={(e) => update('namespace', e.target.value)}
                    style={inputStyle}
                  />
                </label>
                <label style={labelColStyle}>
                  {t('ingressEditor.ingressClass', 'IngressClass')}
                  <input
                    value={form.ingressClass}
                    onChange={(e) => update('ingressClass', e.target.value)}
                    style={inputStyle}
                    placeholder="nginx"
                  />
                </label>
              </div>
            </fieldset>

            {/* TLS */}
            <fieldset style={fieldsetStyle}>
              <legend style={legendStyle}>
                {t('ingressEditor.tls', 'TLS')}
                <button
                  type="button"
                  style={{ ...btnStyle, marginLeft: 8 }}
                  onClick={() => update('tls', [...form.tls, { secretName: '', hosts: [''] }])}
                >
                  + {t('ingressEditor.addTls', 'Add TLS')}
                </button>
              </legend>
              {form.tls.map((tls, ti) => (
                <div key={ti} style={{ ...rowStyle, alignItems: 'flex-end', marginBottom: 6 }}>
                  <label style={labelColStyle}>
                    {t('ingressEditor.secretName', 'Secret Name')}
                    <input
                      value={tls.secretName}
                      onChange={(e) => {
                        const tls2 = [...form.tls];
                        tls2[ti] = { ...tls2[ti], secretName: e.target.value };
                        update('tls', tls2);
                      }}
                      style={inputStyle}
                    />
                  </label>
                  <label style={{ ...labelColStyle, flex: 2 }}>
                    {t('ingressEditor.tlsHosts', 'Hosts (comma-separated)')}
                    <input
                      value={tls.hosts.join(', ')}
                      onChange={(e) => {
                        const tls2 = [...form.tls];
                        tls2[ti] = {
                          ...tls2[ti],
                          hosts: e.target.value.split(',').map((s) => s.trim()),
                        };
                        update('tls', tls2);
                      }}
                      style={inputStyle}
                    />
                  </label>
                  <button
                    type="button"
                    style={{ ...btnStyle, color: 'var(--status-err)' }}
                    onClick={() =>
                      update(
                        'tls',
                        form.tls.filter((_, i) => i !== ti)
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </fieldset>

            {/* Rules */}
            <fieldset style={fieldsetStyle}>
              <legend style={legendStyle}>
                {t('ingressEditor.rules', 'Rules')}
                <button
                  type="button"
                  style={{ ...btnStyle, marginLeft: 8 }}
                  onClick={() => update('rules', [...form.rules, emptyRule()])}
                >
                  + {t('ingressEditor.addRule', 'Add Rule')}
                </button>
              </legend>
              {form.rules.map((rule, ri) => (
                <div
                  key={ri}
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 8,
                    marginBottom: 8,
                  }}
                >
                  <div style={rowStyle}>
                    <label style={{ ...labelColStyle, flex: 2 }}>
                      {t('ingressEditor.host', 'Host')}
                      <input
                        value={rule.host}
                        onChange={(e) => {
                          const rules2 = [...form.rules];
                          rules2[ri] = { ...rules2[ri], host: e.target.value };
                          update('rules', rules2);
                        }}
                        style={inputStyle}
                        placeholder="app.example.com"
                      />
                    </label>
                    <button
                      type="button"
                      style={{ ...btnStyle, color: 'var(--status-err)', alignSelf: 'flex-end' }}
                      onClick={() =>
                        update(
                          'rules',
                          form.rules.filter((_, i) => i !== ri)
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                  {/* Paths */}
                  {rule.paths.map((path, pi) => (
                    <div key={pi} style={{ ...rowStyle, marginLeft: 16, marginBottom: 4 }}>
                      <label style={labelColStyle}>
                        {t('ingressEditor.path', 'Path')}
                        <input
                          value={path.path}
                          onChange={(e) => {
                            const rules2 = [...form.rules];
                            const paths = [...rules2[ri].paths];
                            paths[pi] = { ...paths[pi], path: e.target.value };
                            rules2[ri] = { ...rules2[ri], paths };
                            update('rules', rules2);
                          }}
                          style={inputStyle}
                        />
                      </label>
                      <label style={labelColStyle}>
                        {t('ingressEditor.pathType', 'PathType')}
                        <select
                          value={path.pathType}
                          onChange={(e) => {
                            const rules2 = [...form.rules];
                            const paths = [...rules2[ri].paths];
                            paths[pi] = {
                              ...paths[pi],
                              pathType: e.target.value as IngressPath['pathType'],
                            };
                            rules2[ri] = { ...rules2[ri], paths };
                            update('rules', rules2);
                          }}
                          style={inputStyle}
                        >
                          <option value="Prefix">Prefix</option>
                          <option value="Exact">Exact</option>
                          <option value="ImplementationSpecific">ImplementationSpecific</option>
                        </select>
                      </label>
                      <label style={labelColStyle}>
                        {t('ingressEditor.serviceName', 'Service')}
                        <input
                          value={path.serviceName}
                          onChange={(e) => {
                            const rules2 = [...form.rules];
                            const paths = [...rules2[ri].paths];
                            paths[pi] = { ...paths[pi], serviceName: e.target.value };
                            rules2[ri] = { ...rules2[ri], paths };
                            update('rules', rules2);
                          }}
                          style={inputStyle}
                        />
                      </label>
                      <label style={{ ...labelColStyle, maxWidth: 80 }}>
                        {t('ingressEditor.port', 'Port')}
                        <input
                          type="number"
                          value={path.servicePort}
                          onChange={(e) => {
                            const rules2 = [...form.rules];
                            const paths = [...rules2[ri].paths];
                            paths[pi] = { ...paths[pi], servicePort: Number(e.target.value) || 80 };
                            rules2[ri] = { ...rules2[ri], paths };
                            update('rules', rules2);
                          }}
                          style={inputStyle}
                        />
                      </label>
                      {rule.paths.length > 1 && (
                        <button
                          type="button"
                          style={{ ...btnStyle, color: 'var(--status-err)', alignSelf: 'flex-end' }}
                          onClick={() => {
                            const rules2 = [...form.rules];
                            rules2[ri] = {
                              ...rules2[ri],
                              paths: rule.paths.filter((_, i) => i !== pi),
                            };
                            update('rules', rules2);
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    style={{ ...btnStyle, marginLeft: 16 }}
                    onClick={() => {
                      const rules2 = [...form.rules];
                      rules2[ri] = { ...rules2[ri], paths: [...rule.paths, emptyPath()] };
                      update('rules', rules2);
                    }}
                  >
                    + {t('ingressEditor.addPath', 'Add Path')}
                  </button>
                </div>
              ))}
            </fieldset>

            {/* Annotations */}
            <fieldset style={fieldsetStyle}>
              <legend style={legendStyle}>
                {t('ingressEditor.annotations', 'Annotations')}
                <button
                  type="button"
                  style={{ ...btnStyle, marginLeft: 8 }}
                  onClick={() =>
                    update('annotations', [...form.annotations, { key: '', value: '' }])
                  }
                >
                  + {t('ingressEditor.addAnnotation', 'Add')}
                </button>
              </legend>
              {form.annotations.map((ann, ai) => (
                <div key={ai} style={rowStyle}>
                  <input
                    value={ann.key}
                    onChange={(e) => {
                      const a2 = [...form.annotations];
                      a2[ai] = { ...a2[ai], key: e.target.value };
                      update('annotations', a2);
                    }}
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder="key"
                  />
                  <input
                    value={ann.value}
                    onChange={(e) => {
                      const a2 = [...form.annotations];
                      a2[ai] = { ...a2[ai], value: e.target.value };
                      update('annotations', a2);
                    }}
                    style={{ ...inputStyle, flex: 2 }}
                    placeholder="value"
                  />
                  <button
                    type="button"
                    style={{ ...btnStyle, color: 'var(--status-err)' }}
                    onClick={() =>
                      update(
                        'annotations',
                        form.annotations.filter((_, i) => i !== ai)
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </fieldset>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div style={footerStyle}>
        {dryRunResult && (
          <pre
            style={{
              margin: 0,
              fontSize: 10,
              color: dryRunResult.includes('failed') ? 'var(--status-err)' : 'var(--status-ok)',
              maxHeight: 60,
              overflow: 'auto',
            }}
          >
            {dryRunResult}
          </pre>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            style={btnStyle}
            disabled={busy}
            onClick={() => void handleDryRun()}
          >
            {t('ingressEditor.dryRun', 'Dry Run')}
          </button>
          <button
            type="button"
            style={{ ...btnStyle, background: 'var(--accent)', color: '#fff' }}
            disabled={busy || !form.name}
            onClick={() => void handleApply()}
          >
            {busy ? t('ingressEditor.applying', 'Applying…') : t('ingressEditor.apply', 'Apply')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderTop: '1px solid var(--border-subtle)',
  gap: 8,
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
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  width: '100%',
  minHeight: 400,
  resize: 'vertical',
  lineHeight: 1.5,
};

const errorStyle: React.CSSProperties = {
  color: 'var(--status-err)',
  fontSize: 11,
  padding: '4px 12px',
};

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: 8,
  marginBottom: 12,
};

const legendStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-muted)',
  padding: '0 4px',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  marginBottom: 4,
  alignItems: 'center',
};

const labelColStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 11,
  color: 'var(--text-muted)',
  flex: 1,
};

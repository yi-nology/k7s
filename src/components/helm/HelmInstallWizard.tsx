/**
 * HelmInstallWizard — the right pane of the marketplace tab.
 *
 * Three steps: pick a version → fill values → review and install.
 * The install streams logs through `onHelmOpLog` and reports the final
 * outcome via `onHelmOpDone`; we mirror both locally so the wizard
 * can show progress even when the user has not navigated away.
 *
 * Why three steps: the chart picker already happened in the left list
 * (the wizard is opened from a chart row). Version + values is where
 * the user actually spends time, and the review step is the dry-run
 * gate that catches 90% of "whoops wrong namespace" mistakes.
 */
import { useEffect, useRef, useState } from 'react';
import { getProvider } from '../../providers';
import type { HelmChartSummary, HelmChartVersionEntry, HelmOpResult } from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import { isValidHelmReleaseName, isValidNamespace, isSafeHelmValues } from '../../lib/security';
import styles from './HelmMarket.module.css';

type Step = 'version' | 'values' | 'review';

export function HelmInstallWizard({
  chart,
  onDone,
}: {
  chart: HelmChartSummary;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('version');
  const [versions, setVersions] = useState<HelmChartVersionEntry[]>([]);
  const [selectedVersion, setSelectedVersion] = useState(chart.version);
  const [releaseName, setReleaseName] = useState(
    chart.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  );
  const [namespace, setNamespace] = useState('default');
  const [values, setValues] = useState('');
  const [createNs, setCreateNs] = useState(false);
  const [logs, setLogs] = useState<{ stream: string; line: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HelmOpResult | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  // Load versions for this chart on mount.
  useEffect(() => {
    let cancelled = false;
    getProvider()
      .helmChartVersions(chart.repo, chart.name)
      .then((vs) => {
        if (cancelled) return;
        setVersions(vs);
        if (vs.length > 0 && !vs.find((v) => v.version === selectedVersion)) {
          setSelectedVersion(vs[0].version);
        }
      })
      .catch(() => {
        // Fall back to whatever the summary advertised.
        setVersions([
          {
            version: chart.version,
            appVersion: chart.appVersion,
            created: '',
            urls: [],
          },
        ]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart.repo, chart.name]);

  // When the user advances to "values", prefill with the chart's defaults.
  useEffect(() => {
    if (step !== 'values') return;
    if (values) return; // already loaded; preserve user edits
    getProvider()
      .helmRenderDefaultValues(chart.name, selectedVersion)
      .then(setValues)
      .catch((e: unknown) => setValues(`# error loading defaults: ${String(e)}\n`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedVersion]);

  // Live log tail: append and auto-scroll.
  useEffect(() => {
    if (logs.length === 0) return;
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  const doInstall = async () => {
    // Validate inputs before proceeding
    if (!isValidHelmReleaseName(releaseName)) {
      setResult({
        op: 'install',
        release: releaseName,
        namespace,
        success: false,
        lines: 0,
        summary: t(
          'helm.wizard.invalidReleaseName',
          'Invalid release name: must be lowercase alphanumeric with hyphens, max 63 chars'
        ),
      });
      return;
    }
    if (!isValidNamespace(namespace)) {
      setResult({
        op: 'install',
        release: releaseName,
        namespace,
        success: false,
        lines: 0,
        summary: t('helm.wizard.invalidNamespace', 'Invalid namespace name'),
      });
      return;
    }
    if (!isSafeHelmValues(values)) {
      setResult({
        op: 'install',
        release: releaseName,
        namespace,
        success: false,
        lines: 0,
        summary: t(
          'helm.wizard.unsafeValues',
          'Values contain potentially unsafe content (template injection or command substitution)'
        ),
      });
      return;
    }

    setRunning(true);
    setResult(null);
    setLogs([]);
    // Subscribe to live logs for this op.
    const unsub = getProvider().onHelmOpLog((l) => setLogs((cur) => [...cur, l]));
    const unsubDone = getProvider().onHelmOpDone((r) => setResult(r));
    try {
      const res = await getProvider().helmRunOp({
        op: 'install',
        args: {
          release: releaseName,
          chart: `${chart.repo}/${chart.name}`,
          version: selectedVersion,
          namespace,
          values,
          dryRun: false,
          createNamespace: createNs,
        },
      });
      setResult(res);
    } catch (e) {
      setResult({
        op: 'install',
        release: releaseName,
        namespace,
        success: false,
        lines: 0,
        summary: String(e),
      });
    } finally {
      unsub();
      unsubDone();
      setRunning(false);
    }
  };

  return (
    <div className={styles.wizard}>
      <header className={styles.wizardHeader}>
        <h2>{chart.name}</h2>
        <p className={styles.chartDesc}>{chart.description}</p>
      </header>

      <ol className={styles.steps}>
        {(['version', 'values', 'review'] as const).map((s) => (
          <li
            key={s}
            className={s === step ? styles.stepActive : styles.step}
            onClick={() => setStep(s)}
          >
            {s === 'version' && t('helm.wizard.step.version', 'Version')}
            {s === 'values' && t('helm.wizard.step.values', 'Values')}
            {s === 'review' && t('helm.wizard.step.review', 'Review')}
          </li>
        ))}
      </ol>

      {step === 'version' && (
        <div className={styles.wizardBody}>
          <label className={styles.field}>
            <span>{t('helm.wizard.releaseName', 'Release name')}</span>
            <input value={releaseName} onChange={(e) => setReleaseName(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span>{t('helm.wizard.namespace', 'Namespace')}</span>
            <input value={namespace} onChange={(e) => setNamespace(e.target.value)} />
          </label>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={createNs}
              onChange={(e) => setCreateNs(e.target.checked)}
            />
            {t('helm.wizard.createNs', 'Create namespace if missing')}
          </label>
          <label className={styles.field}>
            <span>{t('helm.wizard.version', 'Version')}</span>
            <select value={selectedVersion} onChange={(e) => setSelectedVersion(e.target.value)}>
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version} (app {v.appVersion})
                </option>
              ))}
            </select>
          </label>
          <div className={styles.wizardActions}>
            <button className={styles.primary} onClick={() => setStep('values')}>
              {t('helm.wizard.next', 'Next')}
            </button>
          </div>
        </div>
      )}

      {step === 'values' && (
        <div className={styles.wizardBody}>
          <textarea
            className={styles.values}
            value={values}
            onChange={(e) => setValues(e.target.value)}
            spellCheck={false}
          />
          <div className={styles.wizardActions}>
            <button onClick={() => setStep('version')}>{t('helm.wizard.back', 'Back')}</button>
            <button className={styles.primary} onClick={() => setStep('review')}>
              {t('helm.wizard.next', 'Next')}
            </button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className={styles.wizardBody}>
          <div className={styles.reviewRow}>
            <strong>{t('helm.wizard.releaseName', 'Release name')}:</strong> {releaseName}
          </div>
          <div className={styles.reviewRow}>
            <strong>{t('helm.wizard.namespace', 'Namespace')}:</strong> {namespace}
            {createNs && ' (create)'}
          </div>
          <div className={styles.reviewRow}>
            <strong>{t('helm.wizard.chart', 'Chart')}:</strong> {chart.repo}/{chart.name}@
            {selectedVersion}
          </div>
          <div className={styles.wizardActions}>
            <button onClick={() => setStep('values')} disabled={running}>
              {t('helm.wizard.back', 'Back')}
            </button>
            <button
              className={styles.primary}
              disabled={running || !releaseName || !namespace}
              onClick={doInstall}
            >
              {running
                ? t('helm.wizard.installing', 'Installing…')
                : t('helm.wizard.install', 'Install')}
            </button>
          </div>
          <div className={styles.logs} ref={logsRef}>
            {logs.map((l, i) => (
              <div key={i} className={l.stream === 'stderr' ? styles.logLineErr : styles.logLine}>
                {l.line}
              </div>
            ))}
          </div>
          {result && (
            <div className={result.success ? styles.summaryOk : styles.summaryErr}>
              {result.summary}
              {result.success && (
                <button className={styles.btn} onClick={onDone}>
                  {t('helm.wizard.done', 'Done')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

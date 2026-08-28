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
 *
 * Two sources, exactly one per instance: `chart` (a repo search result)
 * resolves its version list and default values via helm; `localChart`
 * (a library entry) is one package on disk — a single read-only version
 * row, values seeded from the detail payload, and the absolute path as
 * the install reference.
 */
import { useEffect, useRef, useState } from 'react';
import { getProvider } from '../../providers';
import { useAsyncEffect } from '../../hooks/useAsyncEffect';
import type {
  HelmChartSummary,
  HelmChartVersionEntry,
  HelmOpResult,
  LocalChartDetail,
} from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import { isValidHelmReleaseName, isValidNamespace, isSafeHelmValues } from '../../lib/security';
import { EditorCore } from '../editor/EditorCore';
import styles from './HelmMarket.module.css';

type Step = 'version' | 'values' | 'review';

export function HelmInstallWizard({
  chart,
  localChart,
  onDone,
}: {
  chart?: HelmChartSummary;
  localChart?: LocalChartDetail;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('version');
  const [versions, setVersions] = useState<HelmChartVersionEntry[]>([]);
  const [selectedVersion, setSelectedVersion] = useState(
    chart?.version ?? localChart?.entry.version ?? ''
  );
  const [releaseName, setReleaseName] = useState(
    (chart?.name ?? localChart?.entry.name ?? 'chart')
      .replace(/[^a-z0-9-]/gi, '-')
      .toLowerCase()
  );
  const [namespace, setNamespace] = useState('default');
  // A library chart ships its values.yaml with the detail payload, so it
  // seeds the editor directly; repo charts load theirs on the values step.
  const [values, setValues] = useState(localChart?.valuesYaml ?? '');
  const [createNs, setCreateNs] = useState(false);
  const [logs, setLogs] = useState<{ stream: string; line: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HelmOpResult | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  // Load versions for this chart on mount. A library entry skips this:
  // it is exactly one package, so the version step shows the entry as-is.
  useAsyncEffect(async (isMounted) => {
    if (localChart || !chart) return;
    try {
      const vs = await getProvider().helmChartVersions(chart.repo, chart.name);
      if (!isMounted()) return;
      setVersions(vs);
      if (vs.length > 0 && !vs.find((v) => v.version === selectedVersion)) {
        setSelectedVersion(vs[0].version);
      }
    } catch {
      if (!isMounted()) return;
      // Fall back to whatever the summary advertised.
      setVersions([
        {
          version: chart.version,
          appVersion: chart.appVersion,
          created: '',
          urls: [],
        },
      ]);
    }
  }, [chart?.repo, chart?.name]);

  // When the user advances to "values", prefill with the chart's defaults.
  // (A library chart's values were seeded in the initial state above; the
  // non-empty guard keeps them — and any user edits — untouched.)
  useEffect(() => {
    if (step !== 'values') return;
    if (values) return; // already loaded; preserve user edits
    if (!chart) return;
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
      // A library entry installs by absolute path; a repo chart by
      // repo/name. `--version` is meaningless for a local path, so it
      // goes over the wire empty.
      const chartArg = localChart
        ? localChart.entry.path
        : chart
          ? `${chart.repo}/${chart.name}`
          : '';
      const res = await getProvider().helmRunOp({
        op: 'install',
        args: {
          release: releaseName,
          chart: chartArg,
          version: localChart ? '' : selectedVersion,
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
        <h2>{chart?.name ?? localChart?.entry.name ?? ''}</h2>
        <p className={styles.chartDesc}>
          {chart?.description ?? localChart?.entry.description ?? ''}
        </p>
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
            {localChart ? (
              // One package on disk — no list to choose from.
              <div className={styles.reviewRow}>
                {localChart.entry.version} (app {localChart.entry.appVersion})
              </div>
            ) : (
              <select value={selectedVersion} onChange={(e) => setSelectedVersion(e.target.value)}>
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version} (app {v.appVersion})
                  </option>
                ))}
              </select>
            )}
          </label>
          <div className={styles.wizardActions}>
            <button className={styles.primary} onClick={() => setStep('values')}>
              {t('helm.wizard.next', 'Next')}
            </button>
          </div>
        </div>
      )}

      {step === 'values' && (
        <div className={styles.wizardBody} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <EditorCore
              value={values}
              language="yaml"
              editable
              onChange={setValues}
            />
          </div>
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
            <strong>{t('helm.wizard.chart', 'Chart')}:</strong>{' '}
            {localChart
              ? localChart.entry.path
              : `${chart?.repo ?? ''}/${chart?.name ?? ''}@${selectedVersion}`}
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

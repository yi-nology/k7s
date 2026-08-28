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
 * Three sources, exactly one per instance: `chart` (a repo search result)
 * resolves its version list and default values via helm; `localChart`
 * (a library entry) is one package on disk — a single read-only version
 * row, values seeded from the detail payload, and the absolute path as
 * the install reference; `localUpgrade` points at an existing release to
 * upgrade with the library package — release/namespace arrive prefilled
 * read-only, the values step prefills the release's current user-supplied
 * values (falling back to the new package's values.yaml on fetch error),
 * and the review step can diff the offline render against the
 * live release's current manifest.
 */
import { useEffect, useRef, useState } from 'react';
import { stringify } from 'yaml';
import { formatError, getProvider } from '../../providers';
import { useAsyncEffect } from '../../hooks/useAsyncEffect';
import type {
  HelmChartSummary,
  HelmChartVersionEntry,
  HelmOpResult,
  HelmProfile,
  LocalChartDetail,
} from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import { isValidHelmReleaseName, isValidNamespace, isSafeHelmValues } from '../../lib/security';
import { diffLines, type DiffLine } from '../../lib/diff';
import { EditorCore } from '../editor/EditorCore';
import { ConfirmDialog } from '../common/ConfirmDialog';
import styles from './HelmMarket.module.css';
import diffStyles from './HelmDiff.module.css';

type Step = 'version' | 'values' | 'review';

export function HelmInstallWizard({
  chart,
  localChart,
  localUpgrade,
  onDone,
}: {
  chart?: HelmChartSummary;
  localChart?: LocalChartDetail;
  /** Upgrade an existing release with this library package. */
  localUpgrade?: { detail: LocalChartDetail; release: string; namespace: string };
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const upgrade = !!localUpgrade;
  // The library-chart half of the source union: an install handoff passes
  // `localChart`, an upgrade handoff passes `localUpgrade.detail`. Both are
  // local paths, so both share the read-only version row and the path ref.
  const localDetail = localChart ?? localUpgrade?.detail;
  const [step, setStep] = useState<Step>('version');
  const [versions, setVersions] = useState<HelmChartVersionEntry[]>([]);
  const [selectedVersion, setSelectedVersion] = useState(
    chart?.version ?? localDetail?.entry.version ?? ''
  );
  const [releaseName, setReleaseName] = useState(
    (localUpgrade?.release ?? chart?.name ?? localDetail?.entry.name ?? 'chart')
      .replace(/[^a-z0-9-]/gi, '-')
      .toLowerCase()
  );
  const [namespace, setNamespace] = useState(localUpgrade?.namespace ?? 'default');
  // A library chart ships its values.yaml with the detail payload, so it
  // seeds the editor directly; repo charts load theirs on the values step.
  // Upgrade mode starts empty instead — the values step there prefills
  // the release's current user-supplied values, not the new package's.
  const [values, setValues] = useState(localChart?.valuesYaml ?? '');
  const [createNs, setCreateNs] = useState(false);
  const [atomic, setAtomic] = useState(false);
  // Text until submit/save — '' means "helm default" (no --timeout).
  const [timeoutStr, setTimeoutStr] = useState('');
  const [logs, setLogs] = useState<{ stream: string; line: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HelmOpResult | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  // Profiles (values step): the list is filtered to this chart's ref, so a
  // profile saved for chart A never leaks into chart B's wizard.
  const [profiles, setProfiles] = useState<HelmProfile[]>([]);
  const [profileSel, setProfileSel] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profileNote, setProfileNote] = useState('');
  const [profileErr, setProfileErr] = useState('');
  // Delete flows through the shared ConfirmDialog (native confirm() is a
  // silent no-op in some Tauri webviews).
  const [profileDeleteOpen, setProfileDeleteOpen] = useState(false);

  // Review-step diff (upgrade mode): null = not fetched yet.
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffErr, setDiffErr] = useState('');
  // Monotonic id per loadDiff call — only the latest response may populate
  // diff state. Leaving review bumps it too (see goto), so a slow fetch
  // that resolves after Back can never resurrect a stale diff.
  const diffReqRef = useRef(0);

  // Chart reference for the op, render preview, and profile matching:
  // a library path, or `repo/name` for a repo chart.
  const chartRef = localDetail
    ? localDetail.entry.path
    : chart
      ? `${chart.repo}/${chart.name}`
      : '';
  // Whole seconds >= 1, or null (= helm default). 0 and fractional input
  // fall back to the default, matching the backend's `timeout_arg` clamp.
  const timeoutSecs = (() => {
    const n = Number(timeoutStr.trim());
    return Number.isInteger(n) && n >= 1 ? n : null;
  })();

  // Load versions for this chart on mount. A library entry skips this:
  // it is exactly one package, so the version step shows the entry as-is.
  useAsyncEffect(async (isMounted) => {
    if (localDetail || !chart) return;
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
    // `helm show values <chart>` only resolves repo/name — the summary's
    // bare name would fail backend-side.
    getProvider()
      .helmRenderDefaultValues(`${chart.repo}/${chart.name}`, selectedVersion)
      .then(setValues)
      .catch((e: unknown) => setValues(`# error loading defaults: ${String(e)}\n`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedVersion]);

  // Upgrade mode: the values step prefills the release's current
  // user-supplied values (spec §4.6), not the new package's defaults —
  // reuseValues stays false, so this prefill is what carries the release's
  // prior customizations into the upgrade instead of reverting them on the
  // first run. Entering with values already loaded (user edits included)
  // is a no-op; a failed fetch falls back to the new package's values.yaml.
  useAsyncEffect(async (isMounted) => {
    if (step !== 'values' || !localUpgrade || values) return;
    try {
      const hist = await getProvider().helmReleaseHistory(
        localUpgrade.release,
        localUpgrade.namespace
      );
      const rev = hist[0]?.revision;
      if (rev === undefined) throw new Error('release has no revisions');
      const raw = await getProvider().helmValuesRevision(
        localUpgrade.namespace,
        localUpgrade.release,
        rev
      );
      if (!isMounted()) return;
      // The backend hands back the release config as a JSON value; the
      // editor and the op args both want values.yaml text.
      setValues(typeof raw === 'string' ? raw : stringify(raw ?? {}));
    } catch {
      if (isMounted()) setValues(localUpgrade.detail.valuesYaml);
    }
  }, [step, selectedVersion]);

  // Load the saved profiles for this chart when the values step opens. A
  // provider without profile support (or a failed fetch) just empties the
  // select — profiles are an accelerator, never a gate.
  useAsyncEffect(async (isMounted) => {
    if (step !== 'values' || !chartRef) return;
    try {
      const all = await getProvider().helmProfileList();
      if (!isMounted()) return;
      setProfiles(all.filter((p) => p.chartRef === chartRef));
    } catch {
      if (!isMounted()) return;
      setProfiles([]);
    }
  }, [step, chartRef]);

  // Live log tail: append and auto-scroll.
  useEffect(() => {
    if (logs.length === 0) return;
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  /** All step navigation funnels through here so a fetched diff never
   * outlives the review step — a stale diff (values edited after fetching)
   * is worse than none, and the button re-fetches on the next visit. The
   * request-id bump also invalidates any in-flight loadDiff response. */
  const goto = (s: Step) => {
    if (s !== 'review') {
      diffReqRef.current += 1;
      setDiff(null);
      setDiffErr('');
      setDiffLoading(false);
    }
    setStep(s);
  };

  /** Copy a saved profile's values + flags into the form. */
  const applyProfile = (p: HelmProfile) => {
    setValues(p.values);
    setAtomic(p.atomic);
    setCreateNs(p.createNamespace);
    setTimeoutStr(p.timeoutSecs != null ? String(p.timeoutSecs) : '');
    if (!localDetail && p.version) setSelectedVersion(p.version);
  };

  const onPickProfile = (name: string) => {
    setProfileSel(name);
    setProfileNote('');
    setProfileErr('');
    const p = profiles.find((x) => x.name === name);
    if (p) applyProfile(p);
  };

  const saveProfile = async () => {
    const name = profileName.trim();
    if (!name || !chartRef) return;
    setProfileNote('');
    setProfileErr('');
    try {
      const all = await getProvider().helmProfileSave({
        name,
        chartRef,
        version: localDetail ? '' : selectedVersion,
        namespace,
        values,
        set: null,
        atomic,
        force: false,
        createNamespace: createNs,
        timeoutSecs,
        createdAt: '', // stamped by the backend for new profiles
      });
      setProfiles(all.filter((p) => p.chartRef === chartRef));
      setProfileSel(name);
      setProfileNote(t('helm.profiles.saved', 'Profile saved'));
    } catch (e) {
      setProfileErr(formatError(e));
    }
  };

  /** Delete the selected profile, then refresh the list from the backend's
   * return value (the same refresh path as save). */
  const deleteProfile = async () => {
    if (!profileSel) return;
    setProfileNote('');
    setProfileErr('');
    try {
      const all = await getProvider().helmProfileDelete(profileSel);
      setProfiles(all.filter((p) => p.chartRef === chartRef));
      setProfileSel('');
      setProfileNote(t('helm.profiles.deleted', 'Profile deleted'));
    } catch (e) {
      setProfileErr(formatError(e));
    }
  };

  /** Review-step diff (upgrade mode): current live manifest vs the offline
   * render of the edited values. Both sides fail independently → any error
   * surfaces in the section, never blocks the upgrade itself. */
  const loadDiff = async () => {
    // Stale-response guard: a later click (or leaving review) bumps the id,
    // so a late resolve from this fetch is dropped instead of overwriting
    // fresher state.
    const req = ++diffReqRef.current;
    setDiffLoading(true);
    setDiffErr('');
    try {
      const hist = await getProvider().helmReleaseHistory(releaseName, namespace);
      const rev = hist[0]?.revision;
      const current =
        rev === undefined
          ? ''
          : await getProvider().helmManifestRevision(namespace, releaseName, rev);
      const rendered = await getProvider().helmRenderPreview(chartRef, '', values);
      if (req !== diffReqRef.current) return;
      setDiff(diffLines(current, rendered));
    } catch (e) {
      if (req !== diffReqRef.current) return;
      setDiffErr(formatError(e));
    } finally {
      if (req === diffReqRef.current) setDiffLoading(false);
    }
  };

  const doSubmit = async () => {
    // Validate inputs before proceeding
    const resultOp = upgrade ? 'upgrade' : 'install';
    if (!isValidHelmReleaseName(releaseName)) {
      setResult({
        op: resultOp,
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
        op: resultOp,
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
        op: resultOp,
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
      // goes over the wire empty. Install keeps its args minimal: the
      // extra flags ride along only when the user actually set them.
      const res = upgrade
        ? await getProvider().helmRunOp({
            op: 'upgrade',
            args: {
              release: releaseName,
              chart: chartRef,
              version: localDetail ? '' : selectedVersion,
              namespace,
              values,
              dryRun: false,
              reuseValues: false,
              rollbackOnFailure: false,
              createNamespace: createNs,
              atomic,
              force: false,
              timeoutSecs,
              set: null,
            },
          })
        : await getProvider().helmRunOp({
            op: 'install',
            args: {
              release: releaseName,
              chart: chartRef,
              version: localDetail ? '' : selectedVersion,
              namespace,
              values,
              dryRun: false,
              createNamespace: createNs,
              ...(atomic ? { atomic: true } : {}),
              ...(timeoutSecs !== null ? { timeoutSecs } : {}),
            },
          });
      setResult(res);
    } catch (e) {
      setResult({
        op: resultOp,
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
        <h2>{chart?.name ?? localDetail?.entry.name ?? ''}</h2>
        <p className={styles.chartDesc}>
          {chart?.description ?? localDetail?.entry.description ?? ''}
        </p>
      </header>

      <ol className={styles.steps}>
        {(['version', 'values', 'review'] as const).map((s) => (
          <li
            key={s}
            className={s === step ? styles.stepActive : styles.step}
            onClick={() => goto(s)}
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
            {/* Upgrade mode: the target release is chosen in the library
                pane, so the prefilled name is read-only here. */}
            <input
              value={releaseName}
              readOnly={upgrade}
              onChange={(e) => setReleaseName(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>{t('helm.wizard.namespace', 'Namespace')}</span>
            <input
              value={namespace}
              readOnly={upgrade}
              onChange={(e) => setNamespace(e.target.value)}
            />
          </label>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={createNs}
              onChange={(e) => setCreateNs(e.target.checked)}
            />
            {t('helm.wizard.createNs', 'Create namespace if missing')}
          </label>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={atomic}
              onChange={(e) => setAtomic(e.target.checked)}
            />
            {t('helm.wizard.atomic', 'Roll back automatically on failure (--atomic)')}
          </label>
          <label className={styles.field}>
            <span>{t('helm.wizard.timeout', 'Timeout (seconds; empty = helm default)')}</span>
            {/* Whole seconds only: decimals / non-digits are refused
                mid-typing (the input keeps its last valid text); 0 maps to
                helm's default, matching the backend's clamp. */}
            <input
              type="text"
              inputMode="numeric"
              value={timeoutStr}
              placeholder="300"
              onChange={(e) => {
                const v = e.target.value;
                if (v === '' || /^\d+$/.test(v)) setTimeoutStr(v);
              }}
            />
          </label>
          <label className={styles.field}>
            <span>{t('helm.wizard.version', 'Version')}</span>
            {localDetail ? (
              // One package on disk — no list to choose from.
              <div className={styles.reviewRow}>
                {localDetail.entry.version} (app {localDetail.entry.appVersion})
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
            <button className={styles.primary} onClick={() => goto('values')}>
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
          <div className={styles.wizardActions} style={{ justifyContent: 'flex-start' }}>
            <label className={styles.field}>
              <span>{t('helm.profiles.load', 'Load profile')}</span>
              <select value={profileSel} onChange={(e) => onPickProfile(e.target.value)}>
                <option value="">{t('helm.profiles.none', 'None')}</option>
                {profiles.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={styles.btn}
              disabled={!profileSel}
              style={{ alignSelf: 'flex-end' }}
              onClick={() => setProfileDeleteOpen(true)}
            >
              {t('helm.profiles.delete', 'Delete')}
            </button>
            <div className={styles.field}>
              <input
                placeholder={t('helm.profiles.namePlaceholder', 'Profile name')}
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
            </div>
            <button
              className={styles.btn}
              disabled={!profileName.trim()}
              onClick={() => void saveProfile()}
            >
              {t('helm.profiles.save', 'Save as profile')}
            </button>
            {profileNote && <span className={styles.reviewRow}>{profileNote}</span>}
            {profileErr && <span className={styles.error}>{profileErr}</span>}
          </div>
          <div className={styles.wizardActions}>
            <button onClick={() => goto('version')}>{t('helm.wizard.back', 'Back')}</button>
            <button className={styles.primary} onClick={() => goto('review')}>
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
            <strong>{t('helm.wizard.chart', 'Chart')}:</strong> {chartRef || ''}
            {!localDetail && `@${selectedVersion}`}
          </div>
          <div className={styles.reviewRow}>
            <strong>
              {t('helm.wizard.atomic', 'Roll back automatically on failure (--atomic)')}:
            </strong>{' '}
            {atomic ? t('helm.wizard.flagOn', 'on') : t('helm.wizard.flagOff', 'off')}
            {timeoutSecs !== null && ` · timeout ${timeoutSecs}s`}
          </div>
          {upgrade && (
            <section>
              <div className={styles.reviewRow}>
                <strong>{t('helm.wizard.diffSection', 'Compare with current release')}</strong>
                <button
                  className={styles.btn}
                  disabled={diffLoading || running}
                  onClick={() => void loadDiff()}
                >
                  {t('helm.profiles.previewDiff', 'Preview diff vs current release')}
                </button>
              </div>
              {diffErr && <div className={styles.error}>{diffErr}</div>}
              {diffLoading && (
                <div className={styles.reviewRow}>
                  {t('helm.diff.loading', 'Fetching manifests...')}
                </div>
              )}
              {diff !== null && (
                <>
                  {diff.length === 0 ? (
                    <div className={styles.reviewRow}>
                      {t('helm.diff.identical', 'Manifests are identical')}
                    </div>
                  ) : (
                    <div className={diffStyles.diffView}>
                      {diff.map((line, i) => (
                        <DiffLineRow key={i} line={line} />
                      ))}
                    </div>
                  )}
                  <div className={styles.reviewRow}>
                    {t(
                      'helm.wizard.diffCaveat',
                      'Rendered offline via helm template; metadata differences vs the upgrade dry-run manifest are expected.'
                    )}
                  </div>
                </>
              )}
            </section>
          )}
          <div className={styles.wizardActions}>
            <button onClick={() => goto('values')} disabled={running}>
              {t('helm.wizard.back', 'Back')}
            </button>
            <button
              className={styles.primary}
              disabled={running || !releaseName || !namespace}
              onClick={doSubmit}
            >
              {running
                ? upgrade
                  ? t('helm.wizard.upgrading', 'Upgrading…')
                  : t('helm.wizard.installing', 'Installing…')
                : upgrade
                  ? t('helm.wizard.upgrade', 'Upgrade')
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

      <ConfirmDialog
        open={profileDeleteOpen}
        onClose={() => setProfileDeleteOpen(false)}
        onConfirm={() => void deleteProfile()}
        title={t('helm.profiles.manage', 'Manage profiles')}
        body={t('helm.profiles.confirmDelete', profileSel)}
        danger
      />
    </div>
  );
}

/** A single diff line with line numbers and +/- prefix — mirrors the row
 * layout in HelmDiff.tsx / ChartVersionDiff.tsx so all diff surfaces read
 * identically. */
function DiffLineRow({ line }: { line: DiffLine }) {
  const cls =
    line.op === 'add'
      ? diffStyles.lineAdd
      : line.op === 'del'
        ? diffStyles.lineDel
        : diffStyles.lineSame;
  const prefix = line.op === 'add' ? '+' : line.op === 'del' ? '-' : ' ';
  return (
    <div className={`${diffStyles.diffLine} ${cls}`}>
      <span className={diffStyles.lineNumLeft}>{line.before ?? ''}</span>
      <span className={diffStyles.lineNumRight}>{line.after ?? ''}</span>
      <span className={diffStyles.linePrefix}>{prefix}</span>
      <span className={diffStyles.lineText}>{line.text}</span>
    </div>
  );
}

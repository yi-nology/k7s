/**
 * LocalCharts — the offline half of the Helm tab: the on-disk chart
 * library under <data_dir>/charts. Upload .tgz packages (one code path
 * for web + desktop: a long-lived hidden <input type=file> → base64),
 * browse entries, inspect files/values, and hand off to the install
 * wizard with the chart's absolute path — helm installs local paths
 * natively, so no repo round-trip is needed.
 */
import { useRef, useState } from 'react';
import { formatError, getProvider } from '../../providers';
import { useTranslation } from '../../hooks/useI18n';
import { useProviderQuery } from '../../hooks/useProviderQuery';
import { isValidHelmReleaseName, isValidNamespace } from '../../lib/security';
import type { LocalChartDetail, LocalChartEntry, LocalChartFile } from '../../providers/types';
import { EditorCore } from '../editor/EditorCore';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ChartRenderPreview } from './ChartRenderPreview';
import { ChartVersionDiff } from './ChartVersionDiff';
import { HelmInstallWizard } from './HelmInstallWizard';
import styles from './HelmMarket.module.css';

/** Bytes per String.fromCharCode call. Spreading a whole chart (up to 90MB)
 * in one call overflows the call stack somewhere past ~120k args; 32KB
 * chunks keep every frame small for any realistic package. */
const B64_CHUNK_BYTES = 0x8000;

/** ArrayBuffer → base64, chunked to keep the spread argument list short. */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK_BYTES) {
    out += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK_BYTES));
  }
  return btoa(out);
}

/** 1024 → "1.0 KB"-style sizing for list rows and file rows. */
function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** A values.yaml anywhere in the flat file list — the detail payload
 * already carries its rendered content, so those rows open without a fetch. */
function isValuesFile(path: string): boolean {
  return path === 'values.yaml' || path.endsWith('/values.yaml');
}

export function LocalCharts() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<LocalChartDetail | null>(null);
  const [installing, setInstalling] = useState(false);
  // Upgrade handoff: the small release/namespace form, then the wizard in
  // upgrade mode once a valid release name is entered.
  const [upgradeFormOpen, setUpgradeFormOpen] = useState(false);
  const [upRelease, setUpRelease] = useState('');
  const [upNamespace, setUpNamespace] = useState('default');
  const [upgradeCfg, setUpgradeCfg] = useState<{ release: string; namespace: string } | null>(null);
  // Two-version diff swaps the whole detail pane (same pattern as the
  // install wizard handoff) — it compares any two library charts, so it
  // opens independently of the current selection.
  const [diffOpen, setDiffOpen] = useState(false);
  const [fileView, setFileView] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  // Delete goes through the shared ConfirmDialog (same as repo removal in
  // HelmRepos) — native confirm() is a silent no-op in some Tauri webviews,
  // which would leave Delete dead on desktop.
  const [pendingRemove, setPendingRemove] = useState<LocalChartEntry | null>(null);
  // Long-lived hidden input: the click→pick chain stays a single
  // user-gesture stack frame (the importKubeconfigViaInput lesson — an
  // input created per click loses the gesture in Safari).
  const inputRef = useRef<HTMLInputElement>(null);
  // Monotonic id per detail/file fetch — only the latest response may
  // populate the pane. Opening another entry (or file) bumps the id, so a
  // slow fetch that resolves after the switch is dropped instead of
  // mounting stale content (same pattern as the wizard's diffReqRef).
  const viewReqRef = useRef(0);

  const listQuery = useProviderQuery<LocalChartEntry[]>({
    query: () => getProvider().localChartsList(),
    deps: [],
    key: 'helm:local-charts',
  });
  const charts = listQuery.data ?? [];
  const banner = error || listQuery.error || '';

  const onPickFile = async () => {
    const file = inputRef.current?.files?.[0];
    // Reset so picking the same file twice still fires `change`.
    const reset = () => {
      if (inputRef.current) inputRef.current.value = '';
    };
    if (!file) {
      reset();
      return;
    }
    if (!file.name.endsWith('.tgz') && !file.name.endsWith('.tar.gz')) {
      setError(t('helm.local.detail.invalidFile', 'Only .tgz / .tar.gz files are accepted'));
      reset();
      return;
    }
    setUploading(true);
    setError('');
    try {
      const b64 = toBase64(await file.arrayBuffer());
      await getProvider().localChartUpload(file.name, b64);
      listQuery.reload();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setUploading(false);
      reset();
    }
  };

  const openDetail = async (entry: LocalChartEntry) => {
    const req = ++viewReqRef.current;
    setInstalling(false);
    setUpgradeFormOpen(false);
    setUpgradeCfg(null);
    setDiffOpen(false);
    setFileView(null);
    try {
      const detail = await getProvider().localChartDetail(entry.id);
      if (req !== viewReqRef.current) return; // a newer fetch superseded this one
      setSelected(detail);
      setError('');
    } catch (e) {
      if (req !== viewReqRef.current) return;
      setError(formatError(e));
    }
  };

  const openUpgrade = () => {
    // Client-side gate: the wizard also validates, but release/namespace
    // arrive read-only there, so anything helm would reject must not even
    // enter it. The gate covers empty (the submit button is disabled, this
    // is the belt to its suspenders).
    if (!isValidHelmReleaseName(upRelease.trim())) return;
    if (!isValidNamespace(upNamespace.trim())) return;
    setUpgradeCfg({ release: upRelease.trim(), namespace: upNamespace.trim() });
  };

  const openFile = async (f: LocalChartFile) => {
    if (!selected || f.isDir) return;
    const req = ++viewReqRef.current;
    try {
      const content = isValuesFile(f.path)
        ? selected.valuesYaml
        : await getProvider().localChartFile(selected.entry.id, f.path);
      if (req !== viewReqRef.current) return; // a newer open superseded this one
      setFileView({ path: f.path, content });
      setError('');
    } catch (e) {
      if (req !== viewReqRef.current) return;
      setError(formatError(e));
    }
  };

  const remove = async (entry: LocalChartEntry) => {
    try {
      await getProvider().localChartRemove(entry.id);
      if (selected?.entry.id === entry.id) {
        setSelected(null);
        setInstalling(false);
        setUpgradeFormOpen(false);
        setUpgradeCfg(null);
        setDiffOpen(false);
        setFileView(null);
      }
      listQuery.reload();
    } catch (e) {
      setError(formatError(e));
    }
  };

  return (
    <>
    <ConfirmDialog
      open={!!pendingRemove}
      onClose={() => setPendingRemove(null)}
      onConfirm={async () => {
        if (!pendingRemove) return;
        await remove(pendingRemove);
        setPendingRemove(null);
      }}
      title={t('helm.local.deleteTitle', 'Delete chart')}
      body={t('helm.local.confirmDelete', pendingRemove?.id ?? '')}
      danger
    />
    <div className={styles.split}>
      <div className={styles.list}>
        <div className={styles.localToolbar}>
          <button
            className={styles.primary}
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading
              ? t('helm.local.uploading', 'Uploading…')
              : t('helm.local.upload', 'Upload .tgz')}
          </button>
          <input ref={inputRef} type="file" accept=".tgz,.tar.gz" hidden onChange={onPickFile} />
          <button
            className={styles.btn}
            disabled={charts.length < 2}
            title={t('helm.local.diff.title', 'Compare versions')}
            onClick={() => setDiffOpen(true)}
          >
            {t('helm.local.diff.title', 'Compare versions')}
          </button>
        </div>
        {charts.length === 0 ? (
          <div className={styles.empty}>
            {t('helm.local.empty', 'No local charts — upload a .tgz to get started')}
          </div>
        ) : (
          <ul className={styles.charts}>
            {charts.map((e) => (
              <li
                key={e.id}
                className={selected?.entry.id === e.id ? styles.chartActive : styles.chart}
                onClick={() => void openDetail(e)}
              >
                <div className={styles.chartName}>{e.name}</div>
                <div className={styles.chartMeta}>
                  <span className={styles.chartRepo}>{t(`helm.local.kind.${e.kind}`, e.kind)}</span>
                  <span className={styles.chartVersion}>v{e.version}</span>
                  <span className={styles.chartVersion}>{humanSize(e.sizeBytes)}</span>
                  <span className={styles.chartVersion}>
                    {new Date(e.modifiedAt).toLocaleDateString()}
                  </span>
                </div>
                {e.description && <div className={styles.chartDesc}>{e.description}</div>}
                <div className={styles.localRowActions}>
                  <button
                    className={styles.btnDanger}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setPendingRemove(e);
                    }}
                  >
                    {t('helm.local.delete', 'Delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.detail}>
        {banner && <div className={styles.error}>{banner}</div>}
        {diffOpen ? (
          <ChartVersionDiff charts={charts} onClose={() => setDiffOpen(false)} />
        ) : selected && upgradeCfg ? (
          <HelmInstallWizard
            localUpgrade={{
              detail: selected,
              release: upgradeCfg.release,
              namespace: upgradeCfg.namespace,
            }}
            onDone={() => setUpgradeCfg(null)}
          />
        ) : selected && installing ? (
          <HelmInstallWizard localChart={selected} onDone={() => setInstalling(false)} />
        ) : selected ? (
          <div className={styles.localDetail}>
            <header className={styles.wizardHeader}>
              <h2>{selected.entry.name}</h2>
              <div className={styles.chartMeta}>
                <span className={styles.chartRepo}>
                  {t(`helm.local.kind.${selected.entry.kind}`, selected.entry.kind)}
                </span>
                <span className={styles.chartVersion}>
                  v{selected.entry.version} (app {selected.entry.appVersion})
                </span>
                <span className={styles.chartVersion}>{humanSize(selected.entry.sizeBytes)}</span>
              </div>
              {selected.entry.description && (
                <p className={styles.chartDesc}>{selected.entry.description}</p>
              )}
              <p className={styles.localPath} title={selected.entry.path}>
                {selected.entry.path}
              </p>
              <div className={styles.wizardActions} style={{ justifyContent: 'flex-start' }}>
                <button className={styles.primary} onClick={() => setInstalling(true)}>
                  {t('helm.local.detail.install', 'Install this chart')}
                </button>
                <button
                  className={styles.btn}
                  onClick={() => setUpgradeFormOpen((v) => !v)}
                >
                  {t('helm.profiles.upgradeTitle', 'Upgrade existing release')}
                </button>
              </div>
              {upgradeFormOpen && (
                <div className={styles.wizardActions} style={{ justifyContent: 'flex-start' }}>
                  <label className={styles.field}>
                    <span>{t('helm.profiles.upgradeRelease', 'Release name')}</span>
                    <input
                      value={upRelease}
                      placeholder="my-release"
                      onChange={(e) => setUpRelease(e.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>{t('helm.profiles.upgradeNamespace', 'Namespace')}</span>
                    <input
                      value={upNamespace}
                      onChange={(e) => setUpNamespace(e.target.value)}
                    />
                  </label>
                  <button
                    className={styles.primary}
                    disabled={
                      !isValidHelmReleaseName(upRelease.trim()) ||
                      !isValidNamespace(upNamespace.trim())
                    }
                    onClick={openUpgrade}
                  >
                    {t('helm.wizard.upgrade', 'Upgrade')}
                  </button>
                </div>
              )}
            </header>
            {/* Keyed by entry id: the values editor seeds from this chart's
                defaults, so a different chart must remount the component. */}
            <section>
              <h3>{t('helm.local.render.title', 'Render preview')}</h3>
              <ChartRenderPreview key={selected.entry.id} detail={selected} />
            </section>
            <section>
              <h3>{t('helm.local.detail.files', 'Files')}</h3>
              <ul className={styles.localFiles}>
                {selected.files.map((f) => (
                  <li
                    key={f.path}
                    className={
                      fileView?.path === f.path ? styles.localFileActive : styles.localFile
                    }
                    onClick={() => void openFile(f)}
                  >
                    <span className={styles.localFilePath}>{f.path}</span>
                    <span className={styles.chartVersion}>{humanSize(f.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
            </section>
            {fileView && (
              <section className={styles.localFileView}>
                <h3>
                  {isValuesFile(fileView.path)
                    ? t('helm.local.detail.values', 'Values')
                    : fileView.path}
                </h3>
                <EditorCore value={fileView.content} language="yaml" editable={false} hideToolbar />
              </section>
            )}
            {selected.readme && (
              <section>
                <h3>{t('helm.local.detail.readme', 'README')}</h3>
                {/* P0: raw markdown as preformatted text — no renderer. */}
                <pre className={styles.localReadme}>{selected.readme}</pre>
              </section>
            )}
          </div>
        ) : (
          <div className={styles.empty}>
            {t('helm.detail.pickChart', 'Pick a chart on the left to install')}
          </div>
        )}
      </div>
    </div>
    </>
  );
}

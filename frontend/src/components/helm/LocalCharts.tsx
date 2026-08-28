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
import type { LocalChartDetail, LocalChartEntry, LocalChartFile } from '../../providers/types';
import { EditorCore } from '../editor/EditorCore';
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
  const [fileView, setFileView] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  // Long-lived hidden input: the click→pick chain stays a single
  // user-gesture stack frame (the importKubeconfigViaInput lesson — an
  // input created per click loses the gesture in Safari).
  const inputRef = useRef<HTMLInputElement>(null);

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
      setError(t('helm.local.detail.invalidFile', 'Only .tgz files are accepted'));
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
    setInstalling(false);
    setFileView(null);
    try {
      const detail = await getProvider().localChartDetail(entry.id);
      setSelected(detail);
      setError('');
    } catch (e) {
      setError(formatError(e));
    }
  };

  const openFile = async (f: LocalChartFile) => {
    if (!selected || f.isDir) return;
    try {
      const content = isValuesFile(f.path)
        ? selected.valuesYaml
        : await getProvider().localChartFile(selected.entry.id, f.path);
      setFileView({ path: f.path, content });
      setError('');
    } catch (e) {
      setError(formatError(e));
    }
  };

  const remove = async (entry: LocalChartEntry) => {
    if (!window.confirm(t('helm.local.confirmDelete', entry.id))) return;
    try {
      await getProvider().localChartRemove(entry.id);
      if (selected?.entry.id === entry.id) {
        setSelected(null);
        setInstalling(false);
        setFileView(null);
      }
      listQuery.reload();
    } catch (e) {
      setError(formatError(e));
    }
  };

  return (
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
                      void remove(e);
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
        {selected && installing ? (
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
              <button className={styles.primary} onClick={() => setInstalling(true)}>
                {t('helm.local.detail.install', 'Install this chart')}
              </button>
            </header>
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
  );
}

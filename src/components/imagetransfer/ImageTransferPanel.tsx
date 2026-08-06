/**
 * ImageTransferPanel — get images into an air-gapped (intranet, no public
 * internet) cluster. Two complementary paths, picked by a top tab bar:
 *
 *   • **To Node** — load a local `.tar` directly into a node's container runtime
 *     via a temporary privileged pod. For clusters with no internal registry.
 *   • **To Registry** — copy an image into a configured private registry via
 *     skopeo. For clusters that DO have an internal registry (Harbor/Nexus);
 *     all nodes then pull from it.
 *
 * The two paths exist because real air-gapped clusters fall into both camps.
 * See `docs/superpowers/specs/2026-08-06-image-transfer-design.md` §1 for why
 * they're complementary, not redundant.
 *
 * Desktop (Tauri) only — the web shell has no local-disk access. On web the
 * panel shows a notice instead of the form.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { getProvider, IS_TAURI } from '../../providers';
import type {
  ArchiveInfo,
  ExportFromNodeResult,
  ExportFromRegistryResult,
  ImageRegistry,
  ImageSyncResult,
  ImportImageResult,
  Row,
  SkopeoAvailability,
} from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import { rowsFor, useStore } from '../../store';
import styles from './ImageTransferPanel.module.css';

type TopTab = 'import' | 'export';

export function ImageTransferPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [topTab, setTopTab] = useState<TopTab>('import');

  // Web shell: no local-disk access. Show a notice instead of the form.
  if (!IS_TAURI) {
    return (
      <div className={styles.panel}>
        <Header onClose={onClose} title={t('imageTransfer.title', 'Image Transfer')} t={t} />
        <div className={styles.notice}>
          {t('imageTransfer.desktopOnly', 'Image transfer is only available in the desktop app.')}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <Header onClose={onClose} title={t('imageTransfer.title', 'Image Transfer')} t={t} />

      <div className={styles.tabBar} role="tablist">
        <button type="button" role="tab" aria-selected={topTab === 'import'} className={styles.tabBtn} data-active={topTab === 'import'} onClick={() => setTopTab('import')}>
          {t('imageTransfer.tabImport', 'Import')}
        </button>
        <button type="button" role="tab" aria-selected={topTab === 'export'} className={styles.tabBtn} data-active={topTab === 'export'} onClick={() => setTopTab('export')}>
          {t('imageTransfer.tabExport', 'Export')}
        </button>
      </div>

      {topTab === 'import' ? <ImportSection onClose={onClose} /> : <ExportSection onClose={onClose} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImportSection — wraps ToNode + ToRegistry under the Import top tab.
// ---------------------------------------------------------------------------

function ImportSection({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'to-node' | 'to-registry'>('to-node');
  return (
    <>
      <div className={styles.tabBar} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'to-node'} className={styles.tabBtn} data-active={tab === 'to-node'} onClick={() => setTab('to-node')}>
          {t('imageTransfer.tabToNode', 'To Node')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'to-registry'} className={styles.tabBtn} data-active={tab === 'to-registry'} onClick={() => setTab('to-registry')}>
          {t('imageTransfer.tabToRegistry', 'To Registry')}
        </button>
      </div>
      {tab === 'to-node' ? <ToNodeSection onClose={onClose} /> : <ToRegistrySection onClose={onClose} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// To Node — load local .tar files into a node's container runtime (batch).
// ---------------------------------------------------------------------------

type FileStatus = 'pending' | 'loading' | 'done' | 'error';

function ToNodeSection({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const nodeRows = useStore((s) => rowsFor(s.rows, 'nodes'));
  const nodes = useMemo(() => nodeRows.map(nodeOption).filter((n) => n.name), [nodeRows]);

  const [node, setNode] = useState('');
  const [files, setFiles] = useState<{ path: string; status: FileStatus; result?: ImportImageResult }[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const canImport = !busy && node !== '' && files.length > 0 && files.some((f) => f.status === 'pending');

  const pickFiles = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        title: t('imageTransfer.chooseFile', 'Select image archives'),
        multiple: true,
        filters: [{ name: 'Image archive', extensions: ['tar'] }],
      });
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        setFiles((prev) => {
          const existing = new Set(prev.map((f) => f.path));
          const newFiles = paths.filter((p) => !existing.has(p)).map((p) => ({ path: p, status: 'pending' as FileStatus }));
          return [...prev, ...newFiles];
        });
      }
    } catch {
      // user cancelled
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files)
      .filter((f) => f.name.endsWith('.tar'))
      .map((f) => (f as any).path as string)
      .filter(Boolean);
    if (droppedFiles.length > 0) {
      setFiles((prev) => {
        const existing = new Set(prev.map((f) => f.path));
        const newFiles = droppedFiles.filter((p) => !existing.has(p)).map((p) => ({ path: p, status: 'pending' as FileStatus }));
        return [...prev, ...newFiles];
      });
    }
  };

  const runImport = async () => {
    if (!canImport) return;
    setBusy(true);
    for (let i = 0; i < files.length; i++) {
      if (files[i].status !== 'pending') continue;
      setFiles((prev) => prev.map((f, idx) => idx === i ? { ...f, status: 'loading' } : f));
      try {
        const r = await getProvider().importImageToNode(node, files[i].path);
        setFiles((prev) => prev.map((f, idx) => idx === i ? { ...f, status: r.error ? 'error' : 'done', result: r } : f));
      } catch (e) {
        setFiles((prev) => prev.map((f, idx) => idx === i ? { ...f, status: 'error', result: { runtime: '', output: '', images: [], error: e instanceof Error ? e.message : String(e) } } : f));
      }
    }
    setBusy(false);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className={styles.body} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <section className={styles.callout}>
        <p className={styles.calloutTitle}>{t('imageTransfer.import.whatTitle', 'What this does')}</p>
        <p className={styles.calloutText}>{t('imageTransfer.import.description', '')}</p>
      </section>

      <section className={styles.form}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('imageTransfer.import.node', 'Target node')}</span>
          <select className={styles.select} value={node} onChange={(e) => setNode(e.target.value)}>
            <option value="" disabled>{t('imageTransfer.import.pickNode', 'Select a node\u2026')}</option>
            {nodes.map((n) => <option key={n.name} value={n.name}>{n.name}{n.status ? ` (${n.status})` : ''}</option>)}
          </select>
        </label>

        <div className={styles.field}>
          <div className={styles.fileRow}>
            <button type="button" className={styles.fileBtn} onClick={() => void pickFiles()} disabled={busy}>
              {t('imageTransfer.import.chooseFiles', 'Choose .tar files\u2026')}
            </button>
            <span className={styles.fieldHint}>{t('imageTransfer.import.dragHint', 'Or drag .tar files here')}</span>
          </div>
        </div>

        {files.length > 0 && (
          <div className={styles.fileList}>
            <div className={styles.fileListHeader}>
              {t('imageTransfer.import.batchSelected', '{count} files selected').replace('{count}', String(files.length))}
            </div>
            {files.map((f, i) => (
              <Fragment key={f.path}>
                <div className={styles.fileItem} data-status={f.status}>
                  <span className={styles.fileName} title={f.path}>{f.path.split('/').pop()}</span>
                  <span className={styles.fileBadge}>
                    {f.status === 'pending' && '\u23F3'}
                    {f.status === 'loading' && '\u23F3'}
                    {f.status === 'done' && '\u2705'}
                    {f.status === 'error' && '\u274C'}
                  </span>
                  {f.status === 'pending' && (
                    <button type="button" className={styles.removeBtn} onClick={() => removeFile(i)}>×</button>
                  )}
                </div>
                {f.status === 'done' && f.result && !f.result.error && (
                  <div className={styles.result}>
                    <div className={styles.resultRuntime}>
                      <span className={styles.resultLabel}>{t('imageTransfer.import.runtime', 'Runtime')}</span>
                      <span className={styles.resultValue}>{f.result.runtime}</span>
                    </div>
                    {f.result.images.length > 0 && (
                      <div className={styles.resultImages}>
                        <span className={styles.resultLabel}>{t('imageTransfer.import.loadedImages', 'Loaded images')}</span>
                        <ul className={styles.imageList}>
                          {f.result.images.map((img) => (
                            <li key={img} className={styles.imageItem}>{img}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {f.result.output && (
                      <details className={styles.outputDetails}>
                        <summary className={styles.outputSummary}>{t('imageTransfer.import.rawOutput', 'Raw output')}</summary>
                        <pre className={styles.outputPre}>{f.result.output}</pre>
                      </details>
                    )}
                  </div>
                )}
                {f.status === 'error' && f.result?.error && (
                  <div className={styles.result}>
                    <div className={styles.resultErr}>{f.result.error}</div>
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )}

        {dragging && <div className={styles.dropZone}>{t('imageTransfer.import.dropHere', 'Drop .tar files here')}</div>}
      </section>

      <footer className={styles.footer}>
        <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={busy}>{t('imageTransfer.close', 'Close')}</button>
        <button type="button" className={styles.importBtn} disabled={!canImport} onClick={() => void runImport()}>
          {busy ? t('imageTransfer.import.importing', 'Importing\u2026') : t('imageTransfer.import.import', 'Import')}
        </button>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// To Registry — copy an image into a configured private registry via skopeo.
// ---------------------------------------------------------------------------

function ToRegistrySection({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const provider = getProvider();

  // Skopeo availability + configured registries — fetched once on mount. The
  // tab is gated on skopeo being present; without it the form is useless.
  const [skopeo, setSkopeo] = useState<SkopeoAvailability | null>(null);
  const [registries, setRegistries] = useState<ImageRegistry[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [avail, regs] = await Promise.all([
          provider.imageSyncStatus(),
          provider.imageRegistryList(),
        ]);
        if (!cancelled) {
          setSkopeo(avail);
          setRegistries(regs);
        }
      } catch {
        // Non-fatal: the form still renders, the copy attempt will surface
        // a real error if skopeo is missing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const [source, setSource] = useState('');
  const [path, setPath] = useState('');
  const [destRegistry, setDestRegistry] = useState('');
  const [destRepo, setDestRepo] = useState('');
  const [destTag, setDestTag] = useState('');
  const [srcCreds, setSrcCreds] = useState('');
  const [insecureSrc, setInsecureSrc] = useState(false);
  const [insecureDest, setInsecureDest] = useState(false);

  const [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [archiveInfo, setArchiveInfo] = useState<ArchiveInfo | null>(null);
  const [result, setResult] = useState<ImageSyncResult | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const skopeoMissing = skopeo !== null && !skopeo.available;

  const pickFile = async () => {
    setError(null);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        title: t('imageTransfer.chooseFile', 'Select image archive'),
        multiple: false,
        filters: [{ name: 'Image archive', extensions: ['tar'] }],
      });
      if (typeof selected === 'string') {
        setPath(selected);
        setSource(`docker-archive:${selected}`);
        setArchiveInfo(null);
        setResult(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const inspect = async () => {
    if (!path) return;
    setInspecting(true);
    setError(null);
    try {
      const info = await provider.imageInspectArchive(path);
      setArchiveInfo(info);
      // Prefill repo/tag from the archive's first tag if the user hasn't typed.
      if (!destRepo && info.repoTags[0]) {
        const first = info.repoTags[0];
        const idx = first.lastIndexOf(':');
        setDestRepo(idx > 0 ? first.slice(0, idx) : first);
        setDestTag(idx > 0 ? first.slice(idx + 1) : 'latest');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInspecting(false);
    }
  };

  const canCopy =
    !busy &&
    !skopeoMissing &&
    source.trim() !== '' &&
    destRegistry !== '' &&
    destRepo.trim() !== '';

  const runCopy = async () => {
    if (!canCopy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setLogLines([]);
    try {
      const r = await provider.imageCopy(
        source.trim(),
        destRegistry,
        destRepo.trim(),
        destTag.trim() || 'latest',
        srcCreds.trim() || null,
        insecureSrc,
        insecureDest,
        (line) => setLogLines((prev) => [...prev, line])
      );
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // skopeo not installed: show the install hint instead of the form.
  if (skopeoMissing) {
    return (
      <>
        <div className={styles.body}>
          <div className={styles.callout}>
            <p className={styles.calloutText}>
              {t('imageTransfer.registry.skopeoMissing', 'skopeo is not installed.')}
            </p>
            {skopeo?.version && <p className={styles.calloutText}>{skopeo.version}</p>}
          </div>
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            {t('imageTransfer.close', 'Close')}
          </button>
        </footer>
      </>
    );
  }

  return (
    <>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.body}>
        <section className={styles.callout}>
          <p className={styles.calloutTitle}>
            {t('imageTransfer.registry.whatTitle', 'What this does')}
          </p>
          <p className={styles.calloutText}>{t('imageTransfer.registry.description', '')}</p>
        </section>

        {registries.length === 0 ? (
          <div className={styles.noticeInline}>
            {t(
              'imageTransfer.registry.noRegistries',
              'No registries configured — add one in Image Registries first.'
            )}
          </div>
        ) : (
          <section className={styles.form}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('imageTransfer.archive', 'Image archive')}</span>
              <div className={styles.fileRow}>
                <button
                  type="button"
                  className={styles.fileBtn}
                  onClick={() => void pickFile()}
                  disabled={busy}
                >
                  {t('imageTransfer.chooseFile', 'Choose .tar file…')}
                </button>
                <span className={styles.fileName} title={path}>
                  {path ? path.split('/').pop() : ''}
                </span>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => void inspect()}
                  disabled={!path || inspecting || busy}
                >
                  {inspecting
                    ? t('imageTransfer.registry.inspecting', 'Inspecting…')
                    : t('imageTransfer.registry.inspect', 'Inspect tar')}
                </button>
              </div>
            </label>

            {archiveInfo && (
              <div className={styles.archiveInfo}>
                <div>
                  <strong>{archiveInfo.name || '(no name)'}</strong>
                  {archiveInfo.repoTags.map((tg) => (
                    <span key={tg} className={styles.tagChip}>
                      {tg}
                    </span>
                  ))}
                </div>
                <div className={styles.archiveMeta}>
                  {archiveInfo.architecture}/{archiveInfo.os} · {formatBytes(archiveInfo.sizeBytes)}{' '}
                  · {archiveInfo.digest.slice(0, 19)}…
                </div>
                {!(archiveInfo.os === 'linux' && archiveInfo.architecture === 'amd64') && (
                  <div className={styles.warn}>
                    {t(
                      'imageTransfer.registry.archWarn',
                      'Warning: not linux/amd64 — may not run on your cluster.'
                    )
                      .replace('{arch}', archiveInfo.architecture)
                      .replace('{os}', archiveInfo.os)}
                  </div>
                )}
              </div>
            )}

            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {t('imageTransfer.registry.registry', 'Destination registry')}
              </span>
              <select
                className={styles.select}
                value={destRegistry}
                onChange={(e) => setDestRegistry(e.target.value)}
              >
                <option value="" disabled>
                  {t('imageTransfer.registry.pickRegistry', 'Select a registry…')}
                </option>
                {registries.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name} ({r.url})
                  </option>
                ))}
              </select>
            </label>

            <div className={styles.twoCol}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  {t('imageTransfer.registry.repo', 'Destination repo')}
                </span>
                <input
                  type="text"
                  className={styles.input}
                  value={destRepo}
                  placeholder="library/nginx"
                  onChange={(e) => setDestRepo(e.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  {t('imageTransfer.registry.tag', 'Destination tag')}
                </span>
                <input
                  type="text"
                  className={styles.input}
                  value={destTag}
                  placeholder="1.25"
                  onChange={(e) => setDestTag(e.target.value)}
                />
              </label>
            </div>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {t('imageTransfer.registry.source', 'Source')}
              </span>
              <input
                type="text"
                className={styles.input}
                value={source}
                placeholder="docker-archive:/path/to/img.tar  or  docker://nginx:1.25"
                onChange={(e) => setSource(e.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {t('imageTransfer.registry.srcCreds', 'Source credentials')}
              </span>
              <input
                type="text"
                className={styles.input}
                value={srcCreds}
                placeholder="user:pass"
                onChange={(e) => setSrcCreds(e.target.value)}
              />
              <small className={styles.fieldHelp}>
                {t('imageTransfer.registry.srcCredsHelp', 'user:pass for a private source registry.')}
              </small>
            </label>

            <div className={styles.checkRow}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={insecureSrc}
                  onChange={(e) => setInsecureSrc(e.target.checked)}
                />
                {t('imageTransfer.registry.insecureSrc', 'Skip source TLS verify')}
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={insecureDest}
                  onChange={(e) => setInsecureDest(e.target.checked)}
                />
                {t('imageTransfer.registry.insecureDest', 'Skip destination TLS verify')}
              </label>
            </div>

            {(logLines.length > 0 || result) && (
              <section className={styles.logSection}>
                <div className={styles.resultLabel}>
                  {t('imageTransfer.registry.log', 'Progress log')}
                </div>
                <pre className={styles.logPre}>
                  {logLines.join('\n')}
                  {result ? `\n${result.summary}` : ''}
                </pre>
              </section>
            )}
          </section>
        )}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={busy}>
          {t('imageTransfer.close', 'Close')}
        </button>
        <button
          type="button"
          className={styles.importBtn}
          disabled={!canCopy}
          onClick={() => void runCopy()}
        >
          {busy
            ? t('imageTransfer.registry.copying', 'Copying…')
            : t('imageTransfer.registry.copy', 'Copy to registry')}
        </button>
      </footer>
    </>
  );
}

// ---------------------------------------------------------------------------
// ExportSection — wraps FromNode + FromRegistry under the Export top tab.
// ---------------------------------------------------------------------------

function ExportSection({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'from-node' | 'from-registry'>('from-node');
  return (
    <>
      <div className={styles.tabBar} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'from-node'} className={styles.tabBtn} data-active={tab === 'from-node'} onClick={() => setTab('from-node')}>
          {t('imageTransfer.tabFromNode', 'From Node')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'from-registry'} className={styles.tabBtn} data-active={tab === 'from-registry'} onClick={() => setTab('from-registry')}>
          {t('imageTransfer.tabFromRegistry', 'From Registry')}
        </button>
      </div>
      {tab === 'from-node' ? <FromNodeSection onClose={onClose} /> : <FromRegistrySection onClose={onClose} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// From Node — export a container image from a node's runtime to a local .tar.
// ---------------------------------------------------------------------------

function FromNodeSection({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const nodeRows = useStore((s) => rowsFor(s.rows, 'nodes'));
  const nodes = useMemo(() => nodeRows.map(nodeOption).filter((n) => n.name), [nodeRows]);

  const [node, setNode] = useState('');
  const [imageRef, setImageRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const [nodeImages, setNodeImages] = useState<string[]>([]);
  const [result, setResult] = useState<ExportFromNodeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canExport = !busy && node !== '' && imageRef.trim() !== '';

  const pickSavePath = async () => {
    if (!canExport) return;
    setError(null);
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const selected = await save({
        title: t('imageTransfer.export.chooseSavePath', 'Save image archive'),
        defaultPath: `${imageRef.replace(/[/:]/g, '_')}.tar`,
        filters: [{ name: 'Image archive', extensions: ['tar'] }],
      });
      if (selected) {
        setBusy(true);
        setResult(null);
        try {
          const r = await getProvider().exportFromNode(node, imageRef.trim(), selected);
          setResult(r);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const listImages = async () => {
    if (!node) return;
    setListing(true);
    setError(null);
    try {
      const imgs = await getProvider().listNodeImages(node);
      setNodeImages(imgs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setListing(false);
    }
  };

  return (
    <>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.body}>
        <section className={styles.callout}>
          <p className={styles.calloutTitle}>{t('imageTransfer.export.nodeTitle', 'What this does')}</p>
          <p className={styles.calloutText}>{t('imageTransfer.export.nodeDesc', 'Export a container image from a cluster node\'s runtime to a local .tar file.')}</p>
        </section>

        <section className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('imageTransfer.export.sourceNode', 'Source node')}</span>
            <select className={styles.select} value={node} onChange={(e) => { setNode(e.target.value); setNodeImages([]); }}>
              <option value="" disabled>{t('imageTransfer.export.pickNode', 'Select a node\u2026')}</option>
              {nodes.map((n) => <option key={n.name} value={n.name}>{n.name}{n.status ? ` (${n.status})` : ''}</option>)}
            </select>
          </label>

          <div className={styles.field}>
            <button type="button" className={styles.secondaryBtn} onClick={() => void listImages()} disabled={!node || listing}>
              {listing ? t('imageTransfer.export.listingImages', 'Listing\u2026') : t('imageTransfer.export.listImages', 'List images on node')}
            </button>
            {nodeImages.length > 0 && (
              <div className={styles.imageChipList}>
                {nodeImages.map((img) => (
                  <button key={img} type="button" className={styles.imageChip} onClick={() => setImageRef(img)} data-selected={imageRef === img}>
                    {img}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('imageTransfer.export.imageRef', 'Image reference')}</span>
            <input type="text" className={styles.input} value={imageRef} placeholder={t('imageTransfer.export.imageRefPlaceholder', 'nginx:1.25')} onChange={(e) => setImageRef(e.target.value)} />
          </label>
        </section>

        {result && (
          <section className={styles.result}>
            {result.error ? (
              <div className={styles.resultErr}>{result.error}</div>
            ) : (
              <>
                <div className={styles.resultRuntime}>
                  <span className={styles.resultLabel}>{t('imageTransfer.export.runtime', 'Runtime')}</span>
                  <span className={styles.resultValue}>{result.runtime}</span>
                </div>
                <div className={styles.resultRuntime}>
                  <span className={styles.resultLabel}>{t('imageTransfer.export.savedTo', 'Saved to')}</span>
                  <span className={styles.resultValue}>{result.savedPath}</span>
                </div>
                {result.output && (
                  <details className={styles.outputDetails}>
                    <summary className={styles.outputSummary}>{t('imageTransfer.export.rawOutput', 'Raw output')}</summary>
                    <pre className={styles.outputPre}>{result.output}</pre>
                  </details>
                )}
              </>
            )}
          </section>
        )}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={busy}>{t('imageTransfer.close', 'Close')}</button>
        <button type="button" className={styles.importBtn} disabled={!canExport} onClick={() => void pickSavePath()}>
          {busy ? t('imageTransfer.export.exporting', 'Exporting\u2026') : t('imageTransfer.export.export', 'Export')}
        </button>
      </footer>
    </>
  );
}

// ---------------------------------------------------------------------------
// From Registry — export an image from a registry to a local .tar via skopeo.
// ---------------------------------------------------------------------------

function FromRegistrySection({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const provider = getProvider();

  const [skopeo, setSkopeo] = useState<SkopeoAvailability | null>(null);
  const [registries, setRegistries] = useState<ImageRegistry[]>([]);
  const [selectedRegistry, setSelectedRegistry] = useState('');
  const [repos, setRepos] = useState<string[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState('');
  const [insecureSrc, setInsecureSrc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportFromRegistryResult | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [avail, regs] = await Promise.all([provider.imageSyncStatus(), provider.imageRegistryList()]);
        if (!cancelled) { setSkopeo(avail); setRegistries(regs); }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [provider]);

  useEffect(() => {
    if (!selectedRegistry) { setRepos([]); setSelectedRepo(''); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await provider.imageRegistryRepos(selectedRegistry);
        if (!cancelled) setRepos(r.map((x) => x.name));
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [provider, selectedRegistry]);

  useEffect(() => {
    if (!selectedRegistry || !selectedRepo) { setTags([]); setSelectedTag(''); return; }
    let cancelled = false;
    (async () => {
      try {
        const tagList = await provider.imageRegistryTags(selectedRegistry, selectedRepo);
        if (!cancelled) setTags(tagList.map((x) => x.name));
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [provider, selectedRegistry, selectedRepo]);

  const skopeoMissing = skopeo !== null && !skopeo.available;
  const canExport = !busy && !skopeoMissing && selectedRegistry !== '' && selectedRepo !== '' && selectedTag !== '';

  const pickSavePath = async () => {
    if (!canExport) return;
    setError(null);
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const defaultName = `${selectedRepo.replace(/\//g, '_')}_${selectedTag}.tar`;
      const selected = await save({
        title: t('imageTransfer.export.chooseSavePath', 'Save image archive'),
        defaultPath: defaultName,
        filters: [{ name: 'Image archive', extensions: ['tar'] }],
      });
      if (selected) {
        setBusy(true);
        setResult(null);
        setLogLines([]);
        try {
          const r = await provider.exportFromRegistry(selectedRegistry, selectedRepo, selectedTag, selected, insecureSrc, (line) => setLogLines((prev) => [...prev, line]));
          setResult(r);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (skopeoMissing) {
    return (
      <>
        <div className={styles.body}>
          <div className={styles.callout}>
            <p className={styles.calloutText}>{t('imageTransfer.registry.skopeoMissing', 'skopeo is not installed.')}</p>
            {skopeo?.version && <p className={styles.calloutText}>{skopeo.version}</p>}
          </div>
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>{t('imageTransfer.close', 'Close')}</button>
        </footer>
      </>
    );
  }

  return (
    <>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.body}>
        <section className={styles.callout}>
          <p className={styles.calloutTitle}>{t('imageTransfer.export.registryTitle', 'What this does')}</p>
          <p className={styles.calloutText}>{t('imageTransfer.export.registryDesc', 'Export an image from a configured private registry to a local .tar file using skopeo.')}</p>
        </section>

        {registries.length === 0 ? (
          <div className={styles.noticeInline}>{t('imageTransfer.export.noRegistries', 'No registries configured \u2014 add one in Image Registries first.')}</div>
        ) : (
          <section className={styles.form}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('imageTransfer.export.registry', 'Source registry')}</span>
              <select className={styles.select} value={selectedRegistry} onChange={(e) => setSelectedRegistry(e.target.value)}>
                <option value="" disabled>{t('imageTransfer.export.pickRegistry', 'Select a registry\u2026')}</option>
                {registries.map((r) => <option key={r.name} value={r.name}>{r.name} ({r.url})</option>)}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('imageTransfer.export.repo', 'Repository')}</span>
              <select className={styles.select} value={selectedRepo} onChange={(e) => setSelectedRepo(e.target.value)} disabled={repos.length === 0}>
                <option value="" disabled>{t('imageTransfer.export.pickRepo', 'Select a repository\u2026')}</option>
                {repos.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('imageTransfer.export.tag', 'Tag')}</span>
              <select className={styles.select} value={selectedTag} onChange={(e) => setSelectedTag(e.target.value)} disabled={tags.length === 0}>
                <option value="" disabled>{t('imageTransfer.export.pickTag', 'Select a tag\u2026')}</option>
                {tags.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>

            <label className={styles.check}>
              <input type="checkbox" checked={insecureSrc} onChange={(e) => setInsecureSrc(e.target.checked)} />
              {t('imageTransfer.export.insecureSrc', 'Skip TLS verify')}
            </label>

            {(logLines.length > 0 || result) && (
              <section className={styles.logSection}>
                <div className={styles.resultLabel}>{t('imageTransfer.export.log', 'Progress log')}</div>
                <pre className={styles.logPre}>{logLines.join('\n')}{result ? `\n${result.summary}` : ''}</pre>
              </section>
            )}
          </section>
        )}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={busy}>{t('imageTransfer.close', 'Close')}</button>
        <button type="button" className={styles.importBtn} disabled={!canExport} onClick={() => void pickSavePath()}>
          {busy ? t('imageTransfer.export.exportingRegistry', 'Exporting\u2026') : t('imageTransfer.export.exportRegistry', 'Export to file')}
        </button>
      </footer>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers / sub-components
// ---------------------------------------------------------------------------

function Header({
  title,
  onClose,
  t,
}: {
  title: string;
  onClose?: () => void;
  t: (k: string, fallback: string) => string;
}) {
  return (
    <header className={styles.header}>
      <h2>{title}</h2>
      {onClose && (
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label={t('imageTransfer.close', 'Close')}
        >
          ×
        </button>
      )}
    </header>
  );
}

function nodeOption(row: Row): { name: string; status: string } {
  const name = String(row.cells[0] ?? row.name ?? '');
  const status = String(row.cells[1] ?? '');
  return { name, status };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

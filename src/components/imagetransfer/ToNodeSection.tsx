/**
 * ToNodeSection — load local .tar files into a node's container runtime (batch).
 *
 * For clusters with no internal registry.
 */

import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import { useStore, rowsFor } from '../../store';
import { formatError, getProvider } from '../../providers';
import type { ImportImageResult, Row } from '../../providers/types';
import styles from './ImageTransferPanel.module.css';

type FileStatus = 'pending' | 'loading' | 'done' | 'error';

function nodeOption(row: Row): { name: string; status: string } {
  const name = String(row.cells[0] ?? row.name ?? '');
  const status = String(row.cells[1] ?? '');
  return { name, status };
}

export function ToNodeSection({ onClose }: { onClose?: () => void }) {
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
      .map((f) => f.path)
      .filter((p): p is string => Boolean(p));
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
        setFiles((prev) => prev.map((f, idx) => idx === i ? { ...f, status: 'error', result: { runtime: '', output: '', images: [], error: formatError(e) } } : f));
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

/**
 * FromNodeSection — export a container image from a node's runtime to a local .tar.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import { useStore, rowsFor } from '../../store';
import { formatError, getProvider } from '../../providers';
import type { ExportFromNodeResult, Row } from '../../providers/types';
import styles from './ImageTransferPanel.module.css';

function nodeOption(row: Row): { name: string; status: string } {
  const name = String(row.cells[0] ?? row.name ?? '');
  const status = String(row.cells[1] ?? '');
  return { name, status };
}

export function FromNodeSection({ onClose }: { onClose?: () => void }) {
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
          setError(formatError(e));
        } finally {
          setBusy(false);
        }
      }
    } catch (e) {
      setError(formatError(e));
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
      setError(formatError(e));
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

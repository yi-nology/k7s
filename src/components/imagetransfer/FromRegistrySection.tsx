/**
 * FromRegistrySection — export an image from a registry to a local .tar via skopeo.
 */

import { useState } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import { useAsyncEffect } from '../../hooks/useAsyncEffect';
import { formatError, getProvider } from '../../providers';
import type { ExportFromRegistryResult, ImageRegistry, SkopeoAvailability } from '../../providers/types';
import styles from './ImageTransferPanel.module.css';

export function FromRegistrySection({ onClose }: { onClose?: () => void }) {
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

  useAsyncEffect(async (isMounted) => {
    try {
      const [avail, regs] = await Promise.all([provider.imageSyncStatus(), provider.imageRegistryList()]);
      if (isMounted()) { setSkopeo(avail); setRegistries(regs); }
    } catch { /* non-fatal */ }
  }, [provider]);

  useAsyncEffect(async (isMounted) => {
    if (!selectedRegistry) { setRepos([]); setSelectedRepo(''); return; }
    try {
      const r = await provider.imageRegistryRepos(selectedRegistry);
      if (isMounted()) setRepos(r.map((x) => x.name));
    } catch { /* non-fatal */ }
  }, [provider, selectedRegistry]);

  useAsyncEffect(async (isMounted) => {
    if (!selectedRegistry || !selectedRepo) { setTags([]); setSelectedTag(''); return; }
    try {
      const tagList = await provider.imageRegistryTags(selectedRegistry, selectedRepo);
      if (isMounted()) setTags(tagList.map((x) => x.name));
    } catch { /* non-fatal */ }
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
          setError(formatError(e));
        } finally {
          setBusy(false);
        }
      }
    } catch (e) {
      setError(formatError(e));
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

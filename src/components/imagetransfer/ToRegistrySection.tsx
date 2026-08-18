/**
 * ToRegistrySection — copy an image into a configured private registry via skopeo.
 *
 * For clusters that DO have an internal registry (Harbor/Nexus);
 * all nodes then pull from it.
 */

import { useState } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import { useAsyncEffect } from '../../hooks/useAsyncEffect';
import { formatError, getProvider } from '../../providers';
import type { ArchiveInfo, ImageRegistry, ImageSyncResult, SkopeoAvailability } from '../../providers/types';
import styles from './ImageTransferPanel.module.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function ToRegistrySection({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const provider = getProvider();

  // Skopeo availability + configured registries — fetched once on mount. The
  // tab is gated on skopeo being present; without it the form is useless.
  const [skopeo, setSkopeo] = useState<SkopeoAvailability | null>(null);
  const [registries, setRegistries] = useState<ImageRegistry[]>([]);

  useAsyncEffect(async (isMounted) => {
    try {
      const [avail, regs] = await Promise.all([
        provider.imageSyncStatus(),
        provider.imageRegistryList(),
      ]);
      if (isMounted()) {
        setSkopeo(avail);
        setRegistries(regs);
      }
    } catch {
      // Non-fatal: the form still renders, the copy attempt will surface
      // a real error if skopeo is missing.
    }
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
      setError(formatError(e));
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
      setError(formatError(e));
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
      setError(formatError(e));
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

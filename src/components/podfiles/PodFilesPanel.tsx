/**
 * PodFilesPanel — browse / read / write / download / upload files inside a
 * running pod's container (Phase 2 of KubePi parity).
 *
 * Two-pane layout: a directory tree on the left, a content editor / viewer
 * on the right. The breadcrumb at the top drives the current path; clicking
 * a directory navigates into it, clicking a file loads it into the editor.
 *
 * Not wired into the detail panel's tab system yet: the entry point is a
 * sidebar action ("Files") that opens this as an overlay. Once that's
 * settled, the overlay can fold back into a tab — the panel itself is
 * stateless about its container.
 */
import { useCallback, useMemo, useState } from 'react';
import { formatError, getProvider } from '../../providers';
import { useAsyncEffect } from '../../hooks/useAsyncEffect';
import type { PodFileEntry, ResourceRef } from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import { sanitizePath, safePathJoin } from '../../lib/security';
import { EditorCore } from '../editor/EditorCore';
import { ConfirmDialog } from '../common/ConfirmDialog';
import styles from './PodFilesPanel.module.css';

/** Extensions considered binary — editing disabled, download only. */
const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg',
  'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'exe', 'bin', 'so', 'dylib', 'dll', 'o', 'a',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv', 'webm',
]);

/** Extensions that get YAML/highlight support. */
const YAML_EXTS = new Set(['yaml', 'yml']);

function isBinaryFilename(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTS.has(ext);
}

function languageForFile(name: string): 'yaml' | undefined {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return YAML_EXTS.has(ext) ? 'yaml' : undefined;
}

export function PodFilesPanel({
  ref,
  container,
  initialPath = '/',
  onClose,
}: {
  ref: ResourceRef;
  container: string | null;
  initialPath?: string;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState(initialPath);
  const [entries, setEntries] = useState<PodFileEntry[]>([]);
  const [selected, setSelected] = useState<PodFileEntry | null>(null);
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<PodFileEntry | null>(null);
  const dirty = content !== originalContent && selected?.kind !== 'dir';
  const isBinary = selected ? isBinaryFilename(selected.name) : false;
  const isLarge = content.length > 1_000_000; // >1MB

  // Reload listing whenever the path changes.
  useAsyncEffect(async (isMounted) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getProvider().podFilesList(ref, container, path);
      if (isMounted()) setEntries(rows);
    } catch (e: unknown) {
      if (isMounted()) setError(formatError(e));
    } finally {
      if (isMounted()) setLoading(false);
    }
  }, [ref, container, path]);

  // When a file is selected, load its contents.
  useAsyncEffect(
    async (isMounted) => {
      if (!selected || selected.kind === 'dir') return;
      setLoading(true);
      setError(null);
      const fullPath = joinPath(path, selected.name);
      try {
        const text = await getProvider().podFilesRead(ref, container, fullPath);
        if (isMounted()) {
          setContent(text);
          setOriginalContent(text);
        }
      } catch (e: unknown) {
        if (isMounted()) setError(formatError(e));
      } finally {
        if (isMounted()) setLoading(false);
      }
    },
    [selected, ref, container, path],
  );

  const navigateInto = useCallback((name: string) => setPath((p) => joinPath(p, name)), []);
  const navigateUp = useCallback(() => setPath((p) => parentPath(p)), []);

  const save = useCallback(async () => {
    if (!selected) return;
    setError(null);
    try {
      await getProvider().podFilesWrite(ref, container, joinPath(path, selected.name), content);
      setOriginalContent(content);
    } catch (e) {
      setError(formatError(e));
    }
  }, [selected, ref, container, path, content]);

  /** Select a file — with dirty guard. */
  const selectFile = useCallback((entry: PodFileEntry) => {
    if (dirty && selected) {
      setPendingFile(entry);
      return;
    }
    setSelected(entry);
  }, [dirty, selected]);

  const confirmSwitch = useCallback(() => {
    if (pendingFile) {
      setSelected(pendingFile);
      setPendingFile(null);
    }
  }, [pendingFile]);

  const cancelSwitch = useCallback(() => {
    setPendingFile(null);
  }, []);

  const breadcrumbs = useMemo(() => path.split('/').filter(Boolean), [path]);

  return (
    <>
    <ConfirmDialog
      open={!!pendingFile}
      onClose={cancelSwitch}
      onConfirm={confirmSwitch}
      title={t('files.unsavedTitle', 'Unsaved changes')}
      body={t('files.unsavedBody', 'You have unsaved changes. Discard and switch file?')}
      confirmLabel={t('files.discardAndSwitch', 'Discard and switch')}
      danger
    />
    <div className={styles.panel}>
      <header className={styles.header}>
        <div className={styles.crumbs}>
          <button className={styles.crumb} onClick={() => setPath('/')}>
            /
          </button>
          {breadcrumbs.map((seg, i) => (
            <span key={i}>
              <span className={styles.sep}>/</span>
              <button
                className={styles.crumb}
                onClick={() => setPath('/' + breadcrumbs.slice(0, i + 1).join('/'))}
              >
                {seg}
              </button>
            </span>
          ))}
        </div>
        <div className={styles.headerActions}>
          {path !== '/' && (
            <button className={styles.btn} onClick={navigateUp}>
              {t('files.up', 'Up')}
            </button>
          )}
          {onClose && (
            <button className={styles.btn} onClick={onClose}>
              {t('files.close', 'Close')}
            </button>
          )}
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.body}>
        <div className={styles.list}>
          {loading && entries.length === 0 ? (
            <div className={styles.empty}>…</div>
          ) : entries.length === 0 ? (
            <div className={styles.empty}>{t('files.empty', '(empty directory)')}</div>
          ) : (
            <ul className={styles.entries}>
              {entries.map((e) => (
                <li
                  key={e.name}
                  className={selected?.name === e.name ? styles.entryActive : styles.entry}
                  onClick={() => selectFile(e)}
                  onDoubleClick={() => e.kind === 'dir' && navigateInto(e.name)}
                  title={e.target ? `${e.name} → ${e.target}` : `${e.name} (${e.kind})`}
                >
                  <span className={styles.icon}>{iconFor(e.kind)}</span>
                  <span className={styles.name}>{e.name}</span>
                  <span className={styles.size}>{e.kind === 'dir' ? '' : humanSize(e.size)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={styles.editor}>
          {selected && selected.kind !== 'dir' ? (
            <>
              <div className={styles.editorBar}>
                <span>{selected.name}</span>
                <div className={styles.editorActions}>
                  <button className={styles.btn} disabled={!dirty} onClick={save}>
                    {t('files.save', 'Save')}
                  </button>
                  <button
                    className={styles.btn}
                    onClick={async () => {
                      try {
                        const bytes = await getProvider().podFilesDownload(
                          ref,
                          container,
                          joinPath(path, selected.name)
                        );
                        // Browser-side: hand the bytes to the OS save dialog.
                        // Copy into a fresh ArrayBuffer so the Blob's
                        // BlobPart type matches the TS DOM lib's stricter
                        // Uint8Array<ArrayBuffer> signature.
                        const buf = new ArrayBuffer(bytes.byteLength);
                        new Uint8Array(buf).set(bytes);
                        const blob = new Blob([buf]);
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = selected.name + '.tar';
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch (e) {
                        setError(formatError(e));
                      }
                    }}
                  >
                    {t('files.download', 'Download')}
                  </button>
                </div>
              </div>
              {isBinary ? (
                <div className={styles.empty}>
                  {t('files.binary', 'Binary file — editing disabled. Use Download.')}
                </div>
              ) : isLarge ? (
                <div className={styles.empty}>
                  {t('files.tooLarge', 'File too large for editing (>1MB). Use Download.')}
                </div>
              ) : (
                <EditorCore
                  key={selected.name}
                  value={content}
                  language={languageForFile(selected.name)}
                  editable
                  onChange={setContent}
                  onSave={() => void save()}
                />
              )}
            </>
          ) : (
            <div className={styles.empty}>{t('files.pickFile', 'Pick a file to view or edit')}</div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

function iconFor(kind: string): string {
  if (kind === 'dir') return '▸';
  if (kind === 'symlink') return '↪';
  return '·';
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} K`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} M`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} G`;
}

function joinPath(a: string, b: string): string {
  const result = safePathJoin(a, b);
  // Fallback for safety — should never happen with validated inputs
  if (result === null) return a;
  return result;
}

function parentPath(p: string): string {
  const sanitized = sanitizePath(p);
  if (sanitized === null || sanitized === '/') return '/';
  const parts = sanitized.split('/').filter(Boolean);
  parts.pop();
  return '/' + parts.join('/');
}

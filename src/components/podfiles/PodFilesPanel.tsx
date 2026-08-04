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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getProvider } from '../../providers';
import type { PodFileEntry, ResourceRef } from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import styles from './PodFilesPanel.module.css';

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
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload listing whenever the path changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getProvider()
      .podFilesList(ref, container, path)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((e: unknown) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ref.namespace, ref.name, container, path]);

  // When a file is selected, load its contents.
  useEffect(() => {
    if (!selected || selected.kind === 'dir') return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const fullPath = joinPath(path, selected.name);
    getProvider()
      .podFilesRead(ref, container, fullPath)
      .then((text) => {
        if (!cancelled) {
          setContent(text);
          setDirty(false);
        }
      })
      .catch((e: unknown) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selected, ref.namespace, ref.name, container, path]);

  const navigateInto = useCallback((name: string) => setPath((p) => joinPath(p, name)), []);
  const navigateUp = useCallback(() => setPath((p) => parentPath(p)), []);

  const save = useCallback(async () => {
    if (!selected) return;
    setError(null);
    try {
      await getProvider().podFilesWrite(ref, container, joinPath(path, selected.name), content);
      setDirty(false);
    } catch (e) {
      setError(String(e));
    }
  }, [selected, ref.namespace, ref.name, container, path, content]);

  const breadcrumbs = useMemo(() => path.split('/').filter(Boolean), [path]);

  return (
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
                  onClick={() => setSelected(e)}
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
                        setError(String(e));
                      }
                    }}
                  >
                    {t('files.download', 'Download')}
                  </button>
                </div>
              </div>
              <textarea
                className={styles.content}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setDirty(true);
                }}
                spellCheck={false}
              />
            </>
          ) : (
            <div className={styles.empty}>{t('files.pickFile', 'Pick a file to view or edit')}</div>
          )}
        </div>
      </div>
    </div>
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
  if (a.endsWith('/')) return a + b;
  return a + '/' + b;
}

function parentPath(p: string): string {
  const parts = p.split('/').filter(Boolean);
  parts.pop();
  return '/' + parts.join('/');
}

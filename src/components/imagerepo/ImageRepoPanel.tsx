/**
 * ImageRepoPanel — manage private OCI registries and browse their
 * repositories and tags (Phase 5 of KubePi parity).
 *
 * Layout: left = list of configured registries; right = drill-down
 * (repositories → tags) for whichever is selected.
 *
 * Passwords are entered here but never rendered back to the UI after
 * the upsert round-trip — the backend's `image_registry_upsert` strips
 * them on serialise. Showing the field as `type=password` makes the
 * intent obvious even though the value isn't reflected after save.
 */
import { useEffect, useState } from 'react';
import { formatError, getProvider } from '../../providers';
import type {
  ImageManifest,
  ImageRegistry,
  ImageRegistryUpsert,
  ImageRepo,
  ImageTag,
} from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import { ConfirmDialog } from '../common/ConfirmDialog';
import styles from './ImageRepoPanel.module.css';

export function ImageRepoPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [regs, setRegs] = useState<ImageRegistry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [repos, setRepos] = useState<ImageRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [tags, setTags] = useState<ImageTag[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ImageManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Form state for adding/editing a registry.
  const [form, setForm] = useState<ImageRegistryUpsert>({
    name: '',
    url: '',
    username: '',
    password: '',
    insecure: false,
    description: '',
  });

  const reload = (): Promise<ImageRegistry[]> =>
    getProvider()
      .imageRegistryList()
      .then((next) => {
        setRegs(next);
        return next;
      })
      .catch((e: unknown) => {
        setError(formatError(e));
        return [];
      });

  useEffect(() => {
    reload().then((next) => {
      // Auto-select the first registry so the right pane is populated
      // immediately — most clusters will have one, and the empty "Pick a
      // registry on the left" state is a dead end otherwise.
      if (next.length > 0 && selected == null) {
        setSelected(next[0].name);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) {
      setRepos([]);
      setTags([]);
      return;
    }
    getProvider()
      .imageRegistryRepos(selected)
      .then(setRepos)
      .catch((e: unknown) => setError(formatError(e)));
    setTags([]);
  }, [selected]);

  const loadTags = (repo: string) => {
    if (!selected) return;
    setError(null);
    setSelectedRepo(repo);
    setSelectedTag(null);
    setManifest(null);
    getProvider()
      .imageRegistryTags(selected, repo)
      .then(setTags)
      .catch((e: unknown) => setError(formatError(e)));
  };

  const loadManifest = (tag: string) => {
    if (!selected || !selectedRepo) return;
    setError(null);
    setSelectedTag(tag);
    setManifest(null);
    getProvider()
      .imageRegistryManifest(selected, selectedRepo, tag)
      .then(setManifest)
      .catch((e: unknown) => setError(formatError(e)));
  };

  return (
    <>
    <ConfirmDialog
      open={!!pendingRemove}
      onClose={() => setPendingRemove(null)}
      onConfirm={async () => {
        if (!pendingRemove) return;
        await getProvider().imageRegistryRemove(pendingRemove);
        setSelected(null);
        reload();
        setPendingRemove(null);
      }}
      title={t('image.removeTitle', 'Remove registry')}
      body={t('image.confirmRemove', 'Remove this registry?')}
      danger
    />
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2>{t('image.title', 'Image registries')}</h2>
        {onClose && (
          <button className={styles.btn} onClick={onClose}>
            {t('image.close', 'Close')}
          </button>
        )}
      </header>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.body}>
        <aside className={styles.side}>
          <ul className={styles.list}>
            {regs.map((r) => (
              <li
                key={r.name}
                className={selected === r.name ? styles.itemActive : styles.item}
                onClick={() => setSelected(r.name)}
              >
                <div className={styles.itemName}>{r.name}</div>
                <div className={styles.itemUrl}>{r.url}</div>
                {r.lastError && (
                  <div className={styles.itemError} title={r.lastError}>
                    {r.lastError}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {selected && (
            <div className={styles.sideActions}>
              <button
                className={styles.btn}
                onClick={async () => {
                  try {
                    await getProvider().imageRegistryTest(selected);
                    reload();
                  } catch (e) {
                    setError(formatError(e));
                    reload();
                  }
                }}
              >
                {t('image.test', 'Test')}
              </button>
              <button
                className={styles.btnDanger}
                onClick={() => setPendingRemove(selected)}
              >
                {t('image.remove', 'Remove')}
              </button>
            </div>
          )}
          <button
            className={styles.primary}
            onClick={() => {
              setForm({
                name: '',
                url: '',
                username: '',
                password: '',
                insecure: false,
                description: '',
              });
              setAdding(true);
            }}
          >
            {t('image.add', 'Add registry')}
          </button>
        </aside>

        <main className={styles.main}>
          {adding ? (
            <form
              className={styles.form}
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await getProvider().imageRegistryUpsert(form);
                  setAdding(false);
                  reload();
                } catch (err) {
                  setError(formatError(err));
                }
              }}
            >
              <h3>{t('image.form.title', 'Registry')}</h3>
              <label>
                <span>{t('image.form.name', 'Name')}</span>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                <span>{t('image.form.url', 'URL')}</span>
                <input
                  required
                  placeholder="https://registry.example.com"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                />
              </label>
              <label>
                <span>{t('image.form.username', 'Username (optional)')}</span>
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </label>
              <label>
                <span>{t('image.form.password', 'Password (optional)')}</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </label>
              <label>
                <span>{t('image.form.description', 'Description')}</span>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              <div className={styles.formActions}>
                <button className={styles.primary} type="submit">
                  {t('image.form.save', 'Save')}
                </button>
                <button type="button" onClick={() => setAdding(false)} className={styles.btn}>
                  {t('image.form.cancel', 'Cancel')}
                </button>
              </div>
            </form>
          ) : selected ? (
            <div>
              <h3>{t('image.repos', 'Repositories')}</h3>
              {repos.length === 0 ? (
                <div className={styles.empty}>
                  {t(
                    'image.reposEmpty',
                    'No repositories (or registry does not support /v2/_catalog)'
                  )}
                </div>
              ) : (
                <ul className={styles.repos}>
                  {repos.map((r) => (
                    <li key={r.name} className={styles.repo} onClick={() => loadTags(r.name)}>
                      <span className={styles.repoName}>{r.name}</span>
                    </li>
                  ))}
                </ul>
              )}
              {tags.length > 0 && (
                <>
                  <h3 style={{ marginTop: 'var(--space-4)' }}>{t('image.tags', 'Tags')}</h3>
                  <ul className={styles.tags}>
                    {tags.map((tt) => (
                      <li
                        key={tt.name}
                        className={selectedTag === tt.name ? styles.tagActive : styles.tag}
                        onClick={() => loadManifest(tt.name)}
                        title={t('image.inspectTitle', 'Inspect manifest')}
                      >
                        <span className={styles.tagName}>{tt.name}</span>
                        {/* ImageTag.size / .created are nullable per providers/types.ts
                            — show size + date only when both are known; otherwise
                            render the row with just the tag name. */}
                        {tt.size != null && tt.created != null && (
                          <span className={styles.tagMeta}>
                            {humanSize(tt.size)} · {tt.created.slice(0, 10)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {manifest && (
                <div className={styles.manifest}>
                  <h3>
                    {t('image.manifest', 'Manifest')} — {selectedRepo}:{selectedTag}
                  </h3>
                  <table className={styles.manifestTable}>
                    <tbody>
                      <tr>
                        <th>{t('image.mediaType', 'Media type')}</th>
                        <td>{manifest.mediaType}</td>
                      </tr>
                      <tr>
                        <th>{t('image.digest', 'Digest')}</th>
                        <td className={styles.mono}>{manifest.digest}</td>
                      </tr>
                      <tr>
                        <th>{t('image.schemaVersion', 'Schema')}</th>
                        <td>{manifest.schemaVersion}</td>
                      </tr>
                      <tr>
                        <th>{t('image.size', 'Total size')}</th>
                        <td>{humanSize(manifest.size)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <h4>{t('image.layers', 'Layers')}</h4>
                  <table className={styles.manifestTable}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{t('image.digest', 'Digest')}</th>
                        <th>{t('image.size', 'Size')}</th>
                        <th>{t('image.mediaType', 'Media type')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manifest.layers.map((l, i) => (
                        <tr key={l.digest}>
                          <td>{i + 1}</td>
                          <td className={styles.mono}>{l.digest}</td>
                          <td>{humanSize(l.size)}</td>
                          <td className={styles.mono}>{l.mediaType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <details>
                    <summary>{t('image.raw', 'Raw JSON')}</summary>
                    <pre className={styles.rawJson}>{manifest.raw}</pre>
                  </details>
                </div>
              )}
            </div>
          ) : (
            <div className={styles.empty}>{t('image.pick', 'Pick a registry on the left')}</div>
          )}
        </main>
      </div>
    </div>
    </>
  );
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} K`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} M`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} G`;
}

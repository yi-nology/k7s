/**
 * RevisionsTab — the "Revisions" detail tab for Deployment/StatefulSet/DaemonSet.
 *
 * Two sections, one panel:
 *   1. **Current image** — the active revision's container images, with an
 *      inline "edit image" affordance that reuses the existing modify-image
 *      flow (`ModifyImageForm` + `imageUpgrade`), so editing from here behaves
 *      exactly like the row-menu "Modify image…" action.
 *   2. **Revision history** — every retained revision with its images, replica
 *      counts, and age; non-current rows get a "rollback to here" button that
 *      calls `undoRollout(ref, rev)`. On success the list refetches, so the
 *      freshly-rolled-back revision moves into the current slot.
 *
 * The three workload kinds have different history storage (Deployment owns
 * ReplicaSets; StatefulSet/DaemonSet keep ControllerRevisions), but the backend
 * collapses them to one `Revision` shape so this component is kind-agnostic.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { formatError, getProvider } from '../../providers';
import { useTranslation } from '../../hooks/useI18n';
import type { ContainerImage, Revision } from '../../providers/types';
import { ModifyImageForm } from '../actions/ModifyImageForm';
import styles from './RevisionsTab.module.css';

export function RevisionsTab() {
  const row = useStore((s) => s.selectedRow);
  const kind = useStore((s) => s.nav);
  const { t } = useTranslation();

  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [rollingBack, setRollingBack] = useState<number | null>(null);

  const ref = useMemo(
    () => (row ? { kind, namespace: row.namespace, name: row.name } : null),
    [kind, row]
  );

  const load = useCallback(() => {
    if (!ref) return;
    let cancelled = false;
    setRevisions(null);
    setError(null);
    void getProvider()
      .listRevisions(ref)
      .then((items) => {
        if (!cancelled) setRevisions(items);
      })
      .catch((e) => {
        if (!cancelled) {
          setRevisions([]);
          setError(formatError(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ref]);

  useEffect(() => {
    return load();
  }, [load]);

  const rollback = async (toRevision: number) => {
    if (!ref || rollingBack !== null) return;
    setRollingBack(toRevision);
    setError(null);
    try {
      await getProvider().undoRollout(ref, toRevision);
      // Refetch so the rolled-back revision shows as current. The controller
      // creates a new revision for the rollback, so the list will grow by one.
      load();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setRollingBack(null);
    }
  };

  if (!ref) {
    return (
      <div className={styles.empty}>{t('revisions.noSelection', 'No workload selected.')}</div>
    );
  }

  if (revisions === null) {
    return <div className={styles.empty}>{t('revisions.loading', 'Loading history…')}</div>;
  }

  const current = revisions.find((r) => r.isCurrent) ?? revisions[0] ?? null;

  return (
    <div className={styles.wrap}>
      {error && <div className={styles.error}>{error}</div>}

      {/* ---- current image ---- */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>{t('revisions.currentImage', 'Current image')}</h3>
          {!editing && current && current.images.length > 0 && (
            <button type="button" className={styles.linkBtn} onClick={() => setEditing(true)}>
              {t('revisions.editImage', 'Edit image')}
            </button>
          )}
        </div>
        {editing ? (
          <ModifyImageForm
            ref={ref}
            onError={setError}
            onClose={() => {
              setEditing(false);
              load();
            }}
          />
        ) : current ? (
          <ImageList images={current.images} />
        ) : (
          <div className={styles.muted}>{t('revisions.noCurrent', 'No current revision.')}</div>
        )}
      </section>

      {/* ---- revision history ---- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('revisions.history', 'Revision history')}</h3>
        {revisions.length === 0 ? (
          <div className={styles.muted}>
            {t('revisions.empty', 'No revision history (or not readable with current RBAC).')}
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('revisions.col.revision', 'Revision')}</th>
                <th>{t('revisions.col.images', 'Images')}</th>
                <th className={styles.num}>{t('revisions.col.ready', 'Ready')}</th>
                <th>{t('revisions.col.age', 'Age')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((r) => (
                <RevisionRow
                  key={r.revision ?? r.age}
                  rev={r}
                  rollingBack={rollingBack}
                  onRollback={() => rollback(r.revision!)}
                  t={t}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ImageList({ images }: { images: ContainerImage[] }) {
  if (images.length === 0) {
    return <div className={styles.muted}>—</div>;
  }
  return (
    <div className={styles.imageList}>
      {images.map((img) => (
        <div key={img.name} className={styles.imageRow}>
          <span className={styles.imageName}>
            {img.name}
            {img.init && <span className={styles.badge}>init</span>}
          </span>
          <span className={styles.imageValue}>{img.image || '—'}</span>
        </div>
      ))}
    </div>
  );
}

function RevisionRow({
  rev,
  rollingBack,
  onRollback,
  t,
}: {
  rev: Revision;
  rollingBack: number | null;
  onRollback: () => void;
  t: (key: string, ...args: unknown[]) => string;
}) {
  const label = rev.revision ?? '—';
  const busy = rollingBack === rev.revision;
  return (
    <tr className={rev.isCurrent ? styles.currentRow : undefined}>
      <td className={styles.revisionCell}>
        {label}
        {rev.isCurrent && (
          <span className={styles.currentTag}>{t('revisions.current', 'current')}</span>
        )}
      </td>
      <td>
        <div className={styles.cellImages}>
          {rev.images.map((img) => (
            <span key={img.name} className={styles.cellImage} title={img.image}>
              {img.name}: <span className={styles.cellImageValue}>{img.image || '—'}</span>
            </span>
          ))}
          {rev.images.length === 0 && <span className={styles.muted}>—</span>}
        </div>
      </td>
      <td className={styles.num}>
        {rev.ready}/{rev.desired}
      </td>
      <td>{rev.age ? relativeAge(rev.age) : '—'}</td>
      <td>
        {!rev.isCurrent && rev.revision !== null && (
          <button
            type="button"
            className={styles.rollbackBtn}
            disabled={rollingBack !== null}
            onClick={onRollback}
          >
            {busy
              ? t('revisions.rollingBack', 'Rolling back…')
              : t('revisions.rollbackTo', 'Rollback')}
          </button>
        )}
      </td>
    </tr>
  );
}

/** Compact "3m / 1h / 2d" age from an RFC3339 timestamp. */
function relativeAge(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

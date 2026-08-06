/**
 * Rollback form — two variants depending on the resource kind:
 *
 *   • **Helm releases**: fetches revision history, lets the user pick a
 *     target revision, then runs `helm rollback`.
 *   • **Workloads** (Deployment/StatefulSet/DaemonSet): shows a simple
 *     confirm dialog, then calls `undoRollout` (previous revision).
 */

import { useCallback, useEffect, useState } from 'react';
import styles from './ActionList.module.css';
import { formatError, getProvider } from '../../providers';
import { useTranslation } from '../../hooks/useI18n';
import type { KindId, ResourceRef, Row, HelmRevisionEntry } from '../../providers/types';
import { isRolloutKind } from '../../lib/actions';

interface HelmRollbackFormProps {
  kind: KindId;
  row: Row;
  ref: ResourceRef;
  onError: (msg: string | null) => void;
  onClose: () => void;
  /** Called after a successful workload rollback (not Helm — Helm rows persist). */
  onDone: () => void;
}

export function HelmRollbackForm({
  kind,
  row,
  ref: resourceRef,
  onError,
  onClose,
  onDone,
}: HelmRollbackFormProps) {
  const { t: tr } = useTranslation();

  // ---- workload rollback (simple confirm) ----
  if (isRolloutKind(kind)) {
    return (
      <WorkloadRollbackConfirm
        ref={resourceRef}
        name={row.name}
        onError={onError}
        onClose={onClose}
        onDone={onDone}
        tr={tr}
      />
    );
  }

  // ---- Helm release rollback (revision picker) ----
  return <HelmRevisionPicker row={row} onError={onError} onClose={onClose} tr={tr} />;
}

// ---------------------------------------------------------------------------
// Workload rollback — simple confirm
// ---------------------------------------------------------------------------

function WorkloadRollbackConfirm({
  ref: resourceRef,
  name,
  onError,
  onClose,
  onDone,
  tr,
}: {
  ref: ResourceRef;
  name: string;
  onError: (msg: string | null) => void;
  onClose: () => void;
  onDone: () => void;
  tr: (k: string, ...a: unknown[]) => string;
}) {
  const [busy, setBusy] = useState(false);

  const handleRollback = useCallback(async () => {
    setBusy(true);
    onError(null);
    try {
      await getProvider().undoRollout(resourceRef);
      onDone();
      onClose();
    } catch (e) {
      onError(formatError(e));
      setBusy(false);
    }
  }, [resourceRef, onError, onClose, onDone]);

  return (
    <div className={styles.menu}>
      <div className={styles.confirm}>
        <div className={styles.confirmText}>{tr('actions.confirm.rollback', name)}</div>
        <div className={styles.confirmRow}>
          <button
            type="button"
            className={styles.cancelBtn}
            disabled={busy}
            onClick={() => {
              if (!busy) onClose();
            }}
          >
            {tr('chrome.common.cancel')}
          </button>
          <button
            type="button"
            className={styles.applyBtn}
            disabled={busy}
            onClick={() => {
              void handleRollback();
            }}
          >
            {busy
              ? tr('actions.rollbackForm.applying', 'Rolling back…')
              : tr('actions.labels.rollback').replace(/…$/, '').trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helm release rollback — revision history picker
// ---------------------------------------------------------------------------

function HelmRevisionPicker({
  row,
  onError,
  onClose,
  tr,
}: {
  row: Row;
  onError: (msg: string | null) => void;
  onClose: () => void;
  tr: (k: string, ...a: unknown[]) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [revisions, setRevisions] = useState<HelmRevisionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const release = row.name;
  const namespace = row.namespace ?? '';

  // Fetch revision history on mount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getProvider()
      .helmReleaseHistory(release, namespace)
      .then((revs) => {
        if (cancelled) return;
        setRevisions(revs);
        // Default to the second-to-last revision (the one before current).
        if (revs.length >= 2) setSelected(revs[revs.length - 2].revision);
        else if (revs.length === 1) setSelected(revs[0].revision);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(formatError(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [release, namespace]);

  const handleRollback = useCallback(async () => {
    if (selected === null) return;
    setBusy(true);
    onError(null);
    try {
      await getProvider().helmRunOp({
        op: 'rollback',
        args: { release, namespace, revision: selected },
      });
      onClose();
    } catch (e) {
      onError(formatError(e));
      setBusy(false);
    }
  }, [selected, release, namespace, onError, onClose]);

  // Current revision (the latest one).
  const currentRevision = revisions.length > 0 ? revisions[revisions.length - 1].revision : null;

  if (loading) {
    return (
      <div className={styles.menu}>
        <div className={styles.confirm}>
          <div className={styles.confirmText}>{tr('actions.rollbackForm.loadingHistory')}</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.menu}>
        <div className={styles.confirm}>
          <div className={styles.confirmText}>{error}</div>
          <div className={styles.confirmRow}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              {tr('chrome.common.close')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.menu}>
      <div className={styles.confirm}>
        <div className={styles.confirmText}>{tr('actions.rollbackForm.helmTitle', release)}</div>

        {/* Revision table */}
        <div
          style={{
            maxHeight: 220,
            overflowY: 'auto',
            border: '1px solid var(--border-control)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 8,
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
            }}
          >
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 30 }} />
                <th style={thStyle}>#</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Chart</th>
                <th style={thStyle}>Updated</th>
                <th style={thStyle}>Description</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((rev) => {
                const isCurrent = rev.revision === currentRevision;
                const isSelected = rev.revision === selected;
                return (
                  <tr
                    key={rev.revision}
                    style={{
                      cursor: isCurrent ? 'default' : 'pointer',
                      background: isSelected ? 'var(--bg-selected)' : 'transparent',
                      opacity: isCurrent ? 0.5 : 1,
                    }}
                    onClick={() => {
                      if (!isCurrent) setSelected(rev.revision);
                    }}
                  >
                    <td style={tdStyle}>
                      <input
                        type="radio"
                        name="helm-rollback-rev"
                        checked={isSelected}
                        disabled={isCurrent || busy}
                        onChange={() => {
                          if (!isCurrent) setSelected(rev.revision);
                        }}
                        style={{ margin: 0 }}
                      />
                    </td>
                    <td style={tdStyle}>{rev.revision}</td>
                    <td style={tdStyle}>
                      {rev.status}
                      {isCurrent && (
                        <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>(current)</span>
                      )}
                    </td>
                    <td style={tdStyle}>{rev.chart}</td>
                    <td style={tdStyle}>{rev.updated}</td>
                    <td style={tdStyle}>{rev.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={styles.confirmRow}>
          <button
            type="button"
            className={styles.cancelBtn}
            disabled={busy}
            onClick={() => {
              if (!busy) onClose();
            }}
          >
            {tr('chrome.common.cancel')}
          </button>
          <button
            type="button"
            className={styles.applyBtn}
            disabled={busy || selected === null || selected === currentRevision}
            onClick={() => {
              void handleRollback();
            }}
          >
            {busy
              ? tr('actions.rollbackForm.applying', 'Rolling back…')
              : tr('actions.rollbackForm.rollbackTo', `Rollback to #${selected ?? '?'}`)}
          </button>
        </div>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 6px',
  borderBottom: '1px solid var(--border-control)',
  color: 'var(--text-muted)',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '3px 6px',
  borderBottom: '1px solid var(--border-subtle)',
  whiteSpace: 'nowrap',
};

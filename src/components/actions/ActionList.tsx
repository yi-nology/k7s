/**
 * The actions menu contents (B39) — shared by the detail panel's "…" button and
 * the table's row context menu.
 *
 * This is the *whole* menu: the item list, the confirmations, and the two
 * parameterised forms (scale, port-forward). Everything the two surfaces disagree
 * about is left outside — only positioning, which genuinely differs (anchored
 * under a button vs. at the mouse cursor).
 *
 * Splitting it any other way was the trap. If the row menu kept its own copy of
 * the forms, it would quietly not offer Scale on a Deployment, and the two menus
 * would answer "what can I do to this object" differently depending on how you
 * opened them. Which actions exist is decided in one place (lib/actions.ts) and
 * rendered in one place (here).
 */

import { useState } from 'react';
import styles from './ActionList.module.css';
import { useStore } from '../../store';
import { getProvider } from '../../providers';
import { useTranslation } from '../../hooks/useI18n';
import { translate } from '../../lib/i18n';
import { selectorFilter } from '../../lib/filter';
import {
  actionsFor,
  bulkErrorText,
  confirmText,
  isRolloutKind,
  plural,
  runBulk,
  type ActionDef,
  type ActionId,
} from '../../lib/actions';
import type { KindId, ResourceRef, Row } from '../../providers/types';
import { ModifyImageForm } from './ModifyImageForm';
import { HelmRollbackForm } from './HelmRollbackForm';

interface ActionListProps {
  kind: KindId;
  /** What the actions apply to. One row behaves exactly as it always did. */
  rows: Row[];
  /** Report an API error (or null to clear). */
  onError: (msg: string | null) => void;
  /** Close the menu. */
  onClose: () => void;
  /**
   * Called when the acted-on objects are gone (deleted, or a pod restarted into a
   * new name), so the caller can drop a selection that no longer refers to
   * anything. Distinct from onClose: a scale or a cordon leaves the object there.
   */
  onGone: () => void;
}

type Mode = { kind: 'menu' } | { kind: 'confirm'; id: ActionId } | { kind: 'form'; id: ActionId };

/** Replicas shown as the starting value: the desired count from a "3/3" cell. */
function currentReplicas(row: Row): number {
  for (const cell of row.cells) {
    const m = /^(\d+)\/(\d+)$/.exec(cell.text.trim());
    if (m) return Number(m[2]);
  }
  return 1;
}

/** A sensible default port: the service's first, else the usual HTTP guess. */
function defaultPort(row: Row, kind: KindId): number {
  if (kind === 'services') {
    for (const cell of row.cells) {
      const m = /(\d{2,5})/.exec(cell.text);
      if (m) return Number(m[1]);
    }
  }
  return 8080;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard unavailable — the forward still works, it just isn't copied */
  }
}

/**
 * Trigger a browser download of `text` as `filename`. The pod-files panel does
 * the same dance with `URL.createObjectURL` + a synthetic `<a download>` click
 * (B47) — the only client-side save path that works in both the Tauri webview
 * and the `k7s-web` server build without a backend round-trip.
 *
 * Revokes the object URL on the next tick so the click has time to register
 * but the URL doesn't leak. Synchronous click because `URL.revokeObjectURL`
 * is permitted to invalidate the URL immediately after the click handler
 * returns — the browser has already snapshotted the blob reference.
 */
function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/x-yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Filename for a single resource: `kind-namespace-name.yaml` for namespaced
 *  kinds, `kind-name.yaml` for cluster-scoped ones. Mirrors the path scheme
 *  YamlTab uses (kinds.ts), so the file a user downloads matches the path
 *  they see in the Yaml editor. */
function yamlFilename(kind: KindId, row: Row): string {
  return row.namespace ? `${kind}/${row.namespace}/${row.name}.yaml` : `${kind}/${row.name}.yaml`;
}

export function ActionList({ kind, rows, onError, onClose, onGone }: ActionListProps) {
  const setPortForwards = useStore((s) => s.setPortForwards);
  const viewPods = useStore((s) => s.viewPods);
  const openOverlay = useStore((s) => s.openOverlay);
  const { locale, t: tr } = useTranslation();

  // One translator shape that the i18n module and the actions module both
  // understand: takes the locale, the dotted key, and positional args, and
  // returns a string. The action-library functions take this signature; the
  // component uses `tr` for everything else.
  const tx = (l: import('../../lib/i18n').Locale, k: string, ...a: unknown[]) =>
    translate(l, k, ...a);

  const [mode, setMode] = useState<Mode>({ kind: 'menu' });
  const [busy, setBusy] = useState(false);
  const [replicas, setReplicas] = useState(() =>
    currentReplicas(rows[0] ?? ({ cells: [] } as never))
  );
  const [port, setPort] = useState(() => (rows[0] ? defaultPort(rows[0], kind) : 8080));

  const actions = actionsFor(kind, rows, locale, tx);
  if (actions.length === 0) return null;

  const single = rows[0];
  const refOf = (row: Row): ResourceRef => ({ kind, namespace: row.namespace, name: row.name });

  /** Execute an action, then close (or report). `gone` means the objects are no more. */
  async function execute(fn: (row: Row) => Promise<void>, gone: boolean) {
    setBusy(true);
    onError(null);
    try {
      const outcome = await runBulk(rows, fn);
      const err = bulkErrorText(outcome, locale, tx);
      onError(err);
      // Anything that worked is gone even if something else failed, so the
      // selection must still be dropped — leaving it would point at deleted rows.
      if (gone && outcome.ok > 0) onGone();
      if (!err) onClose();
      else setMode({ kind: 'menu' });
    } finally {
      setBusy(false);
    }
  }

  /** Click on a menu item: run it, ask first, or open its form. */
  function pick(action: ActionDef) {
    if (action.mode !== 'immediate') {
      setMode({ kind: action.mode === 'confirm' ? 'confirm' : 'form', id: action.id });
      return;
    }
    switch (action.id) {
      case 'cordon':
        void execute((row) => getProvider().setCordon(row.name, true), false);
        break;
      case 'uncordon':
        void execute((row) => getProvider().setCordon(row.name, false), false);
        break;
      case 'view-pods':
        // Navigation, not a mutation: drop the selector into the filter box as
        // editable text rather than a hidden mode the user can't get out of.
        viewPods(single.namespace, selectorFilter(single.selector ?? {}));
        onClose();
        break;
      case 'download-yaml':
        // Read-only: the action's `gone` is false because nothing is mutated
        // and the provider call doesn't make the row disappear. A failure
        // surfaces through `execute`'s bulk error banner (e.g. RBAC denying
        // get on a Secret the user happens to be able to list).
        void execute(async (row) => {
          const text = await getProvider().getYaml(refOf(row));
          downloadText(yamlFilename(kind, row), text);
        }, false);
        break;
      case 'files':
        openOverlay('pod-files', {
          namespace: single.namespace ?? '',
          name: single.name,
          container: null,
        });
        onClose();
        break;
      case 'edit-ingress':
        // Opens the Ingress editor overlay pre-filled with this row. Mirrors the
        // files/pod-files wiring: a row-scoped overlay launched via overlayPodRef.
        openOverlay('ingress-editor', {
          namespace: single.namespace ?? '',
          name: single.name,
          container: null,
        });
        onClose();
        break;
    }
  }

  /** Run a confirmed action. */
  function confirmed(id: ActionId) {
    switch (id) {
      case 'delete':
        void execute((row) => getProvider().deleteResource(refOf(row)), true);
        break;
      case 'restart':
        // A restarted pod is deleted and recreated under a new name, so it's gone
        // from this table; a rolled workload keeps its identity.
        void execute(
          (row) =>
            isRolloutKind(kind)
              ? getProvider().restartRollout(refOf(row))
              : getProvider().restartPod(refOf(row)),
          !isRolloutKind(kind)
        );
        break;
      case 'rollback':
        // Rollback is now handled through the form path (HelmRollbackForm).
        // This case is unreachable but kept for type completeness.
        break;
      case 'drain':
        // Resolves once cordoned; the eviction progress streams to the banner.
        void execute((row) => getProvider().drainNode(row.name), false);
        break;
    }
  }

  // ---- confirmations ----
  if (mode.kind === 'confirm') {
    const danger = actions.find((a) => a.id === mode.id)?.danger;
    return (
      <div className={styles.menu}>
        <div className={styles.confirm}>
          <div className={styles.confirmText}>{confirmText(mode.id, kind, rows, locale, tx)}</div>
          <div className={styles.confirmRow}>
            <button
              type="button"
              className={styles.cancelBtn}
              disabled={busy}
              onClick={() => {
                if (busy) return;
                setMode({ kind: 'menu' });
              }}
            >
              {tr('chrome.common.cancel')}
            </button>
            <button
              type="button"
              className={danger ? styles.dangerBtn : styles.applyBtn}
              disabled={busy}
              onClick={() => {
                if (busy) return;
                confirmed(mode.id);
              }}
            >
              {busy ? tr('actions.confirming', '…') : confirmLabel(mode.id, locale)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- scale ----
  if (mode.kind === 'form' && mode.id === 'scale') {
    return (
      <div className={styles.menu}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            void execute((row) => getProvider().scaleResource(refOf(row), replicas), false);
          }}
        >
          <div className={styles.confirm}>
            <div className={styles.confirmText}>{tr('actions.scaleForm.title', single.name)}</div>
            <div className={styles.confirmRow} style={{ justifyContent: 'center', gap: 10 }}>
              <button
                type="button"
                className={styles.cancelBtn}
                disabled={busy || replicas <= 0}
                onClick={() => {
                  if (busy) return;
                  setReplicas((n) => Math.max(0, n - 1));
                }}
              >
                −
              </button>
              <input
                type="number"
                min={0}
                value={replicas}
                disabled={busy}
                onChange={(e) => {
                  // The browser will show an empty string on invalid input; keep
                  // the local state numeric (and non-negative) so the next Apply
                  // can't go to k8s with `replicas: NaN`.
                  const n = Number.parseInt(e.target.value, 10);
                  setReplicas(Number.isNaN(n) ? 0 : Math.max(0, n));
                }}
                style={{
                  background: 'var(--bg-terminal)',
                  border: '1px solid var(--border-control)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-body)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  padding: '4px 8px',
                  width: 64,
                  textAlign: 'center',
                }}
              />
              <button
                type="button"
                className={styles.cancelBtn}
                disabled={busy}
                onClick={() => {
                  if (busy) return;
                  setReplicas((n) => n + 1);
                }}
              >
                +
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {tr('actions.scaleForm.replicasLabel', 'replicas')}
              </span>
            </div>
            <div className={styles.confirmRow}>
              <button
                type="button"
                className={styles.cancelBtn}
                disabled={busy}
                onClick={() => {
                  if (busy) return;
                  setMode({ kind: 'menu' });
                }}
              >
                {tr('chrome.common.cancel')}
              </button>
              <button type="submit" className={styles.applyBtn} disabled={busy}>
                {busy ? tr('actions.scaleForm.applying', 'Applying…') : tr('chrome.common.apply')}
              </button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  // ---- port-forward ----
  if (mode.kind === 'form' && mode.id === 'forward') {
    return (
      <div className={styles.menu}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            void execute(async (row) => {
              const fwd = await getProvider().startPortForward(refOf(row), port);
              setPortForwards(await getProvider().listPortForwards());
              await copyToClipboard(`localhost:${fwd.localPort}`);
            }, false);
          }}
        >
          <div className={styles.confirm}>
            <div className={styles.confirmText}>
              {tr(
                kind === 'services'
                  ? 'actions.forwardForm.titleService'
                  : 'actions.forwardForm.titlePod'
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                min={1}
                max={65535}
                value={port}
                disabled={busy}
                onChange={(e) => {
                  // Browser gives us "" for invalid / cleared input; clamp to a
                  // safe sentinel so the form's Apply can't send `NaN` to the
                  // backend. The user can re-type a real value before submitting.
                  const n = Number.parseInt(e.target.value, 10);
                  if (Number.isNaN(n)) {
                    setPort(1);
                    return;
                  }
                  setPort(Math.max(1, Math.min(65535, n)));
                }}
                style={{
                  background: 'var(--bg-terminal)',
                  border: '1px solid var(--border-control)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-body)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  padding: '4px 8px',
                  width: 80,
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {tr('actions.forwardForm.portLabel', 'port')}
              </span>
            </div>
            <div className={styles.confirmRow}>
              <button
                type="button"
                className={styles.cancelBtn}
                disabled={busy}
                onClick={() => {
                  if (busy) return;
                  setMode({ kind: 'menu' });
                }}
              >
                {tr('chrome.common.cancel')}
              </button>
              <button type="submit" className={styles.applyBtn} disabled={busy}>
                {busy
                  ? tr('actions.forwardForm.applying', 'Forwarding…')
                  : tr('actions.forwardForm.apply')}
              </button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  // ---- modify-image (Bxx) ----
  // Routes the form-mode "modify-image" action into its own component.
  // The form fetches the YAML on mount, lets the user pick a new
  // image:tag per container, and applies via the existing
  // `dryRunYaml` → `applyYaml` path. See ModifyImageForm.tsx.
  if (mode.kind === 'form' && mode.id === 'modify-image') {
    return <ModifyImageForm ref={refOf(single)} onError={onError} onClose={onClose} />;
  }

  // ---- rollback ----
  // Routes to HelmRollbackForm which handles both Helm releases
  // (revision history picker) and workloads (simple confirm + undoRollout).
  if (mode.kind === 'form' && mode.id === 'rollback') {
    return (
      <HelmRollbackForm
        kind={kind}
        row={single}
        ref={refOf(single)}
        onError={onError}
        onClose={onClose}
        onDone={onGone}
      />
    );
  }

  // ---- the menu ----
  const safe = actions.filter((a) => !a.danger);
  const dangerous = actions.filter((a) => a.danger);

  return (
    <div className={styles.menu}>
      {rows.length > 1 && (
        <div className={styles.scope}>
          {tr('actions.scope', rows.length, plural(kind, rows.length))}
        </div>
      )}
      {safe.map((a) => (
        <button key={a.id} type="button" className={styles.row} onClick={() => pick(a)}>
          {a.label}
        </button>
      ))}
      {safe.length > 0 && dangerous.length > 0 && <div className={styles.separator} />}
      {dangerous.map((a) => (
        <button
          key={a.id}
          type="button"
          className={`${styles.row} ${styles.danger}`}
          onClick={() => pick(a)}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

/** The confirm button's verb — the menu label minus its trailing ellipsis. */
function confirmLabel(id: ActionId, locale: import('../../lib/i18n').Locale): string {
  const dict: Record<ActionId, string> = {
    'view-pods': 'actions.labels.viewPods',
    forward: 'actions.labels.forward',
    scale: 'actions.labels.scale',
    restart: 'actions.labels.restart',
    rollback: 'actions.labels.rollback',
    cordon: 'actions.labels.cordon',
    uncordon: 'actions.labels.uncordon',
    drain: 'actions.labels.drain',
    delete: 'actions.labels.delete',
    'download-yaml': 'actions.labels.downloadYaml',
    'modify-image': 'actions.labels.modifyImage',
    files: 'actions.labels.files',
    'edit-ingress': 'actions.labels.editIngress',
  };
  return translate(locale, dict[id]).replace(/…$/, '').trim();
}

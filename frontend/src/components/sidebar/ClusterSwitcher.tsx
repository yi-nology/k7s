/**
 * Cluster switcher (Design §1, top of the sidebar). Shows the active cluster with
 * an initials badge and a live connection status line, and opens a dropdown of
 * kubeconfig contexts. Selecting one triggers the connect flow.
 */

import { useRef, useState } from 'react';
import styles from './Sidebar.module.css';
import { useStore } from '../../store';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useTranslation } from '../../hooks/useI18n';
import { connectTo } from '../../lib/connect';
import { cx } from '../../lib/cx';
import { importKubeconfigViaInput, KubeconfigImportError } from '../../providers';
import { getErrorReporter, getSuccessReporter } from '../../providers/errorHandler';
import type { ImportResult } from '../../providers/types';
import { useConnection } from '../../hooks/useStoreHooks';

/** First two letters of the cluster name, uppercased ("FR" for "murphy-yi"). */
function initials(name: string): string {
  return name.slice(0, 2).toUpperCase() || 'K7';
}

export function ClusterSwitcher() {
  const connection = useConnection();
  const clusterStatus = useStore((s) => s.clusterStatus);
  const contexts = useStore((s) => s.contexts);
  const open = useStore((s) => s.openMenu === 'cluster');
  const toggleMenu = useStore((s) => s.toggleMenu);
  const closeMenus = useStore((s) => s.closeMenus);
  const setContexts = useStore((s) => s.setContexts);
  const addImportedFile = useStore((s) => s.addImportedFile);
  const { t } = useTranslation();
  // When the connect fails, the status line becomes clickable to expand the
  // error detail (and a Retry button). Collapsed again once the user reconnects.
  const [errorExpanded, setErrorExpanded] = useState(false);
  const hasError = connection.phase === 'error' && connection.error;

  const ref = useRef<HTMLDivElement>(null);
  // A long-lived hidden file input. We `click()` it directly from the
  // import button's onClick so the user-gesture chain is a single frame
  // (no `await` in between). Spinning up a fresh input per click used
  // to silently no-op in Safari because the gesture was lost across the
  // Promise boundary.
  const fileInputRef = useRef<HTMLInputElement>(null);
  useClickOutside(ref, closeMenus, open);

  // Import contexts from a kubeconfig file (native picker), then merge them into
  // the switcher list. A null result means the user cancelled the dialog.
  //
  // The user-gesture contract: this function is the onClick handler, and
  // every line in it runs on the same gesture frame. We register the
  // change listener and call `input.click()` back-to-back with no
  // `await` between them — that's what makes Safari reliably pop the
  // system picker. The fetch happens later inside the change handler.
  const onImport = () => {
    closeMenus();
    const input = fileInputRef.current;
    if (!input) return;
    const promise = importKubeconfigViaInput(input).then((result: ImportResult | null) => {
      if (!result) return;
      setContexts(result.contexts);
      // Remember the file so its contexts come back on the next launch (B17).
      addImportedFile(result.path);
      // Advisory warnings — the import succeeded, but the user should know
      // what the validator flagged (e.g. https without a CA bundle).
      if (result.issues?.length) {
        getSuccessReporter()(
          t('chrome.sidebar.importKubeconfig'),
          t('onboarding.import.importedWithWarnings', 'Imported, with warnings') +
            ' — ' +
            result.issues.map((i) => i.message).join(' · ')
        );
      }
    });
    // The click() that opens the OS picker is part of the same user
    // gesture as the button click — no `await` before it.
    input.click();
    // Rejections are real API failures. The toast reporter is the visible
    // channel (the menu just closed); console stays for diagnosis.
    void promise.catch((e: unknown) => {
      console.error('[import] failed:', e);
      const detail =
        e instanceof KubeconfigImportError && e.issues?.length
          ? e.issues.map((i) => i.message).join(' · ')
          : e instanceof Error
            ? e.message
            : String(e);
      getErrorReporter()(t('chrome.sidebar.importFailed', 'Import kubeconfig failed'), detail);
    });
  };

  // Display name: the connected cluster, else the selected context, else a stub.
  const name =
    connection.clusterName ?? connection.context ?? t('chrome.clusterSwitcher.noCluster');

  // Status line: dot color + text reflect the connection lifecycle.
  const { dotColor, statusText } = statusDisplay(connection.phase, clusterStatus?.version, t);

  return (
    <div className={styles.switcher} ref={ref}>
      <button type="button" className={styles.switcherButton} onClick={() => toggleMenu('cluster')}>
        <div className={styles.badge}>{initials(name)}</div>
        <div className={styles.switcherText}>
          <div className={styles.clusterName} title={name}>
            {name}
          </div>
          <div className={styles.statusLine}>
            <span className={styles.dot} style={{ background: dotColor }} />
            {/* statusText can be long on real clusters (e.g. "connected · v1.30.0-alpha.1+abcdef").
                Wrapped in a span so the flex child can shrink and ellipsis; the
                full text is surfaced on hover so the version isn't lost. */}
            <span className={styles.statusText} title={statusText}>
              {statusText}
            </span>
          </div>
        </div>
        <span className={styles.chevron}>▼</span>
      </button>

      {/* Connection error detail — only when the last connect failed. The red
          dot on the status line is easy to miss; this makes the reason (and a
          one-click Retry) reachable without leaving the sidebar. */}
      {hasError && (
        <div className={styles.errorDetail}>
          <button
            type="button"
            className={styles.errorHeader}
            onClick={() => setErrorExpanded((v) => !v)}
            aria-expanded={errorExpanded}
          >
            <span aria-hidden="true">{errorExpanded ? '▾' : '▸'}</span>
            <span>{t('chrome.clusterSwitcher.errorDetails')}</span>
          </button>
          {errorExpanded && (
            <div className={styles.errorBody}>
              <div className={styles.errorText} title={connection.error}>
                {connection.error}
              </div>
              <button
                type="button"
                className={styles.retryBtn}
                onClick={() => {
                  setErrorExpanded(false);
                  if (connection.context) void connectTo(connection.context);
                }}
              >
                ↻ {t('chrome.clusterSwitcher.retry')}
              </button>
            </div>
          )}
        </div>
      )}

      {open && (
        <div className={styles.menu}>
          {contexts.map((ctx) => {
            const isCurrent = ctx.name === connection.context;
            return (
              <button
                key={ctx.name}
                type="button"
                className={cx(styles.menuRow, isCurrent && styles.menuRowActive)}
                onClick={() => {
                  closeMenus();
                  // No-op if re-selecting the already-connected context.
                  if (!isCurrent) void connectTo(ctx.name);
                }}
              >
                <span
                  className={styles.dot}
                  style={{ background: isCurrent ? 'var(--status-ok)' : 'var(--dot-inactive)' }}
                />
                <span className={styles.menuName}>{ctx.name}</span>
                <span className={styles.menuEnv}>{ctx.cluster}</span>
              </button>
            );
          })}
          {contexts.length === 0 && (
            <div className={styles.menuRow}>
              <span className={styles.menuName} style={{ color: 'var(--text-faint)' }}>
                {t('chrome.sidebar.noContexts')}
              </span>
            </div>
          )}

          {/* Import action, separated from the context list. */}
          <div className={styles.menuDivider} />
          <button type="button" className={styles.menuRow} onClick={() => void onImport()}>
            <span className={styles.importIcon}>＋</span>
            <span className={styles.menuName}>{t('chrome.sidebar.importKubeconfig')}</span>
          </button>
        </div>
      )}

      {/*
        The file picker. We keep one input in the React tree for the
        lifetime of the switcher and click() it from the import button
        so the user-gesture chain is unbroken. Hidden offscreen but
        connected, so Safari will actually pop the system dialog.
        accept is a hint, not a filter — kubeconfigs are sometimes
        named `config` with no extension.
      */}
      <input
        ref={fileInputRef}
        type="file"
        data-testid="kubeconfig-file-input"
        style={{
          position: 'fixed',
          left: -9999,
          top: 0,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

/** Map connection phase → status dot color + text (with version when connected). */
function statusDisplay(
  phase: 'idle' | 'connecting' | 'connected' | 'error',
  version: string | undefined,
  t: (key: string, ...args: unknown[]) => string
): { dotColor: string; statusText: string } {
  switch (phase) {
    case 'connected':
      return {
        dotColor: 'var(--status-ok)',
        statusText: t('chrome.clusterSwitcher.connected', version),
      };
    case 'connecting':
      return { dotColor: 'var(--status-warn)', statusText: t('chrome.clusterSwitcher.connecting') };
    default:
      return {
        dotColor: 'var(--status-err)',
        statusText: t('chrome.clusterSwitcher.disconnected'),
      };
  }
}

/**
 * Shell tab (B4, B19): an interactive terminal (xterm) attached to the selected
 * pod's container via the backend exec session.
 *
 * Enhanced with TerminalToolbar: font size, search, clear, reconnect.
 */

import { useEffect, useState } from 'react';
import styles from './ShellTab.module.css';
import { useStore } from '../../store';
import { formatError, getProvider } from '../../providers';
import { useTranslation } from '../../hooks/useI18n';
import { useTerminal } from './useTerminal';
import { TerminalToolbar } from './TerminalToolbar';
import type { ShellHandle } from '../../providers/types';

export function ShellTab() {
  const pod = useStore((s) => s.selectedRow);
  const { t } = useTranslation();

  const containers = pod?.pod?.containers ?? [];

  // The tab's own container choice, defaulting to the first.
  const [container, setContainer] = useState('');
  useEffect(() => {
    setContainer(containers[0] ?? '');
    // Only on pod change: `containers` is a fresh array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pod?.uid]);

  // Why the session ended, or null while it's live.
  const [ended, setEnded] = useState<string | null>(null);
  // Bumping this re-runs the session effect against the same terminal.
  const [attempt, setAttempt] = useState(0);

  const { hostRef, termRef, sessionRef, searchRef } = useTerminal(
    pod && container ? `${pod.uid}:${container}` : null
  );

  // ---- the session ----
  useEffect(() => {
    const term = termRef.current;
    if (!term || !pod || !container) return;

    setEnded(null);
    let handle: ShellHandle | null = null;
    let cancelled = false;
    let dataSub: { dispose(): void } | null = null;

    void getProvider()
      .startShell(
        { kind: 'pods', namespace: pod.namespace, name: pod.name },
        container,
        (data) => term.write(data),
        (reason) => {
          if (!cancelled) setEnded(reason || t('shell.endedFallback', 'session ended'));
        }
      )
      .then((h) => {
        if (cancelled) {
          h.stop();
          return;
        }
        handle = h;
        sessionRef.current = h;
        dataSub = term.onData((d) => h.input(d));
        h.resize(term.cols, term.rows);
      })
      .catch((e) => {
        const msg = formatError(e);
        term.write(`\r\n\x1b[31m${msg}\x1b[0m\r\n`);
        if (!cancelled) setEnded(msg);
      });

    return () => {
      cancelled = true;
      dataSub?.dispose();
      handle?.stop();
      sessionRef.current = null;
    };
  }, [pod, container, attempt, termRef, sessionRef, t]);

  const reconnect = () => {
    termRef.current?.write('\r\n\x1b[90m── reconnecting ──\x1b[0m\r\n');
    setAttempt((n) => n + 1);
  };

  return (
    <div className={styles.wrap}>
      <TerminalToolbar
        status={ended ? 'ended' : 'live'}
        statusText={ended ?? undefined}
        containers={containers}
        currentContainer={container}
        onContainerChange={setContainer}
        termRef={termRef}
        searchRef={searchRef}
        onReconnect={reconnect}
        canReconnect={!!ended}
      />

      <div className={styles.shell} ref={hostRef} />

      {ended !== null && (
        <div className={styles.endedBar}>
          <span className={styles.endedReason}>{ended}</span>
          <button
            type="button"
            className={styles.reconnect}
            onClick={reconnect}
            title={t('shell.reconnectTitle')}
          >
            {t('shell.reconnect', '↻ reconnect')}
          </button>
        </div>
      )}
    </div>
  );
}

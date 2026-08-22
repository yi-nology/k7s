/**
 * Node debug shell tab (B53) — a root shell on the selected node's host OS.
 *
 * Unlike the pod Shell tab, this one does **not** connect when you open it. It
 * shows what the session would do and waits for an explicit click.
 *
 * That gate is the point, not politeness. Opening this session creates a
 * privileged pod on the node and escapes into the host's namespaces — root on the
 * machine, outside any container boundary. The detail tabs are cyclable with
 * `[`/`]`, so an auto-connecting tab would mean tabbing past a node silently
 * provisions a privileged pod. Explicit consent also gives somewhere honest to say
 * what's about to happen, rather than burying it in a doc nobody reads.
 *
 * Once running it behaves like any other terminal, sharing the terminal plumbing
 * with the pod shell (see useTerminal).
 */

import { useEffect, useRef, useState } from 'react';
import styles from './ShellTab.module.css';
import nodeStyles from './NodeShellTab.module.css';
import { useStore } from '../../store';
import { formatError, getProvider } from '../../providers';
import { useTranslation } from '../../hooks/useI18n';
import { useTerminal } from './useTerminal';
import { TerminalToolbar } from './TerminalToolbar';
import type { NodeShellHandle } from '../../providers/types';

type Phase =
  | { state: 'idle' }
  | { state: 'starting' }
  | { state: 'running'; pod: string }
  | { state: 'ended'; reason: string; pod?: string };

export function NodeShellTab() {
  const row = useStore((s) => s.selectedRow);
  const node = row?.name ?? null;
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>({ state: 'idle' });
  const handleRef = useRef<NodeShellHandle | null>(null);
  const dataSubRef = useRef<{ dispose(): void } | null>(null);
  // The terminal exists only once a session has been asked for; keying on the node
  // means switching nodes tears the old one down.
  const started = phase.state !== 'idle';
  const { hostRef, termRef, sessionRef, searchRef } = useTerminal(started && node ? node : null);

  // Switching nodes must not leave the previous node's session running — it's a
  // privileged pod, and "out of sight" is the worst way for one to be still alive.
  useEffect(() => {
    return () => {
      dataSubRef.current?.dispose();
      dataSubRef.current = null;
      handleRef.current?.stop();
      handleRef.current = null;
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]);

  useEffect(() => {
    setPhase({ state: 'idle' });
  }, [node]);

  if (!node) return null;

  const start = async () => {
    setPhase({ state: 'starting' });
    try {
      const handle = await getProvider().startNodeShell(
        node,
        (data) => termRef.current?.write(data),
        (reason) => {
          setPhase((p) => ({
            state: 'ended',
            reason: reason || t('nodeShell.endedFallback', 'session ended'),
            pod: p.state === 'running' ? p.pod : undefined,
          }));
        }
      );
      handleRef.current = handle;
      sessionRef.current = handle;
      setPhase({ state: 'running', pod: handle.pod });
      // The terminal mounts in the same commit that sets "starting", so it exists
      // by now; wire keystrokes and sync the size.
      const term = termRef.current;
      if (term) {
        // Dispose any previous subscription before creating a new one.
        dataSubRef.current?.dispose();
        dataSubRef.current = term.onData((d) => handle.input(d));
        handle.resize(term.cols, term.rows);
      }
    } catch (e) {
      const msg = formatError(e);
      // Straight to the panel, not the terminal: a start failure usually means no
      // terminal ever appeared, and the backend's message (NotReady node, image
      // pull) is the actionable part.
      setPhase({ state: 'ended', reason: msg });
    }
  };

  const stop = () => {
    dataSubRef.current?.dispose();
    dataSubRef.current = null;
    handleRef.current?.stop();
    handleRef.current = null;
    sessionRef.current = null;
    setPhase({ state: 'ended', reason: t('nodeShell.closedFallback', 'session closed') });
  };

  if (phase.state === 'idle') {
    return (
      <div className={nodeStyles.gate}>
        <div className={nodeStyles.gateTitle}>{t('nodeShell.title', node)}</div>
        <div className={nodeStyles.gateBody}>{t('nodeShell.body', node)}</div>
        <ul className={nodeStyles.gateList}>
          <li>{t('nodeShell.podDeletedOnClose')}</li>
          <li>{t('nodeShell.expiresAfterHour')}</li>
          <li>{t('nodeShell.changesAreReal')}</li>
        </ul>
        <button type="button" className={nodeStyles.gateAction} onClick={() => void start()}>
          {t('nodeShell.startBtn', 'Start debug session')}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <TerminalToolbar
        status={
          phase.state === 'starting' ? 'connecting' :
          phase.state === 'running' ? 'live' : 'ended'
        }
        statusText={
          phase.state === 'starting' ? t('nodeShell.starting', 'starting debug pod…') :
          phase.state === 'ended' ? phase.reason :
          phase.state === 'running' ? `${node} (${phase.pod})` : undefined
        }
        termRef={termRef}
        searchRef={searchRef}
        canReconnect={false}
        onEndSession={phase.state === 'running' ? stop : undefined}
      />

      <div className={styles.shell} ref={hostRef} />

      {phase.state === 'ended' && (
        <div className={styles.endedBar}>
          <span className={styles.endedReason}>{phase.reason}</span>
          <span
            className={styles.reconnect}
            onClick={() => setPhase({ state: 'idle' })}
            title={t('nodeShell.backTitle')}
          >
            {t('nodeShell.startAgain', '↻ start again')}
          </span>
        </div>
      )}
    </div>
  );
}

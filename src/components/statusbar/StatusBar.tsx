/**
 * Status bar (Design §5): connection indicator, API latency, nodes ready, cluster
 * CPU/MEM %, and the active kubectl context. Values come from `cluster-status`;
 * CPU/MEM show "—" when metrics are unavailable.
 *
 * v2 — every fact is a labeled "key value" pair with the value in the strong
 * text color, separated by a faint middle dot. Reads as a single row of
 * cluster facts rather than a wall of labels.
 *
 * i18n — every label is `chrome.statusbar.<key>` (string leaf). The dict
 * used to ship function-shaped keys (`api: (ms) => "api: ${ms}ms"`) that
 * no call site ever used; the StatusBar rendered raw English "api" /
 * "nodes" / "ready" / "cpu" / "mem" / "kubectl ctx:" labels. Pre-fix
 * zh leaked the same English labels — the bottom strip of every zh
 * session said "api 24ms  nodes 2/3 ready  cpu 12%  mem 38%  kubectl ctx: …".
 */

import React from 'react';
import styles from './StatusBar.module.css';
import { useStore } from '../../store';
import { useTranslation } from '../../hooks/useI18n';

export function StatusBar() {
  const connection = useStore((s) => s.connection);
  const status = useStore((s) => s.clusterStatus);
  const { t } = useTranslation();

  const connected = connection.phase === 'connected';
  const cluster = connection.clusterName ?? connection.context ?? 'k7s';
  const ctx = connection.context ?? null;

  // Percent values render "—" when metrics are absent (null).
  const cpu = status?.cpuPercent ?? null;
  const mem = status?.memPercent ?? null;
  const ready = status?.nodesReady ?? 0;
  const total = status?.nodesTotal ?? 0;
  const api = status ? status.apiLatencyMs : null;

  return (
    <div className={styles.statusbar} role="status" aria-label={t('chrome.statusbar.ariaLabel', 'Cluster status')}>
      <span className={styles.cluster}>
        <span
          className={styles.clusterDot}
          style={{ background: connected ? 'var(--status-ok)' : 'var(--status-err)' }}
        />
        {cluster}
      </span>
      <Sep />
      <span className={styles.fact}>
        {t('chrome.statusbar.api')} <b>{api == null ? '—' : `${api}ms`}</b>
      </span>
      <Sep />
      <span className={styles.fact}>
        {t('chrome.statusbar.nodes')}{' '}
        <b>
          {ready}/{total}
        </b>{' '}
        {t('chrome.statusbar.ready')}
      </span>
      <Sep />
      <span className={styles.fact}>
        {t('chrome.statusbar.cpu')} <b>{cpu == null ? '—' : `${cpu}%`}</b>
      </span>
      <Sep />
      <span className={styles.fact}>
        {t('chrome.statusbar.mem')} <b>{mem == null ? '—' : `${mem}%`}</b>
      </span>
      <div className={styles.spacer} />
      <span className={styles.ctx}>
        {t('chrome.statusbar.kubectlCtx')} <b>{ctx ?? '—'}</b>
      </span>
    </div>
  );
}

/** Middle-dot separator between facts. Memoized: renders many times with no props. */
const Sep = React.memo(function Sep() {
  return <span className={styles.sep}>·</span>;
});

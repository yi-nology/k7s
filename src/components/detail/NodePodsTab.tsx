/**
 * NodePodsTab — the "Pods" tab on a node's detail panel.
 *
 * Answers "what's eating this node's CPU/memory?": lists every pod scheduled on
 * the selected node with its live usage (from the same metrics-server feed the
 * Dashboard's cluster totals use), sorted by CPU descending so the noisiest
 * tenant is on top. Click a pod to jump to it.
 *
 * Pure front-end — no fetch. `rows.pods` already carries each pod's `.node`,
 * and `podMetrics` is keyed by `namespace/name`, so the tab is just a join of
 * two store slices filtered to the selected node.
 */
import { useMemo } from 'react';
import { useStore } from '../../store';
import { useTranslation } from '../../hooks/useI18n';
import { formatCpu, formatMem } from '../../lib/format';
import type { PodMetrics, Row } from '../../providers/types';
import styles from './NodePodsTab.module.css';

export function NodePodsTab() {
  const { t } = useTranslation();
  const row = useStore((s) => s.selectedRow);
  const allPods = useStore((s) => s.rows.pods);
  const podMetrics = useStore((s) => s.podMetrics);
  const navigateTo = useStore((s) => s.navigateTo);

  const nodeName = row?.name ?? '';

  // Join pods-on-this-node with their metrics. Sorted by CPU desc so the
  // heaviest consumer is first — that's the diagnostic question this tab exists
  // to answer. A pod with no metrics (just scheduled, not yet scraped) sorts to
  // the bottom via the 0 fallback.
  const pods = useMemo(() => {
    const onNode = allPods.filter((p) => p.pod?.node === nodeName);
    return onNode
      .map((p) => {
        const key = p.namespace ? `${p.namespace}/${p.name}` : p.name;
        const m = podMetrics[key];
        return { pod: p, metrics: m, cpuMillis: m?.cpuMillis ?? 0 };
      })
      .sort((a, b) => b.cpuMillis - a.cpuMillis);
  }, [allPods, podMetrics, nodeName]);

  // Cluster totals for the summary strip — sum across the node's pods.
  const totals = useMemo(() => {
    let cpu = 0;
    let mem = 0;
    for (const { metrics } of pods) {
      if (metrics) {
        cpu += metrics.cpuMillis;
        mem += metrics.memBytes;
      }
    }
    return { cpu, mem, count: pods.length };
  }, [pods]);

  if (!nodeName) {
    return <div className={styles.empty}>{t('nodePods.noNode', 'No node selected.')}</div>;
  }

  if (pods.length === 0) {
    return (
      <div className={styles.empty}>{t('nodePods.empty', 'No pods scheduled on this node.')}</div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.summary}>
        {totals.count} {t('nodePods.pods', 'pods')} ·{' '}
        <span className={styles.summaryMetric}>Σ CPU {formatCpu(totals.cpu)}</span>
        {' · '}
        <span className={styles.summaryMetric}>Σ MEM {formatMem(totals.mem)}</span>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t('nodePods.col.namespace', 'Namespace')}</th>
            <th>{t('nodePods.col.pod', 'Pod')}</th>
            <th>{t('nodePods.col.status', 'Status')}</th>
            <th className={styles.num}>{t('nodePods.col.cpu', 'CPU')}</th>
            <th className={styles.num}>{t('nodePods.col.memory', 'Memory')}</th>
            <th className={styles.num}>{t('nodePods.col.restarts', 'Restarts')}</th>
          </tr>
        </thead>
        <tbody>
          {pods.map(({ pod, metrics }) => (
            <PodRow
              key={pod.uid ?? pod.name}
              pod={pod}
              metrics={metrics}
              onJump={() => navigateTo({ kind: 'pods', namespace: pod.namespace, name: pod.name })}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PodRow({
  pod,
  metrics,
  onJump,
}: {
  pod: Row;
  metrics: PodMetrics | undefined;
  onJump: () => void;
}) {
  // map_pod cells: [NAME, READY, RESTARTS, CPU(—), MEM(—), STATUS]. We take
  // status/ready from PodMeta when present (more reliable than the cell text)
  // and restarts from the cell.
  const cells = pod.cells;
  const ready = pod.pod?.ready ?? cells[1]?.text ?? '';
  const status = pod.pod?.status ?? cells[5]?.text ?? '';
  const restarts = cells[2]?.text ?? '0';
  const cpu = metrics ? formatCpu(metrics.cpuMillis) : '—';
  const mem = metrics ? formatMem(metrics.memBytes) : '—';
  const warn = status === 'CrashLoopBackOff' || status === 'Error' || status === 'Failed';

  return (
    <tr>
      <td className={styles.ns}>{pod.namespace ?? ''}</td>
      <td>
        <button type="button" className={styles.podLink} onClick={onJump} title={pod.name}>
          {pod.name}
        </button>
      </td>
      <td className={warn ? styles.statusWarn : styles.status}>{status || ready}</td>
      <td className={styles.num}>{cpu}</td>
      <td className={styles.num}>{mem}</td>
      <td className={styles.num}>{restarts}</td>
    </tr>
  );
}

/**
 * TopologyInspector -- the right-side detail panel for the selected node.
 * Extracted from TopologyGraph for cohesion: all inspector rendering lives
 * here; the graph component only passes state + the navigate callback.
 */

import { useTranslation } from '../../hooks/useI18n';
import type { GraphNode } from './types';
import { resolveNodeId } from './constants';
import styles from './TopologyGraph.module.css';

export interface TopologyInspectorProps {
  node: GraphNode;
  nodes: GraphNode[];
  links: { source: string | GraphNode; target: string | GraphNode }[];
  podMetrics: Record<string, { cpuMillis: number; memBytes: number }>;
  onNavigate: (node: GraphNode) => void;
  onClose: () => void;
}

export function TopologyInspector({
  node,
  nodes,
  links,
  podMetrics,
  onNavigate,
  onClose,
}: TopologyInspectorProps) {
  const { t } = useTranslation();

  const metricsRow = (key: string) => {
    const m = podMetrics[key];
    if (!m) return null;
    return (
      <div className={styles.inspectorRow}>
        CPU: {(m.cpuMillis / 1000).toFixed(2)}c &middot; MEM: {(m.memBytes / 1024 / 1024).toFixed(0)}
        Mi
      </div>
    );
  };

  return (
    <div className={styles.inspector}>
      <div className={styles.inspectorHeader}>
        <span className={styles.inspectorTitle}>{node.label}</span>
        <span
          className={styles.statusDot}
          style={{
            background: node.unhealthy
              ? 'var(--status-err, #ef4444)'
              : node.meta[0] === 'Running' || node.meta[0] === 'Succeeded'
                ? 'var(--status-ok, #34d399)'
                : 'var(--text-muted, #64748b)',
          }}
        />
      </div>
      <div className={styles.inspectorMeta}>
        <span className={styles.inspectorKind}>{node.kind}</span>
        {node.namespace && <span className={styles.inspectorNs}>{node.namespace}</span>}
      </div>
      <div className={styles.inspectorDivider} />
      {node.meta.map((m, i) => (
        <div key={i} className={styles.inspectorRow}>
          {m}
        </div>
      ))}
      {node.kind === 'pod' && node.restarts > 0 && (
        <div className={styles.inspectorRow}>
          Restarts: <strong style={{ color: 'var(--status-err, #ef4444)' }}>{node.restarts}</strong>
        </div>
      )}
      {node.kind === 'pod' && metricsRow(`${node.namespace}/${node.label}`)}
      {node.kind === 'service' && (
        <div className={styles.inspectorLinks}>
          {nodes
            .filter((n) =>
              links.some((l) => {
                const sid = resolveNodeId(l.source);
                const tid = resolveNodeId(l.target);
                return (sid === node.id && tid === n.id) || (tid === node.id && sid === n.id);
              })
            )
            .slice(0, 5)
            .map((n) => (
              <span key={n.id} className={styles.inspectorLink} onClick={() => onNavigate(n)}>
                {n.kind}: {n.label}
              </span>
            ))}
        </div>
      )}
      <div className={styles.inspectorActions}>
        <button className={styles.actionBtn} onClick={() => onNavigate(node)}>
          {t('topology.action.navigate', 'Navigate')}
        </button>
        {node.kind === 'pod' && (
          <button className={styles.actionBtn} onClick={() => onNavigate(node)}>
            {t('topology.action.logs', 'Logs')}
          </button>
        )}
        {node.kind === 'pod' && (
          <button className={styles.actionBtn} onClick={() => onNavigate(node)}>
            {t('topology.action.shell', 'Shell')}
          </button>
        )}
        <button className={styles.actionBtn} onClick={() => onNavigate(node)}>
          {t('topology.action.yaml', 'YAML')}
        </button>
      </div>
      <button className={styles.inspectorClose} onClick={onClose}>
        &times;
      </button>
    </div>
  );
}

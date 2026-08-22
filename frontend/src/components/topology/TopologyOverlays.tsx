/**
 * TopologyOverlays -- non-SVG chrome: hover tooltip, context menu, and the
 * kind legend. Rendering only; state and callbacks come from the graph.
 */

import { useTranslation } from '../../hooks/useI18n';
import type { GraphNode } from './types';
import { KIND_COLORS } from './constants';
import styles from './TopologyGraph.module.css';

export interface TooltipState {
  x: number;
  y: number;
  node: { label: string; kind: string; namespace: string; meta: string[] };
}

export interface ContextMenuState {
  x: number;
  y: number;
  node: GraphNode;
}

export interface TopologyOverlaysProps {
  tooltip: TooltipState | null;
  dragging: boolean;
  podMetrics: Record<string, { cpuMillis: number; memBytes: number }>;
  contextMenu: ContextMenuState | null;
  onNavigate: (node: GraphNode) => void;
  onCloseContextMenu: () => void;
}

export function TopologyOverlays({
  tooltip,
  dragging,
  podMetrics,
  contextMenu,
  onNavigate,
  onCloseContextMenu,
}: TopologyOverlaysProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Tooltip */}
      {tooltip && !dragging && (
        <div className={styles.tooltip} style={{ left: tooltip.x, top: tooltip.y }}>
          <div className={styles.tooltipName}>{tooltip.node.label}</div>
          <div className={styles.tooltipMeta}>
            {tooltip.node.kind} &middot; {tooltip.node.namespace || 'cluster-scoped'}
          </div>
          {tooltip.node.meta.map((m, i) => (
            <div key={i} className={styles.tooltipRow}>
              {m}
            </div>
          ))}
          {tooltip.node.kind === 'pod' &&
            (() => {
              const key = `${tooltip.node.namespace}/${tooltip.node.label}`;
              const m = podMetrics[key];
              if (!m) return null;
              return (
                <div className={styles.tooltipRow}>
                  CPU: {(m.cpuMillis / 1000).toFixed(2)}c &middot; MEM:{' '}
                  {(m.memBytes / 1024 / 1024).toFixed(0)}Mi
                </div>
              );
            })()}
          {tooltip.node.kind === 'service' && (
            <div className={styles.tooltipRow}>
              {tooltip.node.meta[0]} &middot; {tooltip.node.meta[1]}
            </div>
          )}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div className={styles.contextMenu} style={{ left: contextMenu.x, top: contextMenu.y }}>
          <div
            className={styles.contextItem}
            onClick={() => {
              onNavigate(contextMenu.node);
              onCloseContextMenu();
            }}
          >
            {t('topology.ctx.navigate', 'Navigate to resource')}
          </div>
          {contextMenu.node.kind === 'pod' && (
            <div
              className={styles.contextItem}
              onClick={() => {
                onNavigate(contextMenu.node);
                onCloseContextMenu();
              }}
            >
              {t('topology.ctx.logs', 'View Logs')}
            </div>
          )}
          {contextMenu.node.kind === 'pod' && (
            <div
              className={styles.contextItem}
              onClick={() => {
                onNavigate(contextMenu.node);
                onCloseContextMenu();
              }}
            >
              {t('topology.ctx.shell', 'Shell')}
            </div>
          )}
          <div
            className={styles.contextItem}
            onClick={() => {
              onNavigate(contextMenu.node);
              onCloseContextMenu();
            }}
          >
            {t('topology.ctx.yaml', 'View YAML')}
          </div>
          <div
            className={styles.contextItem}
            onClick={() => {
              navigator.clipboard?.writeText(contextMenu.node.label);
              onCloseContextMenu();
            }}
          >
            {t('topology.ctx.copy', 'Copy name')}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className={styles.legend}>
        {(Object.keys(KIND_COLORS) as Array<keyof typeof KIND_COLORS>).map((k) => (
          <span key={k} className={styles.legendItem}>
            <span className={styles.dot} style={{ background: KIND_COLORS[k] }} />
            {t(`topology.legend.${k}`, k)}
          </span>
        ))}
      </div>
    </>
  );
}

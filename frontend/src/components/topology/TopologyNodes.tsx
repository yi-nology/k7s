/**
 * TopologyNodes -- node glyphs (shape, selection/hover rings, restart badge)
 * and node labels. Rendering only; interaction handlers are passed through
 * from the graph component.
 */

import type React from 'react';
import type { GraphNode } from './types';
import { NODE_RADIUS } from './constants';
import { NodeShape } from './nodeShapes';
import styles from './TopologyGraph.module.css';

export interface TopologyNodesProps {
  nodes: GraphNode[];
  selected: string | null;
  hover: string | null;
  connectedNodeIds: Set<string>;
  dragging: boolean;
  onClick: (n: GraphNode, e: React.MouseEvent) => void;
  onDoubleClick: (n: GraphNode, e: React.MouseEvent) => void;
  onContextMenu: (n: GraphNode, e: React.MouseEvent) => void;
  onMouseEnter: (n: GraphNode, e: React.MouseEvent) => void;
  onMouseMove: (n: GraphNode, e: React.MouseEvent) => void;
  onMouseLeave: (e: React.MouseEvent) => void;
  onDragStart: (n: GraphNode, e: React.MouseEvent) => void;
}

export function TopologyNodes({
  nodes,
  selected,
  hover,
  connectedNodeIds,
  dragging,
  onClick,
  onDoubleClick,
  onContextMenu,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  onDragStart,
}: TopologyNodesProps) {
  return (
    <>
      {nodes.map((n, i) => {
        const nx = n.x;
        const ny = n.y;
        if (nx == null || ny == null) return null;
        const isSelected = selected === n.id;
        const isHoverNode = hover === n.id;
        const isConnected = hover != null && connectedNodeIds.has(n.id);
        const dimmed = n._dimmed || (hover != null && !isConnected && hover !== n.id);

        return (
          <g
            key={n.id}
            className={styles.node}
            transform={`translate(${nx},${ny})`}
            onClick={(e) => onClick(n, e)}
            onDoubleClick={(e) => onDoubleClick(n, e)}
            onContextMenu={(e) => onContextMenu(n, e)}
            onMouseEnter={(e) => onMouseEnter(n, e)}
            onMouseMove={(e) => onMouseMove(n, e)}
            onMouseLeave={onMouseLeave}
            onMouseDown={(e) => onDragStart(n, e)}
            style={{
              cursor: dragging ? 'grabbing' : 'pointer',
              opacity: dimmed ? 0.12 : 1,
              transition: 'opacity 0.2s ease',
            }}
          >
            <g className={styles.nodeEnter} style={{ animationDelay: `${i * 20}ms` }}>
              {/* Selection ring */}
              {isSelected && (
                <circle
                  r={NODE_RADIUS[n.kind] + 6}
                  fill="none"
                  stroke="var(--accent, #6366f1)"
                  strokeWidth={2.5}
                  opacity={0.5}
                  className={styles.focusGlow}
                />
              )}
              {/* Hover ring */}
              {isHoverNode && !isSelected && (
                <circle
                  r={NODE_RADIUS[n.kind] + 4}
                  fill="none"
                  stroke="var(--accent, #6366f1)"
                  strokeWidth={1.5}
                  opacity={0.3}
                />
              )}
              <NodeShape node={n} />
              {/* Restart count badge */}
              {n.kind === 'pod' && n.restarts > 0 && (
                <>
                  <circle
                    cx={NODE_RADIUS[n.kind] - 2}
                    cy={-NODE_RADIUS[n.kind] + 2}
                    r={7}
                    fill="#ef4444"
                    stroke="#fff"
                    strokeWidth={1}
                  />
                  <text
                    x={NODE_RADIUS[n.kind] - 2}
                    y={-NODE_RADIUS[n.kind] + 5}
                    textAnchor="middle"
                    fontSize={8}
                    fill="#fff"
                    fontWeight="bold"
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.restarts > 9 ? '9+' : String(n.restarts)}
                  </text>
                </>
              )}
            </g>
          </g>
        );
      })}

      {/* Node labels */}
      {nodes.map((n) => {
        const nx = n.x;
        const ny = n.y;
        if (nx == null || ny == null) return null;
        const dimmed =
          n._dimmed || (hover != null && !connectedNodeIds.has(n.id) && hover !== n.id);
        const r = NODE_RADIUS[n.kind];
        return (
          <foreignObject
            key={`label:${n.id}`}
            x={nx - 80}
            y={ny + r + 4}
            width={160}
            height={20}
            style={{ pointerEvents: 'none', overflow: 'visible' }}
          >
            <div className={styles.nodeLabel} style={{ opacity: dimmed ? 0.1 : 1 }}>
              {n.label}
            </div>
          </foreignObject>
        );
      })}
    </>
  );
}

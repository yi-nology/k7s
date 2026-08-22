/**
 * TopologyEdges -- curved edges between nodes, with hover highlight and
 * the "flow" dash animation for service/ingress edges. Rendering only;
 * geometry math stays here because it is pure per-edge calculation.
 */

import type { GraphNode, GraphLink } from './types';
import { NODE_RADIUS, getX, getY, resolveNode } from './constants';

export interface TopologyEdgesProps {
  links: GraphLink[];
  nodeMap: Map<string, GraphNode>;
  hover: string | null;
  connectedLinkIndices: Set<number>;
}

export function TopologyEdges({ links, nodeMap, hover, connectedLinkIndices }: TopologyEdgesProps) {
  return (
    <>
      {links.map((l, i) => {
        const srcNode = resolveNode(l.source, nodeMap);
        const tgtNode = resolveNode(l.target, nodeMap);
        if (
          !srcNode ||
          !tgtNode ||
          srcNode.x == null ||
          srcNode.y == null ||
          tgtNode.x == null ||
          tgtNode.y == null
        )
          return null;

        const dimmed = srcNode._dimmed || tgtNode._dimmed;
        const isHighlight = hover != null && connectedLinkIndices.has(i);
        const isFlow = srcNode.kind === 'service' || srcNode.kind === 'ingress';

        const sx = getX(srcNode);
        const sy = getY(srcNode);
        const tx = getX(tgtNode);
        const ty = getY(tgtNode);
        const mx = (sx + tx) / 2;
        const my = (sy + ty) / 2;
        const dx = tx - sx;
        const dy = ty - sy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const curveOffset = len * 0.15;
        const cpx = mx + (-dy / len) * curveOffset;
        const cpy = my + (dx / len) * curveOffset;

        const tRadius = NODE_RADIUS[tgtNode.kind] || 14;
        const t = Math.max(0.05, 1 - tRadius / len);
        const endX = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cpx + t * t * tx;
        const endY = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cpy + t * t * ty;

        return (
          <path
            key={i}
            d={`M${sx},${sy} Q${cpx},${cpy} ${endX},${endY}`}
            fill="none"
            stroke={isHighlight ? 'var(--accent, #6366f1)' : 'var(--border, #334155)'}
            strokeWidth={isHighlight ? 2 : 1}
            opacity={dimmed ? 0.05 : isHighlight ? 0.9 : 0.4}
            markerEnd={isHighlight ? 'url(#arrowhead-hi)' : 'url(#arrowhead)'}
            strokeDasharray={isFlow ? '6 4' : undefined}
            style={isFlow && !dimmed ? { animation: 'flowDash 0.8s linear infinite' } : undefined}
          />
        );
      })}
    </>
  );
}

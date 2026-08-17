/**
 * SVG node shape components for the topology graph.
 */

import type { GraphNode } from './types';
import { KIND_COLORS, STATUS_COLORS } from './constants';
import styles from './TopologyGraph.module.css';

/** Rounded rectangle with gradient fill for Service nodes. */
export function ServiceShape({ unhealthy }: { unhealthy: boolean }) {
  const w = 36,
    h = 24;
  return (
    <>
      <defs>
        <linearGradient id="svcGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={unhealthy ? '#ef4444' : '#818cf8'} />
          <stop offset="100%" stopColor={unhealthy ? '#dc2626' : '#6366f1'} />
        </linearGradient>
      </defs>
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={6}
        fill="url(#svcGrad)"
        stroke={unhealthy ? '#b91c1c' : '#4f46e5'}
        strokeWidth={1.5}
        className={styles.nodeShadow}
      />
    </>
  );
}

/** Circle with status-based fill color for Pod nodes. */
export function PodShape({ unhealthy, status }: { unhealthy: boolean; status: string }) {
  const r = 14;
  const fill = STATUS_COLORS[status] || (unhealthy ? '#ef4444' : KIND_COLORS.pod);
  return (
    <circle
      r={r}
      fill={fill}
      stroke={unhealthy ? '#b91c1c' : '#059669'}
      strokeWidth={1.5}
      className={styles.nodeShadow}
    />
  );
}

/** Rotated square (diamond) for Endpoint nodes. */
export function EndpointShape({ unhealthy }: { unhealthy: boolean }) {
  const s = 10;
  return (
    <rect
      x={-s}
      y={-s}
      width={s * 2}
      height={s * 2}
      transform="rotate(45)"
      fill={unhealthy ? '#ef4444' : KIND_COLORS.endpoint}
      stroke={unhealthy ? '#b91c1c' : '#0ea5e9'}
      strokeWidth={1.5}
      className={styles.nodeShadow}
    />
  );
}

/** Hexagon for Ingress nodes. */
export function IngressShape({ unhealthy }: { unhealthy: boolean }) {
  const r = 16;
  const pts = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    return `${r * Math.cos(angle)},${r * Math.sin(angle)}`;
  }).join(' ');
  return (
    <polygon
      points={pts}
      fill={unhealthy ? '#ef4444' : KIND_COLORS.ingress}
      stroke={unhealthy ? '#b91c1c' : '#d97706'}
      strokeWidth={1.5}
      className={styles.nodeShadow}
    />
  );
}

/** Dispatch to the correct shape component based on node kind. */
export function NodeShape({ node }: { node: GraphNode }) {
  switch (node.kind) {
    case 'service':
      return <ServiceShape unhealthy={node.unhealthy} />;
    case 'pod':
      return <PodShape unhealthy={node.unhealthy} status={node.meta[0] || 'Unknown'} />;
    case 'endpoint':
      return <EndpointShape unhealthy={node.unhealthy} />;
    case 'ingress':
      return <IngressShape unhealthy={node.unhealthy} />;
  }
}

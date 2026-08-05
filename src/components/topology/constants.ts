/**
 * Constants and utility functions for the topology graph.
 */

import type { GraphNode, NodeKind } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const KIND_COLORS: Record<NodeKind, string> = {
  ingress: '#f59e0b',
  service: '#6366f1',
  endpoint: '#5cc8ff',
  pod: '#34d399',
};

export const STATUS_COLORS: Record<string, string> = {
  Running: '#34d399',
  Succeeded: '#34d399',
  Pending: '#fbbf24',
  Failed: '#ef4444',
  Unknown: '#94a3b8',
};

export const NODE_RADIUS: Record<NodeKind, number> = {
  service: 18,
  pod: 14,
  endpoint: 10,
  ingress: 16,
};

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;
export const NS_PADDING = 50;
export const TOOLTIP_OFFSET = 16;
export const MINIMAP_SIZE = 180;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function resolveNodeId(v: string | GraphNode): string {
  return typeof v === 'string' ? v : v.id;
}

export function resolveNode(v: string | GraphNode, map: Map<string, GraphNode>): GraphNode | undefined {
  const id = typeof v === 'string' ? v : v.id;
  return map.get(id);
}

export function getX(n: GraphNode): number {
  return n.x ?? 0;
}

export function getY(n: GraphNode): number {
  return n.y ?? 0;
}

/** Build a rounded-rect path for a bounding box of points. */
export function buildNsRegionPath(points: { x: number; y: number }[], padding: number): string {
  if (points.length === 0) return '';
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x = minX - padding;
  const y = minY - padding;
  const w = maxX - minX + padding * 2;
  const h = maxY - minY + padding * 2;
  const r = 16;
  return `M${x + r},${y} h${w - 2 * r} q${r},0 ${r},${r} v${h - 2 * r} q0,${r} -${r},${r} h-${w - 2 * r} q-${r},0 -${r},-${r} v-${h - 2 * r} q0,-${r} ${r},-${r} Z`;
}

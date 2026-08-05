/**
 * Type definitions for the topology graph.
 */

import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';

export type NodeKind = 'service' | 'endpoint' | 'pod' | 'ingress';

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  kind: NodeKind;
  label: string;
  namespace: string;
  meta: string[];
  unhealthy: boolean;
  restarts: number;
  /** Whether this node is dimmed by search filter. Set at runtime. */
  _dimmed?: boolean;
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

export interface ClusterGraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface TopologyGraphProps {
  /** Service id ("svc:ns/name") to highlight and center. */
  focusedService?: string | null;
  /** Substring filter for node names. */
  searchQuery?: string;
  /** Called when health counts change. */
  onHealthChange?: (h: {
    total: number;
    healthy: number;
    unhealthy: number;
    unknown: number;
  }) => void;
}

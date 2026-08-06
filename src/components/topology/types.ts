/**
 * Type definitions for the topology graph.
 */

import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';

/** The four node types rendered in the topology graph. */
export type NodeKind = 'service' | 'endpoint' | 'pod' | 'ingress';

/** A node in the topology graph, extended with d3-force simulation fields. */
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

/** An edge between two nodes in the topology graph. */
export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

/** The complete graph data structure returned by {@link buildGraph}. */
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

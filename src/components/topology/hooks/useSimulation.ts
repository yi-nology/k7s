/**
 * Hook for d3-force simulation management.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from 'd3-force';
import type { GraphLink, GraphNode } from '../types';
import { buildGraph } from '../graphBuilder';

export function useSimulation(rows: Record<string, unknown>) {
  const simRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const nodeMapRef = useRef<Map<string, GraphNode>>(new Map());
  const [graphKey, setGraphKey] = useState(0);

  // Initialize simulation (runs once).
  useEffect(() => {
    const sim = forceSimulation<GraphNode>(nodesRef.current)
      .force('charge', forceManyBody<GraphNode>().strength(-300).distanceMax(400))
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(linksRef.current)
          .id((d: GraphNode) => d.id)
          .distance(80)
          .strength(0.4)
      )
      .force('center', forceCenter(400, 300))
      .force('x', forceX(400).strength(0.04))
      .force('y', forceY(300).strength(0.04))
      .alphaDecay(0.02)
      .alphaMin(0.001)
      .on('tick', () => {
        setGraphKey((k) => k + 1);
      });
    simRef.current = sim;

    // Build initial graph.
    buildGraph(rows as Parameters<typeof buildGraph>[0]).then(({ nodes, links }) => {
      nodesRef.current = nodes;
      linksRef.current = links;
      nodeMapRef.current = new Map(nodes.map((n) => [n.id, n]));
      sim.nodes(nodes);
      (sim.force('link') as ReturnType<typeof forceLink<GraphNode, GraphLink>>).links(links);
      sim.alpha(0.8).restart();
    });

    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild graph when data changes.
  const rebuildGraph = useCallback(async () => {
    const { nodes, links } = await buildGraph(rows as Parameters<typeof buildGraph>[0]);
    nodesRef.current = nodes;
    linksRef.current = links;
    nodeMapRef.current = new Map(nodes.map((n) => [n.id, n]));
    const sim = simRef.current;
    if (sim) {
      sim.nodes(nodes);
      (sim.force('link') as ReturnType<typeof forceLink<GraphNode, GraphLink>>).links(links);
      sim.alpha(0.5).restart();
    }
  }, [rows]);

  useEffect(() => {
    rebuildGraph();
  }, [rebuildGraph]);

  return {
    simRef,
    nodesRef,
    linksRef,
    nodeMapRef,
    graphKey,
  };
}

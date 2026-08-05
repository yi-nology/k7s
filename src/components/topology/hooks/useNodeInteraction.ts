/**
 * Hook for node interaction (drag, click, hover, context menu).
 */

import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { Simulation } from 'd3-force';
import type { GraphNode, GraphLink } from '../types';
import { TOOLTIP_OFFSET } from '../constants';
import { useStore } from '../../../store';

export function useNodeInteraction(
  containerRef: React.RefObject<HTMLDivElement | null>,
  simRef: React.RefObject<Simulation<GraphNode, GraphLink> | null>,
  nodeMapRef: React.RefObject<Map<string, GraphNode>>,
  viewTransform: { k: number; x: number; y: number }
) {
  const navigateTo = useStore((s) => s.navigateTo);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    node: GraphNode;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: GraphNode;
  } | null>(null);
  const nodeDragRef = useRef<{
    active: boolean;
    nodeId: string;
  } | null>(null);

  // Navigation helper.
  const handleNavigate = useCallback(
    (node: GraphNode) => {
      if (node.kind === 'service') {
        navigateTo({
          kind: 'services',
          namespace: node.namespace,
          name: node.label,
        });
      } else if (node.kind === 'pod') {
        navigateTo({
          kind: 'pods',
          namespace: node.namespace,
          name: node.label,
        });
      } else if (node.kind === 'ingress') {
        navigateTo({
          kind: 'ingresses',
          namespace: node.namespace,
          name: node.label,
        });
      }
    },
    [navigateTo]
  );

  // Node drag handlers.
  const handleNodeDragStart = useCallback((node: GraphNode, e: ReactMouseEvent) => {
    e.stopPropagation();
    const sim = simRef.current;
    if (sim) sim.alphaTarget(0.3).restart();
    nodeDragRef.current = { active: true, nodeId: node.id };
    node.fx = node.x ?? null;
    node.fy = node.y ?? null;
    setDragging(true);
  }, [simRef]);

  const handleNodeDragMove = useCallback((e: ReactMouseEvent) => {
    if (!nodeDragRef.current?.active) return false;
    const el = containerRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const graphX = (mx - viewTransform.x) / viewTransform.k;
    const graphY = (my - viewTransform.y) / viewTransform.k;
    const node = nodeMapRef.current.get(nodeDragRef.current.nodeId);
    if (node) {
      node.fx = graphX;
      node.fy = graphY;
    }
    return true;
  }, [containerRef, nodeMapRef, viewTransform]);

  const handleNodeDragEnd = useCallback(() => {
    if (!nodeDragRef.current?.active) return;
    const node = nodeMapRef.current.get(nodeDragRef.current.nodeId);
    if (node) {
      node.fx = null;
      node.fy = null;
    }
    nodeDragRef.current = null;
    setDragging(false);
    const sim = simRef.current;
    if (sim) sim.alphaTarget(0);
  }, [nodeMapRef, simRef]);

  // Node event handlers.
  const handleNodeClick = useCallback((node: GraphNode, e: ReactMouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => (prev === node.id ? null : node.id));
  }, []);

  const handleNodeDoubleClick = useCallback(
    (node: GraphNode, e: ReactMouseEvent) => {
      e.stopPropagation();
      handleNavigate(node);
    },
    [handleNavigate]
  );

  const handleNodeContextMenu = useCallback((node: GraphNode, e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setContextMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      node,
    });
  }, [containerRef]);

  const handleNodeMouseEnter = useCallback((node: GraphNode, e: ReactMouseEvent) => {
    setHover(node.id);
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setTooltip({
      x: e.clientX - rect.left + TOOLTIP_OFFSET,
      y: e.clientY - rect.top - TOOLTIP_OFFSET,
      node,
    });
  }, [containerRef]);

  const handleNodeMouseMove = useCallback((node: GraphNode, e: ReactMouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setTooltip((prev) =>
      prev && prev.node.id === node.id
        ? {
            ...prev,
            x: e.clientX - rect.left + TOOLTIP_OFFSET,
            y: e.clientY - rect.top - TOOLTIP_OFFSET,
          }
        : prev
    );
  }, [containerRef]);

  const handleNodeMouseLeave = useCallback(() => {
    setHover(null);
    setTooltip(null);
  }, []);

  const handleCanvasClick = useCallback(() => {
    setSelected(null);
    setContextMenu(null);
  }, []);

  const handleCanvasContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    setContextMenu(null);
  }, []);

  return {
    selected,
    setSelected,
    hover,
    dragging,
    tooltip,
    contextMenu,
    setContextMenu,
    handleNavigate,
    handleNodeDragStart,
    handleNodeDragMove,
    handleNodeDragEnd,
    handleNodeClick,
    handleNodeDoubleClick,
    handleNodeContextMenu,
    handleNodeMouseEnter,
    handleNodeMouseMove,
    handleNodeMouseLeave,
    handleCanvasClick,
    handleCanvasContextMenu,
  };
}

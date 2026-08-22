/**
 * TopologyGraph -- interactive d3-force topology view of the
 * Ingress -> Service -> EndpointSlice -> Pod graph.
 *
 * Composition root: owns the store subscriptions, simulation/zoom/interaction
 * hooks, and search state. Rendering lives in TopologyEdges / TopologyNodes /
 * TopologyOverlays / TopologyInspector.
 */

import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '../../hooks/useI18n';
import type { TopologyGraphProps, GraphNode } from './types';
import { KIND_COLORS, MINIMAP_SIZE, clamp, resolveNodeId, buildNsRegionPath, NS_PADDING } from './constants';
import { useSimulation } from './hooks/useSimulation';
import { useZoomPan } from './hooks/useZoomPan';
import { useNodeInteraction } from './hooks/useNodeInteraction';
import { TopologyEdges } from './TopologyEdges';
import { TopologyNodes } from './TopologyNodes';
import { TopologyOverlays } from './TopologyOverlays';
import { TopologyInspector } from './TopologyInspector';
import styles from './TopologyGraph.module.css';

export function TopologyGraph({ focusedService, searchQuery, onHealthChange, onMatchInfoChange, navigateMatch }: TopologyGraphProps) {
  const { t } = useTranslation();
  // The graph only reads services + pods + ingresses (see graphBuilder.ts),
  // so subscribe to those three kinds (shallow-compared) instead of the whole
  // rows map. Re-assembled into the { kind → Row[] } shape useSimulation expects.
  const rows = useStore(
    useShallow((s) => ({
      services: s.rows.services ?? [],
      pods: s.rows.pods ?? [],
      ingresses: s.rows.ingresses ?? [],
    }))
  );
  const podMetrics = useStore((s) => s.podMetrics);
  const containerRef = useRef<HTMLDivElement>(null);

  const { simRef, nodesRef, linksRef, nodeMapRef, graphKey } = useSimulation(rows);

  const nodes = nodesRef.current;
  const links = linksRef.current;
  const nodeMap = nodeMapRef.current;

  const { graphBounds, healthyCount, unhealthyCount, unknownCount } = useMemo(() => {
    // graphKey changes when the simulation graph changes — reading it here
    // establishes the dependency so the memo recomputes on graph updates.
    void graphKey;
    const currentNodes = nodesRef.current;
    let bMinX = Infinity,
      bMinY = Infinity,
      bMaxX = -Infinity,
      bMaxY = -Infinity;
    let hc = 0,
      uc = 0,
      okc = 0;

    for (const n of currentNodes) {
      const nx = n.x;
      const ny = n.y;
      if (nx != null && ny != null) {
        if (nx < bMinX) bMinX = nx;
        if (ny < bMinY) bMinY = ny;
        if (nx > bMaxX) bMaxX = nx;
        if (ny > bMaxY) bMaxY = ny;
      }
      if (n.unhealthy) uc++;
      else if (n.meta[0] === 'Running' || n.meta[0] === 'Succeeded') hc++;
      else okc++;
    }
    if (!isFinite(bMinX)) {
      bMinX = 0;
      bMinY = 0;
      bMaxX = 800;
      bMaxY = 500;
    }

    return {
      graphBounds: {
        minX: bMinX - 50,
        minY: bMinY - 50,
        maxX: bMaxX + 50,
        maxY: bMaxY + 50,
      },
      healthyCount: hc,
      unhealthyCount: uc,
      unknownCount: okc,
    };
  }, [graphKey, nodesRef]);

  const {
    viewTransform,
    setViewTransform,
    containerSize,
    fitToGraph,
    handleWheel,
    startPan,
    handlePanMove,
    handlePanEnd,
    handleFit,
    handleZoomIn,
    handleZoomOut,
    handleMinimapClick,
  } = useZoomPan(containerRef, graphBounds);

  const {
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
  } = useNodeInteraction(containerRef, simRef, nodeMapRef, viewTransform);

  // Search match tracking.
  const [matchIndices, setMatchIndices] = useState<GraphNode[]>([]);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(-1);

  // Zoom to center on a specific node.
  const focusOnNode = useCallback(
    (node: GraphNode) => {
      if (node.x == null || node.y == null) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const scale = 1.5;
      setViewTransform({
        x: cx - node.x * scale,
        y: cy - node.y * scale,
        k: scale,
      });
    },
    [setViewTransform]
  );

  // Navigation between search matches.
  const goToMatch = useCallback(
    (idx: number) => {
      if (matchIndices.length === 0) return;
      const wrapped =
        ((idx % matchIndices.length) + matchIndices.length) % matchIndices.length;
      setCurrentMatchIdx(wrapped);
      const node = matchIndices[wrapped];
      focusOnNode(node);
      setSelected(node.id);
      onMatchInfoChange?.(matchIndices.length, wrapped);
    },
    [matchIndices, focusOnNode, setSelected, onMatchInfoChange]
  );

  // Expose navigation to parent via ref.
  useEffect(() => {
    if (navigateMatch) {
      navigateMatch.current = (dir: 'next' | 'prev') => {
        if (matchIndices.length === 0) return;
        const delta = dir === 'next' ? 1 : -1;
        goToMatch(currentMatchIdx + delta);
      };
    }
    return () => {
      if (navigateMatch) navigateMatch.current = null;
    };
  }, [navigateMatch, goToMatch, currentMatchIdx, matchIndices.length]);

  // Sync focusedService.
  useEffect(() => {
    if (!focusedService) return;
    let node = nodeMapRef.current.get(focusedService);
    if (!node) {
      node = nodesRef.current.find(
        (n) => n.label === focusedService || `svc:${n.namespace}/${n.label}` === focusedService
      );
    }
    if (!node || node.x == null || node.y == null) return;
    setSelected(node.id);
    // Future: center view on the node using setViewTransform
  }, [focusedService, nodeMapRef, nodesRef, setSelected]);

  // Apply search filter with broader matching (label, namespace, kind, meta).
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (!searchQuery || searchQuery.trim() === '') {
      for (const n of nodesRef.current) {
        n._dimmed = false;
      }
      setMatchIndices([]);
      setCurrentMatchIdx(-1);
      onMatchInfoChange?.(0, -1);
      return;
    }
    const q = searchQuery.trim().toLowerCase();
    const matches: GraphNode[] = [];
    for (const n of nodesRef.current) {
      const match =
        n.label.toLowerCase().includes(q) ||
        n.namespace.toLowerCase().includes(q) ||
        n.kind.toLowerCase().includes(q) ||
        n.meta.some((m) => m.toLowerCase().includes(q));
      n._dimmed = !match;
      if (match) matches.push(n);
    }
    setMatchIndices(matches);
    const newIdx = matches.length > 0 ? 0 : -1;
    setCurrentMatchIdx(newIdx);
    onMatchInfoChange?.(matches.length, newIdx);
    if (matches.length > 0) {
      sim.alpha(0.3).restart();
    }
  }, [searchQuery, simRef, nodesRef, onMatchInfoChange]);

  // Auto-fit.
  useEffect(() => {
    fitToGraph();
  }, [graphKey, graphBounds, nodes.length, fitToGraph]);

  // Report health changes.
  useEffect(() => {
    onHealthChange?.({
      total: healthyCount + unhealthyCount + unknownCount,
      healthy: healthyCount,
      unhealthy: unhealthyCount,
      unknown: unknownCount,
    });
  }, [healthyCount, unhealthyCount, unknownCount, onHealthChange]);

  // Namespace groups.
  const nsGroups = new Map<string, { x: number; y: number }[]>();
  for (const n of nodes) {
    if (!n.namespace || n.x == null || n.y == null) continue;
    if (n._dimmed) continue;
    const arr = nsGroups.get(n.namespace) ?? [];
    arr.push({ x: n.x, y: n.y });
    nsGroups.set(n.namespace, arr);
  }

  // Connected nodes for hover highlight.
  const connectedNodeIds = new Set<string>();
  const connectedLinkIndices = new Set<number>();
  if (hover) {
    connectedNodeIds.add(hover);
    for (let i = 0; i < links.length; i++) {
      const l = links[i];
      const sid = resolveNodeId(l.source);
      const tid = resolveNodeId(l.target);
      if (sid === hover || tid === hover) {
        connectedNodeIds.add(sid);
        connectedNodeIds.add(tid);
        connectedLinkIndices.add(i);
      }
    }
  }

  // Selected node for inspector.
  const selectedNode = selected ? nodeMap.get(selected) : null;

  // Minimap calculations.
  const bw = graphBounds.maxX - graphBounds.minX;
  const bh = graphBounds.maxY - graphBounds.minY;
  const minimapScale = MINIMAP_SIZE / Math.max(bw, bh, 1);

  const vpX = (-viewTransform.x / viewTransform.k - graphBounds.minX) * minimapScale;
  const vpY = (-viewTransform.y / viewTransform.k - graphBounds.minY) * minimapScale;
  const vpW = (containerSize.w / viewTransform.k) * minimapScale;
  const vpH = (containerSize.h / viewTransform.k) * minimapScale;

  const transformStr = `translate(${viewTransform.x},${viewTransform.y}) scale(${viewTransform.k})`;

  // Combined mouse handlers.
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as SVGElement;
      if (target.tagName !== 'svg' && !target.closest('[class*="canvas"]')) return;
      if (target.closest('[class*="node"]')) return;
      startPan(e);
    },
    [startPan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (handlePanMove(e)) return;
      handleNodeDragMove(e);
    },
    [handlePanMove, handleNodeDragMove]
  );

  const handleMouseUp = useCallback(() => {
    handlePanEnd();
    handleNodeDragEnd();
  }, [handlePanEnd, handleNodeDragEnd]);

  // Render.
  return (
    <div className={styles.wrap} ref={containerRef} onContextMenu={handleCanvasContextMenu}>
      <div className={styles.canvas}>
        {/* Zoom controls */}
        <div className={styles.zoomControls}>
          <button
            className={styles.zoomBtn}
            onClick={handleZoomIn}
            title={t('topology.zoom.in', 'Zoom in')}
          >
            +
          </button>
          <button
            className={styles.zoomBtn}
            onClick={handleZoomOut}
            title={t('topology.zoom.out', 'Zoom out')}
          >
            -
          </button>
          <button
            className={styles.zoomBtn}
            onClick={handleFit}
            title={t('topology.zoom.fit', 'Fit')}
          >
            {t('topology.zoom.fit', 'Fit')}
          </button>
        </div>

        {/* Main SVG */}
        <svg
          width="100%"
          height="100%"
          onClick={handleCanvasClick}
          onContextMenu={handleCanvasContextMenu}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        >
          <defs>
            <marker
              id="arrowhead"
              viewBox="0 -5 10 10"
              refX={10}
              refY={0}
              markerWidth={8}
              markerHeight={8}
              orient="auto"
            >
              <path d="M0,-4L10,0L0,4" fill="var(--border, #334155)" opacity={0.6} />
            </marker>
            <marker
              id="arrowhead-hi"
              viewBox="0 -5 10 10"
              refX={10}
              refY={0}
              markerWidth={8}
              markerHeight={8}
              orient="auto"
            >
              <path d="M0,-4L10,0L0,4" fill="var(--accent, #6366f1)" />
            </marker>
            <style>{`@keyframes flowDash { to { stroke-dashoffset: -20; } }`}</style>
          </defs>

          <g transform={transformStr}>
            {/* Namespace regions */}
            {[...nsGroups.entries()].map(([ns, points]) => {
              const path = buildNsRegionPath(points, NS_PADDING);
              if (!path) return null;
              const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
              const cy = Math.min(...points.map((p) => p.y)) - NS_PADDING - 6;
              return (
                <g key={`ns:${ns}`}>
                  <path
                    d={path}
                    fill="rgba(99,102,241,0.04)"
                    stroke="var(--border, #334155)"
                    strokeWidth={0.5}
                    strokeDasharray="6 4"
                  />
                  <text
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--text-muted, #64748b)"
                    opacity={0.6}
                    style={{ pointerEvents: 'none' }}
                  >
                    {ns}
                  </text>
                </g>
              );
            })}

            <TopologyEdges
              links={links}
              nodeMap={nodeMap}
              hover={hover}
              connectedLinkIndices={connectedLinkIndices}
            />

            <TopologyNodes
              nodes={nodes}
              selected={selected}
              hover={hover}
              connectedNodeIds={connectedNodeIds}
              dragging={dragging}
              onClick={handleNodeClick}
              onDoubleClick={handleNodeDoubleClick}
              onContextMenu={handleNodeContextMenu}
              onMouseEnter={handleNodeMouseEnter}
              onMouseMove={handleNodeMouseMove}
              onMouseLeave={handleNodeMouseLeave}
              onDragStart={handleNodeDragStart}
            />
          </g>
        </svg>

        {/* Minimap */}
        <svg
          className={styles.minimap}
          width={MINIMAP_SIZE}
          height={MINIMAP_SIZE}
          viewBox={`0 0 ${MINIMAP_SIZE} ${MINIMAP_SIZE}`}
          onClick={handleMinimapClick}
        >
          <rect width={MINIMAP_SIZE} height={MINIMAP_SIZE} fill="var(--bg-app, #0f172a)" rx={4} />
          {nodes.map((n) => {
            const nx = n.x;
            const ny = n.y;
            if (nx == null || ny == null) return null;
            const mx = (nx - graphBounds.minX) * minimapScale;
            const my = (ny - graphBounds.minY) * minimapScale;
            return (
              <circle
                key={`mm:${n.id}`}
                cx={mx}
                cy={my}
                r={2}
                fill={n.unhealthy ? '#ef4444' : KIND_COLORS[n.kind]}
                opacity={0.7}
              />
            );
          })}
          <rect
            x={clamp(vpX, 0, MINIMAP_SIZE)}
            y={clamp(vpY, 0, MINIMAP_SIZE)}
            width={clamp(vpW, 4, MINIMAP_SIZE)}
            height={clamp(vpH, 4, MINIMAP_SIZE)}
            fill="rgba(99,102,241,0.1)"
            stroke="var(--accent, #6366f1)"
            strokeWidth={1}
            rx={2}
          />
        </svg>

        <TopologyOverlays
          tooltip={tooltip}
          dragging={dragging}
          podMetrics={podMetrics}
          contextMenu={contextMenu}
          onNavigate={handleNavigate}
          onCloseContextMenu={() => setContextMenu(null)}
        />
      </div>

      {/* Inspector panel */}
      {selectedNode && (
        <TopologyInspector
          node={selectedNode}
          nodes={nodes}
          links={links}
          podMetrics={podMetrics}
          onNavigate={handleNavigate}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

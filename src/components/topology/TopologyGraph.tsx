/**
 * TopologyGraph -- interactive d3-force topology view of the
 * Ingress -> Service -> EndpointSlice -> Pod graph.
 *
 * Refactored into smaller modules for high cohesion and low coupling.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useStore } from '../../store';
import { useTranslation } from '../../hooks/useI18n';
import type { TopologyGraphProps } from './types';
import { KIND_COLORS, NODE_RADIUS, MINIMAP_SIZE, clamp, resolveNodeId, resolveNode, getX, getY, buildNsRegionPath, NS_PADDING } from './constants';
import { NodeShape } from './nodeShapes';
import { useSimulation } from './hooks/useSimulation';
import { useZoomPan } from './hooks/useZoomPan';
import { useNodeInteraction } from './hooks/useNodeInteraction';
import styles from './TopologyGraph.module.css';

export function TopologyGraph({ focusedService, searchQuery, onHealthChange }: TopologyGraphProps) {
  const { t } = useTranslation();
  const rows = useStore((s) => s.rows);
  const podMetrics = useStore((s) => s.podMetrics);
  const containerRef = useRef<HTMLDivElement>(null);

  // Use custom hooks.
  const { simRef, nodesRef, linksRef, nodeMapRef, graphKey } = useSimulation(rows);

  // Compute graph bounds.
  const nodes = nodesRef.current;
  const links = linksRef.current;
  const nodeMap = nodeMapRef.current;

  let bMinX = Infinity,
    bMinY = Infinity,
    bMaxX = -Infinity,
    bMaxY = -Infinity;
  let healthyCount = 0,
    unhealthyCount = 0,
    unknownCount = 0;

  for (const n of nodes) {
    const nx = n.x;
    const ny = n.y;
    if (nx != null && ny != null) {
      if (nx < bMinX) bMinX = nx;
      if (ny < bMinY) bMinY = ny;
      if (nx > bMaxX) bMaxX = nx;
      if (ny > bMaxY) bMaxY = ny;
    }
    if (n.unhealthy) unhealthyCount++;
    else if (n.meta[0] === 'Running' || n.meta[0] === 'Succeeded') healthyCount++;
    else unknownCount++;
  }
  if (!isFinite(bMinX)) {
    bMinX = 0;
    bMinY = 0;
    bMaxX = 800;
    bMaxY = 500;
  }

  const graphBounds = {
    minX: bMinX - 50,
    minY: bMinY - 50,
    maxX: bMaxX + 50,
    maxY: bMaxY + 50,
  };

  const {
    viewTransform,
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

  // Apply search filter.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (!searchQuery || searchQuery.trim() === '') {
      for (const n of nodesRef.current) {
        n._dimmed = false;
      }
      return;
    }
    const q = searchQuery.toLowerCase();
    let anyMatch = false;
    for (const n of nodesRef.current) {
      const match = n.label.toLowerCase().includes(q);
      n._dimmed = !match;
      if (match) anyMatch = true;
    }
    if (anyMatch) {
      sim.alpha(0.3).restart();
    }
  }, [searchQuery, simRef, nodesRef]);

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
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as SVGElement;
    if (target.tagName !== 'svg' && !target.closest('[class*="canvas"]')) return;
    if (target.closest('[class*="node"]')) return;
    startPan(e);
  }, [startPan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (handlePanMove(e)) return;
    handleNodeDragMove(e);
  }, [handlePanMove, handleNodeDragMove]);

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

            {/* Edges */}
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

              const srcDimmed = srcNode._dimmed;
              const tgtDimmed = tgtNode._dimmed;
              const dimmed = srcDimmed || tgtDimmed;
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
                  style={
                    isFlow && !dimmed ? { animation: 'flowDash 0.8s linear infinite' } : undefined
                  }
                />
              );
            })}

            {/* Nodes */}
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
                  onClick={(e) => handleNodeClick(n, e)}
                  onDoubleClick={(e) => handleNodeDoubleClick(n, e)}
                  onContextMenu={(e) => handleNodeContextMenu(n, e)}
                  onMouseEnter={(e) => handleNodeMouseEnter(n, e)}
                  onMouseMove={(e) => handleNodeMouseMove(n, e)}
                  onMouseLeave={handleNodeMouseLeave}
                  onMouseDown={(e) => handleNodeDragStart(n, e)}
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
                handleNavigate(contextMenu.node);
                setContextMenu(null);
              }}
            >
              {t('topology.ctx.navigate', 'Navigate to resource')}
            </div>
            {contextMenu.node.kind === 'pod' && (
              <div
                className={styles.contextItem}
                onClick={() => {
                  handleNavigate(contextMenu.node);
                  setContextMenu(null);
                }}
              >
                {t('topology.ctx.logs', 'View Logs')}
              </div>
            )}
            {contextMenu.node.kind === 'pod' && (
              <div
                className={styles.contextItem}
                onClick={() => {
                  handleNavigate(contextMenu.node);
                  setContextMenu(null);
                }}
              >
                {t('topology.ctx.shell', 'Shell')}
              </div>
            )}
            <div
              className={styles.contextItem}
              onClick={() => {
                handleNavigate(contextMenu.node);
                setContextMenu(null);
              }}
            >
              {t('topology.ctx.yaml', 'View YAML')}
            </div>
            <div
              className={styles.contextItem}
              onClick={() => {
                navigator.clipboard?.writeText(contextMenu.node.label);
                setContextMenu(null);
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
      </div>

      {/* Inspector panel */}
      {selectedNode && (
        <div className={styles.inspector}>
          <div className={styles.inspectorHeader}>
            <span className={styles.inspectorTitle}>{selectedNode.label}</span>
            <span
              className={styles.statusDot}
              style={{
                background: selectedNode.unhealthy
                  ? 'var(--status-err, #ef4444)'
                  : selectedNode.meta[0] === 'Running' || selectedNode.meta[0] === 'Succeeded'
                    ? 'var(--status-ok, #34d399)'
                    : 'var(--text-muted, #64748b)',
              }}
            />
          </div>
          <div className={styles.inspectorMeta}>
            <span className={styles.inspectorKind}>{selectedNode.kind}</span>
            {selectedNode.namespace && (
              <span className={styles.inspectorNs}>{selectedNode.namespace}</span>
            )}
          </div>
          <div className={styles.inspectorDivider} />
          {selectedNode.meta.map((m, i) => (
            <div key={i} className={styles.inspectorRow}>
              {m}
            </div>
          ))}
          {selectedNode.kind === 'pod' && selectedNode.restarts > 0 && (
            <div className={styles.inspectorRow}>
              Restarts:{' '}
              <strong style={{ color: 'var(--status-err, #ef4444)' }}>
                {selectedNode.restarts}
              </strong>
            </div>
          )}
          {selectedNode.kind === 'pod' &&
            (() => {
              const key = `${selectedNode.namespace}/${selectedNode.label}`;
              const m = podMetrics[key];
              if (!m) return null;
              return (
                <div className={styles.inspectorRow}>
                  CPU: {(m.cpuMillis / 1000).toFixed(2)}c &middot; MEM:{' '}
                  {(m.memBytes / 1024 / 1024).toFixed(0)}Mi
                </div>
              );
            })()}
          {selectedNode.kind === 'service' && (
            <div className={styles.inspectorLinks}>
              {nodes
                .filter((n) =>
                  links.some((l) => {
                    const sid = resolveNodeId(l.source);
                    const tid = resolveNodeId(l.target);
                    return (
                      (sid === selectedNode.id && tid === n.id) ||
                      (tid === selectedNode.id && sid === n.id)
                    );
                  })
                )
                .slice(0, 5)
                .map((n) => (
                  <span
                    key={n.id}
                    className={styles.inspectorLink}
                    onClick={() => handleNavigate(n)}
                  >
                    {n.kind}: {n.label}
                  </span>
                ))}
            </div>
          )}
          <div className={styles.inspectorActions}>
            <button className={styles.actionBtn} onClick={() => handleNavigate(selectedNode)}>
              {t('topology.action.navigate', 'Navigate')}
            </button>
            {selectedNode.kind === 'pod' && (
              <button className={styles.actionBtn} onClick={() => handleNavigate(selectedNode)}>
                {t('topology.action.logs', 'Logs')}
              </button>
            )}
            {selectedNode.kind === 'pod' && (
              <button className={styles.actionBtn} onClick={() => handleNavigate(selectedNode)}>
                {t('topology.action.shell', 'Shell')}
              </button>
            )}
            <button className={styles.actionBtn} onClick={() => handleNavigate(selectedNode)}>
              {t('topology.action.yaml', 'YAML')}
            </button>
          </div>
          <button className={styles.inspectorClose} onClick={() => setSelected(null)}>
            &times;
          </button>
        </div>
      )}
    </div>
  );
}

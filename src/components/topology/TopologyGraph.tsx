/**
 * TopologyGraph -- interactive d3-force topology view of the
 * Ingress -> Service -> EndpointSlice -> Pod graph.
 *
 * Features:
 *   1. Continuous d3-force simulation with interactive node dragging
 *   2. Curved edges with animated flow and arrowheads
 *   3. Floating hover tooltip with resource details and metrics
 *   4. Rich clickable inspector panel with action buttons
 *   5. Auto-fit on load + Fit button in zoom controls
 *   6. Health summary bar (healthy/unhealthy/unknown counts)
 *   7. Namespace grouping with padded bounding boxes
 *   8. Minimap with viewport indicator and click-to-navigate
 *   9. Right-click context menu with quick actions
 *   10. Edge highlighting on node hover (dim non-connected)
 *   11. Staggered entrance animation for nodes
 *   12. Larger nodes with shadows, gradients, status colors
 *   13. Pod restart count badge
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { getProvider } from '../../providers';
import type { EndpointAddress, EndpointRow } from '../../providers/types';
import { useStore } from '../../store';
import { useTranslation } from '../../hooks/useI18n';
import styles from './TopologyGraph.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NodeKind = 'service' | 'endpoint' | 'pod' | 'ingress';

interface GraphNode extends SimulationNodeDatum {
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

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

interface ClusterGraph {
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KIND_COLORS: Record<NodeKind, string> = {
  ingress: '#f59e0b',
  service: '#6366f1',
  endpoint: '#5cc8ff',
  pod: '#34d399',
};

const STATUS_COLORS: Record<string, string> = {
  Running: '#34d399',
  Succeeded: '#34d399',
  Pending: '#fbbf24',
  Failed: '#ef4444',
  Unknown: '#94a3b8',
};

const NODE_RADIUS: Record<NodeKind, number> = {
  service: 18,
  pod: 14,
  endpoint: 10,
  ingress: 16,
};

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
const NS_PADDING = 50;
const TOOLTIP_OFFSET = 16;
const MINIMAP_SIZE = 180;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function resolveNodeId(v: string | GraphNode): string {
  return typeof v === 'string' ? v : v.id;
}

function resolveNode(v: string | GraphNode, map: Map<string, GraphNode>): GraphNode | undefined {
  const id = typeof v === 'string' ? v : v.id;
  return map.get(id);
}

function getX(n: GraphNode): number {
  return n.x ?? 0;
}

function getY(n: GraphNode): number {
  return n.y ?? 0;
}

/** Parse ingress rows from the store into name/host/namespace info. */
function parseIngressRows(rows: { name: string; namespace?: string; cells: { text: string }[] }[]) {
  return rows.map((r) => ({
    name: r.name,
    namespace: r.namespace ?? '',
    host: r.cells[0]?.text ?? '',
  }));
}

/** Match ingresses to services by name-in-same-namespace or hostname prefix. */
function matchIngressToServices(
  ingresses: { name: string; namespace: string; host: string }[],
  serviceKeys: Set<string>
): { ingressKey: string; serviceKey: string }[] {
  const edges: { ingressKey: string; serviceKey: string }[] = [];
  const seen = new Set<string>();

  for (const ing of ingresses) {
    const exactKey = `svc:${ing.namespace}/${ing.name}`;
    if (serviceKeys.has(exactKey)) {
      const edgeKey = `${ing.name}\u2192${ing.name}`;
      if (!seen.has(edgeKey)) {
        seen.add(edgeKey);
        edges.push({
          ingressKey: `ing:${ing.namespace}/${ing.name}`,
          serviceKey: exactKey,
        });
      }
      continue;
    }

    const prefix = ing.host.split('.')[0];
    if (prefix && prefix !== ing.name) {
      const hostKey = `svc:${ing.namespace}/${prefix}`;
      if (serviceKeys.has(hostKey)) {
        const edgeKey = `${ing.name}\u2192${prefix}`;
        if (!seen.has(edgeKey)) {
          seen.add(edgeKey);
          edges.push({
            ingressKey: `ing:${ing.namespace}/${ing.name}`,
            serviceKey: hostKey,
          });
        }
        continue;
      }
    }

    for (const svcKey of serviceKeys) {
      if (svcKey.startsWith(`svc:${ing.namespace}/`)) {
        const svcName = svcKey.split('/')[1];
        const edgeKey = `${ing.name}\u2192${svcName}`;
        if (!seen.has(edgeKey)) {
          seen.add(edgeKey);
          edges.push({
            ingressKey: `ing:${ing.namespace}/${ing.name}`,
            serviceKey: svcKey,
          });
        }
        break;
      }
    }
  }

  return edges;
}

/** Build a rounded-rect path for a bounding box of points. */
function buildNsRegionPath(points: { x: number; y: number }[], padding: number): string {
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

// ---------------------------------------------------------------------------
// SVG Node Shape Components
// ---------------------------------------------------------------------------

function ServiceShape({ unhealthy }: { unhealthy: boolean }) {
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

function PodShape({ unhealthy, status }: { unhealthy: boolean; status: string }) {
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

function EndpointShape({ unhealthy }: { unhealthy: boolean }) {
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

function IngressShape({ unhealthy }: { unhealthy: boolean }) {
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

function NodeShape({ node }: { node: GraphNode }) {
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TopologyGraph({ focusedService, searchQuery, onHealthChange }: TopologyGraphProps) {
  const { t } = useTranslation();
  const rows = useStore((s) => s.rows);
  const navigateTo = useStore((s) => s.navigateTo);
  const podMetrics = useStore((s) => s.podMetrics);

  // Refs for simulation and DOM -- these change without causing re-renders.
  const simRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const nodeMapRef = useRef<Map<string, GraphNode>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  // Re-render trigger: bumped on every simulation tick.
  const [graphKey, setGraphKey] = useState(0);

  // Interaction state.
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
  const [containerSize, setContainerSize] = useState({ w: 800, h: 500 });

  // Zoom/pan transform (managed by wheel/pan events).
  const [viewTransform, setViewTransform] = useState({ k: 1, x: 0, y: 0 });
  const panRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  // Node drag ref (for dragging nodes in graph coordinates).
  const nodeDragRef = useRef<{
    active: boolean;
    nodeId: string;
  } | null>(null);

  // -----------------------------------------------------------------------
  // Navigation helper.
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // Build graph from cluster data.
  // -----------------------------------------------------------------------
  const buildGraph = useCallback(async (): Promise<ClusterGraph> => {
    let slices: EndpointRow[] = [];
    try {
      slices = await getProvider().listEndpoints();
    } catch {
      // EndpointSlice API unavailable.
    }

    const byService = new Map<string, EndpointRow[]>();
    for (const slc of slices) {
      if (!slc.service) continue;
      const key = `${slc.namespace}/${slc.service}`;
      const arr = byService.get(key) ?? [];
      arr.push(slc);
      byService.set(key, arr);
    }

    const sliceAddrs = new Map<string, EndpointAddress[]>();
    for (const slc of slices) {
      try {
        const addrs = await getProvider().listEndpointAddresses(slc.namespace, slc.name);
        sliceAddrs.set(`${slc.namespace}/${slc.name}`, addrs);
      } catch {
        // ignore
      }
    }

    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const seenPod = new Set<string>();
    const serviceKeys = new Set<string>();

    if (byService.size === 0) {
      // Fallback: selector-based graph.
      const svcRows = rows.services ?? [];
      const podRows = rows.pods ?? [];
      for (const svc of svcRows) {
        const ns = svc.namespace ?? '';
        const svcId = `svc:${ns}/${svc.name}`;
        serviceKeys.add(svcId);
        const selector = svc.selector ?? {};
        const hasSelector = Object.keys(selector).length > 0;
        const matchingPods = podRows.filter((p) => {
          if (p.namespace !== ns) return false;
          if (hasSelector) {
            return Object.entries(selector).every(([k, v]) => p.labels?.[k] === v);
          }
          const labels = p.labels ?? {};
          return labels['app'] === svc.name || labels['app.kubernetes.io/name'] === svc.name;
        });
        const readyPods = matchingPods.filter((p) => p.pod?.status === 'Running');
        nodes.push({
          id: svcId,
          kind: 'service',
          label: svc.name,
          namespace: ns,
          meta: [
            hasSelector
              ? `selector: ${Object.entries(selector)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(', ')}`
              : 'no selector',
            `${readyPods.length}/${matchingPods.length} pods ready`,
          ],
          unhealthy: matchingPods.length === 0,
          restarts: 0,
        });
        for (const pod of matchingPods) {
          const podKey = `${ns}/${pod.name}`;
          if (!seenPod.has(podKey)) {
            seenPod.add(podKey);
            const phase = pod.pod?.status ?? 'Unknown';
            nodes.push({
              id: `pod:${podKey}`,
              kind: 'pod',
              label: pod.name,
              namespace: ns,
              meta: [phase],
              unhealthy: pod.pod?.statusTone === 'err',
              restarts: pod.pod?.restarts ?? 0,
            });
          }
          links.push({ source: svcId, target: `pod:${podKey}` });
        }
      }
    } else {
      // EndpointSlice-based: Service + Endpoint + Pod nodes.
      for (const [key, slcs] of byService) {
        const [ns, svc] = key.split('/');
        const allAddrs = slcs.flatMap((s) => sliceAddrs.get(`${s.namespace}/${s.name}`) ?? []);
        const readyCount = slcs.reduce((n, s) => n + s.ready, 0);
        const svcId = `svc:${key}`;
        serviceKeys.add(svcId);
        nodes.push({
          id: svcId,
          kind: 'service',
          label: svc,
          namespace: ns,
          meta: [`${slcs.length} slice${slcs.length === 1 ? '' : 's'}`, `${readyCount} ready`],
          unhealthy: readyCount === 0,
          restarts: 0,
        });
        for (const slc of slcs) {
          const sliceNodeId = `slice:${slc.namespace}/${slc.name}`;
          nodes.push({
            id: sliceNodeId,
            kind: 'endpoint',
            label: slc.name,
            namespace: slc.namespace,
            meta: [`${slc.ready}/${slc.total} ready`],
            unhealthy: slc.ready === 0,
            restarts: 0,
          });
          links.push({ source: svcId, target: sliceNodeId });
          for (const addr of allAddrs) {
            if (addr.targetRefKind !== 'Pod') continue;
            const podKey = `${slc.namespace}/${addr.targetRefName}`;
            if (!seenPod.has(podKey)) {
              seenPod.add(podKey);
              const podRow = rows.pods.find(
                (r) => r.namespace === slc.namespace && r.name === addr.targetRefName
              );
              const phase = podRow?.cells.find((c: { text: string }) =>
                /^(Running|Pending|Failed|Succeeded)$/.test(c.text)
              )?.text;
              nodes.push({
                id: `pod:${podKey}`,
                kind: 'pod',
                label: addr.targetRefName,
                namespace: slc.namespace,
                meta: phase ? [phase] : [],
                unhealthy: addr.ready === false,
                restarts: podRow?.pod?.restarts ?? 0,
              });
            }
            links.push({
              source: sliceNodeId,
              target: `pod:${podKey}`,
            });
          }
        }
      }
    }

    // Ingress nodes.
    const ingressRows = rows['ingresses'] ?? [];
    const parsedIngresses = parseIngressRows(ingressRows);
    const ingressEdges = matchIngressToServices(parsedIngresses, serviceKeys);
    for (const ing of parsedIngresses) {
      const ingId = `ing:${ing.namespace}/${ing.name}`;
      if (ingressEdges.some((e) => e.ingressKey === ingId)) {
        nodes.push({
          id: ingId,
          kind: 'ingress',
          label: ing.name,
          namespace: ing.namespace,
          meta: [ing.host || '(no host)'],
          unhealthy: false,
          restarts: 0,
        });
      }
    }
    for (const edge of ingressEdges) {
      links.push({ source: edge.ingressKey, target: edge.serviceKey });
    }

    return { nodes, links };
  }, [rows]);

  // -----------------------------------------------------------------------
  // Initialize simulation (runs once).
  // -----------------------------------------------------------------------
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
    buildGraph().then(({ nodes, links }) => {
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

  // -----------------------------------------------------------------------
  // Rebuild graph when data changes.
  // -----------------------------------------------------------------------
  useEffect(() => {
    buildGraph().then(({ nodes, links }) => {
      nodesRef.current = nodes;
      linksRef.current = links;
      nodeMapRef.current = new Map(nodes.map((n) => [n.id, n]));
      const sim = simRef.current;
      if (sim) {
        sim.nodes(nodes);
        (sim.force('link') as ReturnType<typeof forceLink<GraphNode, GraphLink>>).links(links);
        sim.alpha(0.5).restart();
      }
    });
  }, [buildGraph]);

  // -----------------------------------------------------------------------
  // Sync focusedService -- center view on it.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!focusedService) return;
    let node = nodeMapRef.current.get(focusedService);
    if (!node) {
      // Try searching by label.
      node = nodesRef.current.find(
        (n) => n.label === focusedService || `svc:${n.namespace}/${n.label}` === focusedService
      );
    }
    if (!node || node.x == null || node.y == null) return;
    setSelected(node.id);
    const el = containerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const k = 1.5;
      const tx = rect.width / 2 - node.x * k;
      const ty = rect.height / 2 - node.y * k;
      setViewTransform({ k, x: tx, y: ty });
    }
  }, [focusedService]);

  // -----------------------------------------------------------------------
  // Apply search filter.
  // -----------------------------------------------------------------------
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
  }, [searchQuery]);

  // -----------------------------------------------------------------------
  // Resize observer.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({
        w: Math.round(r.width) || 800,
        h: Math.round(r.height) || 500,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // -----------------------------------------------------------------------
  // Compute graph data on each render.
  // -----------------------------------------------------------------------
  const nodes = nodesRef.current;
  const links = linksRef.current;
  const nodeMap = nodeMapRef.current;

  // Compute bounds + health.
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

  // Report health changes.
  useEffect(() => {
    onHealthChange?.({
      total: healthyCount + unhealthyCount + unknownCount,
      healthy: healthyCount,
      unhealthy: unhealthyCount,
      unknown: unknownCount,
    });
  }, [healthyCount, unhealthyCount, unknownCount, onHealthChange]);

  // -----------------------------------------------------------------------
  // Namespace groups.
  // -----------------------------------------------------------------------
  const nsGroups = new Map<string, { x: number; y: number }[]>();
  for (const n of nodes) {
    if (!n.namespace || n.x == null || n.y == null) continue;
    if (n._dimmed) continue;
    const arr = nsGroups.get(n.namespace) ?? [];
    arr.push({ x: n.x, y: n.y });
    nsGroups.set(n.namespace, arr);
  }

  // -----------------------------------------------------------------------
  // Auto-fit on first render.
  // -----------------------------------------------------------------------
  const didFitRef = useRef(false);
  useEffect(() => {
    if (didFitRef.current) return;
    if (nodes.length === 0) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 10) return;
    const bw = graphBounds.maxX - graphBounds.minX;
    const bh = graphBounds.maxY - graphBounds.minY;
    if (bw < 1 || bh < 1) return;
    const k = clamp(Math.min(rect.width / bw, rect.height / bh) * 0.85, MIN_ZOOM, MAX_ZOOM);
    const cx = (graphBounds.minX + graphBounds.maxX) / 2;
    const cy = (graphBounds.minY + graphBounds.maxY) / 2;
    const tx = rect.width / 2 - cx * k;
    const ty = rect.height / 2 - cy * k;
    setViewTransform({ k, x: tx, y: ty });
    didFitRef.current = true;
  }, [graphKey, graphBounds, nodes.length]);

  // -----------------------------------------------------------------------
  // Zoom / pan handlers (native events).
  // -----------------------------------------------------------------------
  const handleWheel = useCallback((e: ReactWheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setViewTransform((v) => {
      const el = containerRef.current;
      if (!el) return v;
      const rect = el.getBoundingClientRect();
      const newK = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
      // Zoom toward cursor.
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const graphX = (mx - v.x) / v.k;
      const graphY = (my - v.y) / v.k;
      const newX = mx - graphX * newK;
      const newY = my - graphY * newK;
      return { k: newK, x: newX, y: newY };
    });
  }, []);

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      // Only start pan on SVG background (not on a node).
      const target = e.target as SVGElement;
      if (target.tagName !== 'svg' && !target.closest(`.${styles.canvas}`)) return;
      // Check if we clicked on a node -- if so, don't start panning.
      const nodeG = target.closest(`.${styles.node}`);
      if (nodeG) return;
      panRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        origX: viewTransform.x,
        origY: viewTransform.y,
      };
    },
    [viewTransform.x, viewTransform.y]
  );

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent) => {
      // Pan.
      if (panRef.current.active) {
        const dx = e.clientX - panRef.current.startX;
        const dy = e.clientY - panRef.current.startY;
        setViewTransform((v) => ({
          ...v,
          x: panRef.current.origX + dx,
          y: panRef.current.origY + dy,
        }));
        return;
      }
      // Node drag.
      if (nodeDragRef.current?.active) {
        const el = containerRef.current;
        if (!el) return;
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
      }
    },
    [viewTransform]
  );

  const handleMouseUp = useCallback(() => {
    panRef.current.active = false;
    if (nodeDragRef.current?.active) {
      const node = nodeMapRef.current.get(nodeDragRef.current.nodeId);
      if (node) {
        node.fx = null;
        node.fy = null;
      }
      nodeDragRef.current = null;
      setDragging(false);
      const sim = simRef.current;
      if (sim) sim.alphaTarget(0);
    }
  }, []);

  // -----------------------------------------------------------------------
  // Node drag handlers.
  // -----------------------------------------------------------------------
  const handleNodeDragStart = useCallback((node: GraphNode, e: ReactMouseEvent) => {
    e.stopPropagation();
    const sim = simRef.current;
    if (sim) sim.alphaTarget(0.3).restart();
    nodeDragRef.current = { active: true, nodeId: node.id };
    node.fx = node.x ?? null;
    node.fy = node.y ?? null;
    setDragging(true);
  }, []);

  // -----------------------------------------------------------------------
  // Other node event handlers.
  // -----------------------------------------------------------------------
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
  }, []);

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
  }, []);

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
  }, []);

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

  // -----------------------------------------------------------------------
  // Minimap click-to-navigate.
  // -----------------------------------------------------------------------
  const handleMinimapClick = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      const target = e.currentTarget;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const bw = graphBounds.maxX - graphBounds.minX;
      const bh = graphBounds.maxY - graphBounds.minY;
      const minimapScale = MINIMAP_SIZE / Math.max(bw, bh, 1);
      const graphX = graphBounds.minX + mx / minimapScale;
      const graphY = graphBounds.minY + my / minimapScale;
      const k = viewTransform.k;
      const el = containerRef.current;
      if (!el) return;
      const svgRect = el.getBoundingClientRect();
      const tx = svgRect.width / 2 - graphX * k;
      const ty = svgRect.height / 2 - graphY * k;
      setViewTransform({ k, x: tx, y: ty });
    },
    [graphBounds, viewTransform.k]
  );

  // -----------------------------------------------------------------------
  // Zoom control buttons.
  // -----------------------------------------------------------------------
  const handleFit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const bw = graphBounds.maxX - graphBounds.minX;
    const bh = graphBounds.maxY - graphBounds.minY;
    if (bw < 1 || bh < 1) return;
    const k = clamp(Math.min(rect.width / bw, rect.height / bh) * 0.85, MIN_ZOOM, MAX_ZOOM);
    const cx = (graphBounds.minX + graphBounds.maxX) / 2;
    const cy = (graphBounds.minY + graphBounds.maxY) / 2;
    const tx = rect.width / 2 - cx * k;
    const ty = rect.height / 2 - cy * k;
    setViewTransform({ k, x: tx, y: ty });
  }, [graphBounds]);

  const handleZoomIn = useCallback(() => {
    setViewTransform((v) => {
      const el = containerRef.current;
      if (!el) return v;
      const rect = el.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const newK = clamp(v.k * 1.3, MIN_ZOOM, MAX_ZOOM);
      const graphX = (cx - v.x) / v.k;
      const graphY = (cy - v.y) / v.k;
      return { k: newK, x: cx - graphX * newK, y: cy - graphY * newK };
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setViewTransform((v) => {
      const el = containerRef.current;
      if (!el) return v;
      const rect = el.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const newK = clamp(v.k * 0.7, MIN_ZOOM, MAX_ZOOM);
      const graphX = (cx - v.x) / v.k;
      const graphY = (cy - v.y) / v.k;
      return { k: newK, x: cx - graphX * newK, y: cy - graphY * newK };
    });
  }, []);

  // -----------------------------------------------------------------------
  // Compute connected nodes/links for hover highlight.
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // Selected node for inspector.
  // -----------------------------------------------------------------------
  const selectedNode = selected ? nodeMap.get(selected) : null;

  // -----------------------------------------------------------------------
  // Minimap calculations.
  // -----------------------------------------------------------------------
  const bw = graphBounds.maxX - graphBounds.minX;
  const bh = graphBounds.maxY - graphBounds.minY;
  const minimapScale = MINIMAP_SIZE / Math.max(bw, bh, 1);

  const vpX = (-viewTransform.x / viewTransform.k - graphBounds.minX) * minimapScale;
  const vpY = (-viewTransform.y / viewTransform.k - graphBounds.minY) * minimapScale;
  const vpW = (containerSize.w / viewTransform.k) * minimapScale;
  const vpH = (containerSize.h / viewTransform.k) * minimapScale;

  const transformStr = `translate(${viewTransform.x},${viewTransform.y}) scale(${viewTransform.k})`;

  // -----------------------------------------------------------------------
  // Render.
  // -----------------------------------------------------------------------
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

              // Curved edge: quadratic bezier with perpendicular offset.
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

              // Shorten endpoint so arrowhead doesn't overlap target node.
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

            {/* Node labels (foreignObject) */}
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
            {/* Pod metrics */}
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
            {/* Service info */}
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
          {(Object.keys(KIND_COLORS) as NodeKind[]).map((k) => (
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
          {/* Pod metrics */}
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
          {/* Related resources */}
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
          {/* Action buttons */}
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

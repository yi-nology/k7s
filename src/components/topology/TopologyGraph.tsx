/**
 * TopologyGraph — the d3 force-directed view of the Service → Endpoint →
 * Pod → Container graph (Phase 1 Tier-2 of KubePi parity).
 *
 * Why a force layout rather than cards: k7s's previous Topology panel
 * (also in this folder) was a list of cards, which works for one
 * service at a time but doesn't scale to "show me everything this
 * cluster routes to". The force layout lays out nodes by simulated
 * attraction (linked) and repulsion (everything else), so tightly
 * coupled objects (Service ↔ Endpoints ↔ Pod) cluster together and
 * unrelated services drift apart. The result is a picture of
 * cluster shape that's hard to get any other way.
 *
 * Implementation notes:
 *   - We use d3-force for the layout only; rendering is plain SVG so
 *     we don't pull in d3-selection, d3-drag, etc. The simulation runs
 *     300 ticks once, then we render — interactive dragging is a
 *     later feature, not a launch requirement.
 *   - Node colours map to the existing kind palette so the graph
 *     reads the same as the cards it replaced.
 *   - Hovering highlights the node and its neighbours; clicking
 *     surfaces a tiny inspector with the Service's selector + the
 *     Pods it points to. That's enough to answer "is this wired up
 *     right" without dropping into kubectl.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

// d3-force v3 dropped the default type param; alias to keep the
// call-site tidy.
type Link = SimulationLinkDatum<GraphNode>;
import { getProvider } from "../../providers";
import type { EndpointAddress, EndpointRow } from "../../providers/types";
import { useStore } from "../../store";
import { useTranslation } from "../../hooks/useI18n";
import styles from "./TopologyGraph.module.css";

/**
 * One node on the graph. Service / EndpointSlice / Pod / Container.
 * `kind` drives the visual; `ref` lets us look the node up in the
 * data source for the inspector.
 */
type NodeKind = "service" | "endpoint" | "pod" | "container";

interface GraphNode extends SimulationNodeDatum {
  id: string;
  kind: NodeKind;
  label: string;
  /** Cluster-scoped namespace for the inspector header. */
  namespace: string;
  /** Optional extra rows shown in the inspector. */
  meta: string[];
  /** True when this Service has 0 ready addresses (red). */
  unhealthy: boolean;
}

interface GraphLink extends Link {
  source: string;
  target: string;
}

interface ClusterGraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

const KIND_COLORS: Record<NodeKind, string> = {
  service: "var(--accent)",
  endpoint: "#5cc8ff",
  pod: "#34d399",
  container: "#a78bfa",
};

export function TopologyGraph() {
  const { t } = useTranslation();
  const rows = useStore((s) => s.rows);
  const [graph, setGraph] = useState<ClusterGraph>({ nodes: [], links: [] });
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });

  // Build the graph from cluster data: walk EndpointSlices, group by
  // Service, and connect to the Pods that the addresses target. Pods
  // are pulled from the live pod table for status; if not present
  // (different namespace filter), they're rendered in muted grey.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const slices = await getProvider().listEndpoints();
        if (cancelled) return;
        const byService = new Map<string, EndpointRow[]>();
        for (const slc of slices) {
          if (!slc.service) continue;
          const key = `${slc.namespace}/${slc.service}`;
          const arr = byService.get(key) ?? [];
          arr.push(slc);
          byService.set(key, arr);
        }

        // For each slice, fetch addresses to know the target pod.
        const sliceAddrs = new Map<string, EndpointAddress[]>();
        for (const slc of slices) {
          try {
            const addrs = await getProvider().listEndpointAddresses(
              slc.namespace,
              slc.name,
            );
            sliceAddrs.set(`${slc.namespace}/${slc.name}`, addrs);
          } catch {
            // ignore individual slice failures
          }
        }
        if (cancelled) return;

        const nodes: GraphNode[] = [];
        const links: GraphLink[] = [];
        const seenPod = new Set<string>();

        for (const [key, slcs] of byService) {
          const [ns, svc] = key.split("/");
          const allAddrs = slcs.flatMap((s) => sliceAddrs.get(`${s.namespace}/${s.name}`) ?? []);
          const readyCount = slcs.reduce((n, s) => n + s.ready, 0);
          nodes.push({
            id: `svc:${key}`,
            kind: "service",
            label: svc,
            namespace: ns,
            meta: [
              `${slcs.length} slice${slcs.length === 1 ? "" : "s"}`,
              `${readyCount} ready`,
            ],
            unhealthy: readyCount === 0,
          });
          for (const slc of slcs) {
            const sliceNodeId = `slice:${slc.namespace}/${slc.name}`;
            nodes.push({
              id: sliceNodeId,
              kind: "endpoint",
              label: slc.name,
              namespace: slc.namespace,
              meta: [`${slc.ready}/${slc.total} ready`],
              unhealthy: slc.ready === 0,
            });
            links.push({ source: `svc:${key}`, target: sliceNodeId });
            for (const addr of allAddrs) {
              if (addr.targetRefKind !== "Pod") continue;
              const podKey = `${slc.namespace}/${addr.targetRefName}`;
              if (!seenPod.has(podKey)) {
                seenPod.add(podKey);
                const podRow = rows.pods.find(
                  (r) => r.namespace === slc.namespace && r.name === addr.targetRefName,
                );
                const phase = podRow?.cells.find((c: { text: string }) =>
                  /^(Running|Pending|Failed|Succeeded)$/.test(c.text),
                )?.text;
                nodes.push({
                  id: `pod:${podKey}`,
                  kind: "pod",
                  label: addr.targetRefName,
                  namespace: slc.namespace,
                  meta: phase ? [phase] : [],
                  unhealthy: addr.ready === false,
                });
              }
              links.push({
                source: sliceNodeId,
                target: `pod:${podKey}`,
              });
            }
          }
        }

        if (!cancelled) {
          setGraph({ nodes, links });
        }
      } catch (e: unknown) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows.pods]);

  // Run a one-shot force simulation to compute positions. Interactive
  // dragging is left for a later iteration.
  const positions = useMemo(() => {
    if (graph.nodes.length === 0) {
      return new Map<string, { x: number; y: number }>();
    }
    const nodes: GraphNode[] = graph.nodes.map((n) => ({ ...n }));
    const links: GraphLink[] = graph.links.map((l) => ({ ...l }));
    const sim: Simulation<GraphNode, GraphLink> = forceSimulation<GraphNode>(nodes)
      .force("charge", forceManyBody().strength(-180))
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(60)
          .strength(0.6),
      )
      .force("center", forceCenter(size.w / 2, size.h / 2))
      .stop();
    // Run 300 ticks synchronously; d3 docs recommend ~300 for stable
    // layout. Each tick is a single O(n) pass.
    for (let i = 0; i < 300; i++) sim.tick();
    const map = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      map.set(n.id, {
        x: clamp(n.x ?? size.w / 2, 20, size.w - 20),
        y: clamp(n.y ?? size.h / 2, 20, size.h - 20),
      });
    }
    return map;
    // size is part of the dep list so re-layout happens on resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, size]);

  // Track container size for the SVG viewBox + force center.
  useEffect(() => {
    if (!svgRef.current) return;
    const el = svgRef.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width || 800, h: r.height || 500 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hovered = hover ? graph.nodes.find((n) => n.id === hover) : null;
  const selectedNode = selected
    ? graph.nodes.find((n) => n.id === selected)
    : null;

  return (
    <div className={styles.wrap}>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.canvas} ref={svgRef as never}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${size.w} ${size.h}`}
        >
          {graph.links.map((l, i) => {
            const s = positions.get(l.source);
            const t = positions.get(l.target);
            if (!s || !t) return null;
            const isHot =
              hover !== null &&
              (l.source === hover || l.target === hover);
            return (
              <line
                key={i}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={isHot ? "var(--accent)" : "var(--border)"}
                strokeWidth={isHot ? 1.5 : 0.7}
                opacity={isHot ? 0.9 : 0.5}
              />
            );
          })}
          {graph.nodes.map((n) => {
            const p = positions.get(n.id);
            if (!p) return null;
            const isHover = hover === n.id;
            const isSelected = selected === n.id;
            const fill = n.unhealthy
              ? "var(--status-err)"
              : KIND_COLORS[n.kind];
            return (
              <g
                key={n.id}
                transform={`translate(${p.x}, ${p.y})`}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setSelected(n.id)}
                style={{ cursor: "pointer" }}
              >
                <circle
                  r={isSelected ? 10 : isHover ? 9 : 7}
                  fill={fill}
                  stroke={isSelected ? "var(--text-primary)" : "var(--border)"}
                  strokeWidth={isSelected ? 2 : 1}
                />
                <text
                  x={12}
                  y={4}
                  fontSize={11}
                  fill="var(--text-primary)"
                  style={{ pointerEvents: "none" }}
                >
                  {n.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className={styles.legend}>
        {(Object.keys(KIND_COLORS) as NodeKind[]).map((k) => (
          <span key={k} className={styles.legendItem}>
            <span
              className={styles.dot}
              style={{ background: KIND_COLORS[k] }}
            />
            {t(`topology.legend.${k}`, k)}
          </span>
        ))}
      </div>
      {(hovered || selectedNode) && (
        <div className={styles.inspector}>
          <div className={styles.inspectorHeader}>
            {(selectedNode ?? hovered)!.label}
          </div>
          <div className={styles.inspectorMeta}>
            {(selectedNode ?? hovered)!.namespace}
          </div>
          {(selectedNode ?? hovered)!.meta.map((m, i) => (
            <div key={i} className={styles.inspectorRow}>
              {m}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

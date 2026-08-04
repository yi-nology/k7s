/**
 * IngressRouteTopology — a visual diagram showing Ingress → Service routing
 * chains. Reads ingresses and services from the store, matches them by
 * name-in-same-namespace (the most common Kubernetes convention), and renders
 * a left-to-right SVG flow diagram.
 *
 * Unlike the force-directed Service Topology (TopologyGraph), this uses a
 * fixed column layout because the graph is always a shallow tree: Ingress on
 * the left, Services on the right. A force simulation would just spread the
 * same nodes across a 2D plane without adding clarity.
 */
import { useMemo, useRef, useState, useEffect } from "react";
import { useStore } from "../../store";
import { useTranslation } from "../../hooks/useI18n";
import type { Row } from "../../providers/types";
import styles from "./IngressRouteTopology.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IngressInfo {
  name: string;
  namespace: string;
  host: string;
  ingressClass: string;
  /** True when the hostname suggests TLS (contains no wildcard and ends in a
   *  common TLD, or the class is known-TLS). A heuristic — the real TLS state
   *  lives in the Ingress spec.tls[] field, which the table rows don't carry. */
  tls: boolean;
}

interface ServiceInfo {
  name: string;
  namespace: string;
  type: string;
  clusterIp: string;
  ports: string;
}

interface RouteEdge {
  ingress: IngressInfo;
  service: ServiceInfo;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract ingress metadata from a table row.
 *  Columns: NAME, NAMESPACE, HOSTS, CLASS, AGE  (see kinds.ts) */
function parseIngress(row: Row): IngressInfo {
  const host = row.cells[2]?.text ?? "";
  const ingressClass = row.cells[3]?.text ?? "";
  // TLS detection: the backend now sets `labels.tls = "true"` when
  // spec.tls[] is non-empty. Fall back to the old heuristic for rows
  // that don't carry the label (e.g. from an older backend version).
  const tlsFromLabel = row.labels?.tls === "true";
  const tlsFromHeuristic =
    ingressClass.toLowerCase().includes("nginx") ||
    ingressClass.toLowerCase().includes("traefik");
  const tls = tlsFromLabel || tlsFromHeuristic;
  return {
    name: row.name,
    namespace: row.namespace ?? "",
    host,
    ingressClass,
    tls,
  };
}

/** Extract service metadata from a table row.
 *  Columns: NAME, NAMESPACE, TYPE, CLUSTER-IP, PORTS, AGE  (see kinds.ts) */
function parseService(row: Row): ServiceInfo {
  return {
    name: row.name,
    namespace: row.namespace ?? "",
    type: row.cells[0]?.text ?? "",
    clusterIp: row.cells[1]?.text ?? "",
    ports: row.cells[2]?.text ?? "",
  };
}

/** Match ingresses to services. The most common Kubernetes convention is that
 *  an Ingress named "foo" routes to a Service also named "foo" in the same
 *  namespace. We also try matching the hostname prefix against service names
 *  (e.g. host "grafana.example.com" → service "grafana"). */
function buildRoutes(
  ingresses: IngressInfo[],
  services: ServiceInfo[],
): RouteEdge[] {
  const svcByNsName = new Map<string, ServiceInfo>();
  for (const svc of services) {
    svcByNsName.set(`${svc.namespace}/${svc.name}`, svc);
  }

  const edges: RouteEdge[] = [];
  const seen = new Set<string>();

  for (const ing of ingresses) {
    // Strategy 1: exact name match in same namespace.
    const exact = svcByNsName.get(`${ing.namespace}/${ing.name}`);
    if (exact) {
      const key = `${ing.name}→${exact.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ ingress: ing, service: exact });
      }
      continue;
    }

    // Strategy 2: hostname prefix match.
    // "grafana.murphy-yi.internal" → try service "grafana" in same namespace.
    const prefix = ing.host.split(".")[0];
    if (prefix && prefix !== ing.name) {
      const byHost = svcByNsName.get(`${ing.namespace}/${prefix}`);
      if (byHost) {
        const key = `${ing.name}→${byHost.name}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ ingress: ing, service: byHost });
        }
        continue;
      }
    }

    // Strategy 3: first service in the same namespace as a fallback.
    const fallback = services.find((s) => s.namespace === ing.namespace);
    if (fallback) {
      const key = `${ing.name}→${fallback.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ ingress: ing, service: fallback });
      }
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// SVG layout constants
// ---------------------------------------------------------------------------

const NODE_W = 200;
const NODE_H = 56;
const COL_GAP = 120;
const ROW_GAP = 20;
const PAD_X = 40;
const PAD_Y = 30;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IngressRouteTopology({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const rows = useStore((s) => s.rows);
  const [hover, setHover] = useState<string | null>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });

  // Parse rows into typed structures.
  const ingresses = useMemo(
    () =>
      (rows["ingresses"] ?? [])
        .filter((r) => r.namespace !== undefined)
        .map(parseIngress),
    [rows],
  );

  const services = useMemo(
    () =>
      (rows["services"] ?? [])
        .filter((r) => r.namespace !== undefined)
        .map(parseService),
    [rows],
  );

  // Match ingresses to services.
  const routes = useMemo(
    () => buildRoutes(ingresses, services),
    [ingresses, services],
  );

  // Collect the set of services actually referenced by routes, preserving
  // order of first appearance so the right column is stable.
  const connectedServices = useMemo(() => {
    const seen = new Set<string>();
    const list: ServiceInfo[] = [];
    for (const r of routes) {
      const key = `${r.service.namespace}/${r.service.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push(r.service);
      }
    }
    return list;
  }, [routes]);

  // Compute SVG dimensions from the data.
  const svgDims = useMemo(() => {
    const rows = Math.max(ingresses.length, connectedServices.length, 1);
    const w = PAD_X * 2 + NODE_W * 2 + COL_GAP;
    const h = PAD_Y * 2 + rows * NODE_H + (rows - 1) * ROW_GAP;
    return { w, h };
  }, [ingresses.length, connectedServices.length]);

  // Track container size for responsive sizing.
  useEffect(() => {
    if (!svgRef.current) return;
    const el = svgRef.current;
    const updateSize = () => {
      const r = el.getBoundingClientRect();
      setSize({
        w: Math.max(Math.round(r.width), svgDims.w),
        h: Math.max(Math.round(r.height), svgDims.h),
      });
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [svgDims]);

  // Build position maps for ingresses and services.
  const ingressPositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    ingresses.forEach((ing, i) => {
      map.set(`${ing.namespace}/${ing.name}`, {
        x: PAD_X,
        y: PAD_Y + i * (NODE_H + ROW_GAP),
      });
    });
    return map;
  }, [ingresses]);

  const servicePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    connectedServices.forEach((svc, i) => {
      map.set(`${svc.namespace}/${svc.name}`, {
        x: PAD_X + NODE_W + COL_GAP,
        y: PAD_Y + i * (NODE_H + ROW_GAP),
      });
    });
    return map;
  }, [connectedServices]);

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2>
          {t("ingressRoutes.title", "Ingress Route Topology")}
        </h2>
        {onClose && (
          <button className={styles.btn} onClick={onClose}>
            {t("ingressRoutes.close", "Close")}
          </button>
        )}
      </header>
      <div className={styles.body}>
        {ingresses.length === 0 && services.length === 0 ? (
          <div className={styles.empty}>
            {t("ingressRoutes.empty", "No ingresses or services found")}
          </div>
        ) : (
          <>
            <div className={styles.canvas} ref={svgRef}>
              <svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${size.w} ${size.h}`}
              >
                {/* Column headers */}
                <text
                  x={PAD_X + NODE_W / 2}
                  y={16}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--text-muted)"
                  fontWeight={500}
                >
                  {t("ingressRoutes.col.ingress", "INGRESS")}
                </text>
                <text
                  x={PAD_X + NODE_W + COL_GAP + NODE_W / 2}
                  y={16}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--text-muted)"
                  fontWeight={500}
                >
                  {t("ingressRoutes.col.service", "SERVICE")}
                </text>

                {/* Connection lines (drawn first so nodes sit on top) */}
                {routes.map((edge, i) => {
                  const sKey = `${edge.ingress.namespace}/${edge.ingress.name}`;
                  const tKey = `${edge.service.namespace}/${edge.service.name}`;
                  const sPos = ingressPositions.get(sKey);
                  const tPos = servicePositions.get(tKey);
                  if (!sPos || !tPos) return null;
                  const isHot =
                    hover === sKey || hover === tKey;
                  const x1 = sPos.x + NODE_W;
                  const y1 = sPos.y + NODE_H / 2;
                  const x2 = tPos.x;
                  const y2 = tPos.y + NODE_H / 2;
                  // Curved path for a clean look.
                  const cx = (x1 + x2) / 2;
                  return (
                    <path
                      key={i}
                      d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke={
                        isHot ? "var(--accent)" : "var(--border)"
                      }
                      strokeWidth={isHot ? 2 : 1.2}
                      opacity={isHot ? 0.9 : 0.5}
                      markerEnd="url(#arrow)"
                    />
                  );
                })}

                {/* Arrow marker definition */}
                <defs>
                  <marker
                    id="arrow"
                    viewBox="0 0 10 10"
                    refX="10"
                    refY="5"
                    markerWidth="8"
                    markerHeight="8"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-muted)" />
                  </marker>
                </defs>

                {/* Ingress nodes (left column) */}
                {ingresses.map((ing) => {
                  const key = `${ing.namespace}/${ing.name}`;
                  const pos = ingressPositions.get(key);
                  if (!pos) return null;
                  const isHover = hover === key;
                  const borderColor = ing.tls
                    ? "var(--status-ok)"
                    : "var(--status-warn)";
                  return (
                    <g
                      key={key}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      onMouseEnter={() => setHover(key)}
                      onMouseLeave={() => setHover(null)}
                      style={{ cursor: "pointer" }}
                    >
                      <rect
                        width={NODE_W}
                        height={NODE_H}
                        rx={6}
                        fill={
                          isHover
                            ? "var(--surface-2)"
                            : "var(--surface-1)"
                        }
                        stroke={isHover ? "var(--accent)" : borderColor}
                        strokeWidth={isHover ? 2 : 1.5}
                      />
                      <text
                        x={12}
                        y={20}
                        fontSize={12}
                        fontWeight={500}
                        fill="var(--text-primary)"
                      >
                        {ing.name}
                      </text>
                      <text
                        x={12}
                        y={36}
                        fontSize={10}
                        fill="var(--text-muted)"
                      >
                        {ing.host || "(no host)"}
                      </text>
                      <text
                        x={12}
                        y={50}
                        fontSize={9}
                        fill="var(--text-muted)"
                      >
                        {ing.namespace} · {ing.ingressClass}
                      </text>
                    </g>
                  );
                })}

                {/* Service nodes (right column) */}
                {connectedServices.map((svc) => {
                  const key = `${svc.namespace}/${svc.name}`;
                  const pos = servicePositions.get(key);
                  if (!pos) return null;
                  const isHover = hover === key;
                  return (
                    <g
                      key={key}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      onMouseEnter={() => setHover(key)}
                      onMouseLeave={() => setHover(null)}
                      style={{ cursor: "pointer" }}
                    >
                      <rect
                        width={NODE_W}
                        height={NODE_H}
                        rx={6}
                        fill={
                          isHover
                            ? "var(--surface-2)"
                            : "var(--surface-1)"
                        }
                        stroke={isHover ? "var(--accent)" : "var(--border)"}
                        strokeWidth={isHover ? 2 : 1}
                      />
                      <text
                        x={12}
                        y={20}
                        fontSize={12}
                        fontWeight={500}
                        fill="var(--text-primary)"
                      >
                        {svc.name}
                      </text>
                      <text
                        x={12}
                        y={36}
                        fontSize={10}
                        fill="var(--text-muted)"
                      >
                        {svc.type} · {svc.clusterIp}
                      </text>
                      <text
                        x={12}
                        y={50}
                        fontSize={9}
                        fill="var(--text-muted)"
                      >
                        {svc.namespace} · {svc.ports}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className={styles.legend}>
              <span className={styles.legendItem}>
                <span
                  className={styles.dot}
                  style={{ background: "var(--status-ok)" }}
                />
                {t("ingressRoutes.legend.tls", "TLS")}
              </span>
              <span className={styles.legendItem}>
                <span
                  className={styles.dot}
                  style={{ background: "var(--status-warn)" }}
                />
                {t("ingressRoutes.legend.noTls", "No TLS")}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

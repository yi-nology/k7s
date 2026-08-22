/**
 * Topology utility functions for IngressRouteTopology.
 *
 * Extracted to reduce IngressRouteTopology.tsx size and improve reusability.
 */

import type { Row } from '../../providers/types';

export interface IngressInfo {
  name: string;
  namespace: string;
  host: string;
  ingressClass: string;
  tls: boolean;
}

export interface ServiceInfo {
  name: string;
  namespace: string;
  type: string;
  clusterIp: string;
  ports: string;
}

export interface RouteEdge {
  ingress: IngressInfo;
  service: ServiceInfo;
}

/** Extract ingress metadata from a table row.
 *  Columns: NAME, NAMESPACE, HOSTS, CLASS, AGE  (see kinds.ts) */
export function parseIngress(row: Row): IngressInfo {
  const host = row.cells[2]?.text ?? '';
  const ingressClass = row.cells[3]?.text ?? '';
  // TLS detection: the backend now sets `labels.tls = "true"` when
  // spec.tls[] is non-empty. Fall back to the old heuristic for rows
  // that don't carry the label (e.g. from an older backend version).
  const tlsFromLabel = row.labels?.tls === 'true';
  const tlsFromHeuristic =
    ingressClass.toLowerCase().includes('nginx') || ingressClass.toLowerCase().includes('traefik');
  const tls = tlsFromLabel || tlsFromHeuristic;
  return {
    name: row.name,
    namespace: row.namespace ?? '',
    host,
    ingressClass,
    tls,
  };
}

/** Extract service metadata from a table row.
 *  Columns: NAME, NAMESPACE, TYPE, CLUSTER-IP, PORTS, AGE  (see kinds.ts) */
export function parseService(row: Row): ServiceInfo {
  return {
    name: row.name,
    namespace: row.namespace ?? '',
    type: row.cells[0]?.text ?? '',
    clusterIp: row.cells[1]?.text ?? '',
    ports: row.cells[2]?.text ?? '',
  };
}

/** Match ingresses to services. The most common Kubernetes convention is that
 *  an Ingress named "foo" routes to a Service also named "foo" in the same
 *  namespace. We also try matching the hostname prefix against service names
 *  (e.g. host "grafana.example.com" → service "grafana"). */
export function buildRoutes(ingresses: IngressInfo[], services: ServiceInfo[]): RouteEdge[] {
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
    const prefix = ing.host.split('.')[0];
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

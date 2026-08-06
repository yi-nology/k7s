/**
 * Graph construction logic: builds nodes and links from cluster data.
 */

import { getProvider } from '../../providers';
import type { EndpointAddress, EndpointRow } from '../../providers/types';
import type { ClusterGraph, GraphLink, GraphNode } from './types';

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

/**
 * Build the cluster graph from current rows and endpoint data.
 *
 * Two strategies:
 *   - **EndpointSlice-based** (preferred): uses the Kubernetes EndpointSlice API
 *     to discover Service -> Endpoint -> Pod links with ready/not-ready counts.
 *   - **Selector-based** (fallback): when the EndpointSlice API is unavailable,
 *     falls back to matching Service selectors against Pod labels.
 *
 * Ingress nodes are added when they match a Service by name or hostname prefix.
 *
 * @param rows - Current resource rows from the store (services, pods, ingresses).
 * @returns A {@link ClusterGraph} with nodes and links for d3-force rendering.
 *
 * @example
 * ```ts
 * const graph = await buildGraph(store.getState().rows);
 * // graph.nodes.length → number of service/pod/endpoint/ingress nodes
 * // graph.links.length → number of edges
 * ```
 */
export async function buildGraph(rows: {
  services?: { name: string; namespace?: string; selector?: Record<string, string> }[];
  pods?: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    pod?: { status?: string; statusTone?: string; restarts?: number };
    cells: { text: string }[];
  }[];
  ingresses?: { name: string; namespace?: string; cells: { text: string }[] }[];
}): Promise<ClusterGraph> {
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
            const podRow = rows.pods?.find(
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
}

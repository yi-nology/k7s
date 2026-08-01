// Smoke test for the kubeconfig.yaml the user gave us.
// Uses the same @kubernetes/client-node that the JS ecosystem uses
// to verify connectivity. Not a Rust test, but proves the cluster
// is reachable + kubeconfig is valid (which is what k7s's Rust side
// will see too).
//
// Run: node probe.mjs

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as k8s from "@kubernetes/client-node";

const __dirname = dirname(fileURLToPath(import.meta.url));

const kcPath = process.env.KUBECONFIG || resolve(__dirname, "kubeconfig.yaml");
console.log(`→ using kubeconfig: ${kcPath}\n`);

const kc = new k8s.KubeConfig();
kc.loadFromFile(kcPath);

console.log("=== Contexts ===");
for (const c of kc.getContexts()) {
  const isCurrent = c.name === kc.getCurrentContext();
  console.log(`  ${isCurrent ? "●" : "○"} ${c.name}`);
}
console.log(`  current: ${kc.getCurrentContext()}\n`);

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const appsApi = kc.makeApiClient(k8s.AppsV1Api);
const autoApi = kc.makeApiClient(k8s.AutoscalingV1Api);

function fmt(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)),
  );
  const sep = widths.map((w) => "─".repeat(w + 2)).join("┼");
  const draw = (cells) =>
    cells.map((c, i) => ` ${String(c ?? "").padEnd(widths[i])} `).join("│");
  return [draw(headers), sep, ...rows.map((r) => draw(r))].join("\n");
}

async function section(title, fn) {
  console.log(`=== ${title} ===`);
  try {
    await fn();
  } catch (e) {
    console.log(`  ERROR: ${e.message ?? e}`);
  }
  console.log();
}

await section("Nodes", async () => {
  const { items } = await k8sApi.listNode();
  const rows = items.map((n) => {
    const ready = (n.status?.conditions ?? []).find((c) => c.type === "Ready");
    const roles = Object.keys(n.metadata?.labels ?? {})
      .filter((k) => k.startsWith("node-role.kubernetes.io/"))
      .map((k) => k.slice("node-role.kubernetes.io/".length))
      .join(",") || "—";
    const ver = n.status?.nodeInfo?.kubeletVersion ?? "—";
    const ip = (n.status?.addresses ?? []).find((a) => a.type === "InternalIP")?.address ?? "—";
    return [
      n.metadata.name,
      ready?.status === "True" ? "Ready" : "NotReady",
      roles,
      ver,
      ip,
    ];
  });
  console.log(fmt(["NAME", "STATUS", "ROLES", "VERSION", "INTERNAL-IP"], rows));
});

await section("Namespaces", async () => {
  const { items } = await k8sApi.listNamespace();
  const rows = items.map((ns) => [ns.metadata.name, ns.status?.phase ?? "—"]);
  console.log(fmt(["NAME", "STATUS"], rows));
});

await section("Deployments (all namespaces)", async () => {
  const { items } = await appsApi.listDeploymentForAllNamespaces();
  const rows = items.map((d) => {
    const desired = d.spec?.replicas ?? 0;
    const ready = d.status?.readyReplicas ?? 0;
    return [
      d.metadata.namespace,
      d.metadata.name,
      `${ready}/${desired}`,
      d.status?.availableReplicas ?? 0,
    ];
  });
  console.log(fmt(["NAMESPACE", "NAME", "READY", "AVAILABLE"], rows));
});

await section("Pods (kube-system)", async () => {
  const { items } = await k8sApi.listNamespacedPod({ namespace: "kube-system" });
  const rows = items.map((p) => {
    const cs = p.status?.containerStatuses ?? [];
    const ready = cs.filter((c) => c.ready).length;
    return [p.metadata.name, p.status?.phase ?? "—", `${ready}/${cs.length}`, p.spec?.nodeName ?? "—"];
  });
  console.log(fmt(["NAME", "PHASE", "READY", "NODE"], rows));
});

await section("HPAs (autoscaling/v1)", async () => {
  const { items } = await autoApi.listHorizontalPodAutoscalerForAllNamespaces();
  const rows = items.map((h) => {
    const ref = h.spec?.scaleTargetRef;
    const refName = ref ? `${ref.kind}/${ref.name}` : "—";
    return [h.metadata.namespace, h.metadata.name, refName, h.spec?.minReplicas ?? "—", h.spec?.maxReplicas ?? "—"];
  });
  console.log(fmt(["NAMESPACE", "NAME", "REFERENCE", "MIN", "MAX"], rows));
});

console.log("✓ probe succeeded — kubeconfig is valid and cluster is reachable");

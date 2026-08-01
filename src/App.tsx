import { useCallback, useEffect, useMemo, useState } from "react";
import { api, kindLabel } from "./lib/tauri";
import type { ResourceKind } from "./lib/types";
import { Sidebar, type NavItem } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { ResourceTable, type ColumnDef } from "./components/ResourceTable";
import { DetailPanel } from "./components/DetailPanel";
import type {
  ConfigMapRow,
  ContextInfo,
  CronJobRow,
  DaemonSetRow,
  DeploymentRow,
  EventRow,
  HpaRow,
  JobRow,
  NamespaceRow,
  NodeRow,
  PodRow,
  PvcRow,
  ReplicaSetRow,
  SecretRow,
  ServiceRow,
  StatefulSetRow,
} from "./lib/types";

const NAV: NavItem[] = [
  {
    group: "Workloads",
    items: [
      { kind: "pods", label: "Pods", icon: "◎" },
      { kind: "deployments", label: "Deployments", icon: "◧" },
      { kind: "statefulsets", label: "StatefulSets", icon: "▥" },
      { kind: "daemonsets", label: "DaemonSets", icon: "▣" },
      { kind: "replicasets", label: "ReplicaSets", icon: "▤" },
      { kind: "jobs", label: "Jobs", icon: "▶" },
      { kind: "cronjobs", label: "CronJobs", icon: "⏱" },
    ],
  },
  {
    group: "Discovery & LB",
    items: [{ kind: "services", label: "Services", icon: "⇄" }],
  },
  {
    group: "Config & Storage",
    items: [
      { kind: "configmaps", label: "ConfigMaps", icon: "▢" },
      { kind: "secrets", label: "Secrets", icon: "🔒" },
      { kind: "pvc", label: "PVCs", icon: "▦" },
    ],
  },
  {
    group: "Cluster",
    items: [
      { kind: "nodes", label: "Nodes", icon: "▣" },
      { kind: "namespaces", label: "Namespaces", icon: "▦" },
    ],
  },
  {
    group: "Metadata",
    items: [
      { kind: "hpa", label: "HPAs", icon: "↕" },
      { kind: "events", label: "Events", icon: "!" },
    ],
  },
];

const REFRESH_INTERVAL = 10; // seconds

export default function App() {
  const [active, setActive] = useState<ResourceKind>("pods");
  const [contexts, setContexts] = useState<ContextInfo[]>([]);
  const [currentContext, setCurrentContext] = useState<string | null>(null);
  const [namespace, setNamespace] = useState<string>("");
  const [namespaces, setNamespaces] = useState<NamespaceRow[]>([]);

  const [pods, setPods] = useState<PodRow[]>([]);
  const [deployments, setDeployments] = useState<DeploymentRow[]>([]);
  const [statefulsets, setStatefulsets] = useState<StatefulSetRow[]>([]);
  const [daemonsets, setDaemonsets] = useState<DaemonSetRow[]>([]);
  const [replicasets, setReplicasets] = useState<ReplicaSetRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [cronjobs, setCronjobs] = useState<CronJobRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [configmaps, setConfigmaps] = useState<ConfigMapRow[]>([]);
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [pvc, setPvc] = useState<PvcRow[]>([]);
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [hpa, setHpa] = useState<HpaRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshIn, setRefreshIn] = useState(REFRESH_INTERVAL);
  const [detailTarget, setDetailTarget] = useState<{
    kind: string;
    namespace: string | null;
    name: string;
  } | null>(null);

  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  // Initial: load contexts and current selection.
  useEffect(() => {
    (async () => {
      try {
        const [ctxs, current] = await Promise.all([
          api.contexts(),
          api.currentContext(),
        ]);
        setContexts(ctxs);
        setCurrentContext(current ?? ctxs.find((c) => c.is_current)?.name ?? null);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  // Whenever the active context changes, refresh the namespace list.
  useEffect(() => {
    if (!currentContext) return;
    (async () => {
      try {
        setNamespaces(await api.namespaces());
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [currentContext]);

  // Reload the active resource whenever selection / context / namespace / token changes.
  useEffect(() => {
    if (!currentContext) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedIndex(0);
    (async () => {
      const ns = namespace || undefined;
      try {
        switch (active) {
          case "pods":
            setPods(await api.pods(ns));
            break;
          case "deployments":
            setDeployments(await api.deployments(ns));
            break;
          case "statefulsets":
            setStatefulsets(await api.statefulsets(ns));
            break;
          case "daemonsets":
            setDaemonsets(await api.daemonsets(ns));
            break;
          case "replicasets":
            setReplicasets(await api.replicasets(ns));
            break;
          case "jobs":
            setJobs(await api.jobs(ns));
            break;
          case "cronjobs":
            setCronjobs(await api.cronjobs(ns));
            break;
          case "services":
            setServices(await api.services(ns));
            break;
          case "configmaps":
            setConfigmaps(await api.configmaps(ns));
            break;
          case "secrets":
            setSecrets(await api.secrets(ns));
            break;
          case "pvc":
            setPvc(await api.pvc(ns));
            break;
          case "nodes":
            setNodes(await api.nodes());
            break;
          case "namespaces":
            setNamespaces(await api.namespaces());
            break;
          case "hpa":
            setHpa(await api.hpa(ns));
            break;
          case "events":
            setEvents(await api.events(ns));
            break;
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, currentContext, namespace, reloadToken]);

  // Auto-refresh tick + countdown
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      setRefreshIn((n) => {
        if (n <= 1) {
          reload();
          return REFRESH_INTERVAL;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, reload]);

  // Hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't capture when user is typing
      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, currentRowsLength() - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "g" && !e.shiftKey) {
        e.preventDefault();
        setSelectedIndex(0);
      } else if (e.key === "G" || (e.key === "g" && e.shiftKey)) {
        e.preventDefault();
        setSelectedIndex(Math.max(0, currentRowsLength() - 1));
      } else if (e.key === "Enter") {
        const row = currentRows()[selectedIndex];
        if (row) {
          openDetail(row);
        }
      } else if (e.key === "d") {
        const row = currentRows()[selectedIndex];
        if (row) {
          openDetail(row);
        }
      } else if (e.key === "r") {
        e.preventDefault();
        reload();
        setRefreshIn(REFRESH_INTERVAL);
      } else if (e.key === "Escape") {
        setDetailTarget(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const currentRowsLength = () => {
    switch (active) {
      case "pods": return pods.length;
      case "deployments": return deployments.length;
      case "statefulsets": return statefulsets.length;
      case "daemonsets": return daemonsets.length;
      case "replicasets": return replicasets.length;
      case "jobs": return jobs.length;
      case "cronjobs": return cronjobs.length;
      case "services": return services.length;
      case "configmaps": return configmaps.length;
      case "secrets": return secrets.length;
      case "pvc": return pvc.length;
      case "nodes": return nodes.length;
      case "namespaces": return namespaces.length;
      case "hpa": return hpa.length;
      case "events": return events.length;
    }
  };

  const currentRows = (): Record<string, unknown>[] => {
    const list: Record<string, unknown>[] = active === "namespaces"
      ? (namespaces as unknown as Record<string, unknown>[])
      : (() => {
          switch (active) {
            case "pods": return pods as unknown as Record<string, unknown>[];
            case "deployments": return deployments as unknown as Record<string, unknown>[];
            case "statefulsets": return statefulsets as unknown as Record<string, unknown>[];
            case "daemonsets": return daemonsets as unknown as Record<string, unknown>[];
            case "replicasets": return replicasets as unknown as Record<string, unknown>[];
            case "jobs": return jobs as unknown as Record<string, unknown>[];
            case "cronjobs": return cronjobs as unknown as Record<string, unknown>[];
            case "services": return services as unknown as Record<string, unknown>[];
            case "configmaps": return configmaps as unknown as Record<string, unknown>[];
            case "secrets": return secrets as unknown as Record<string, unknown>[];
            case "pvc": return pvc as unknown as Record<string, unknown>[];
            case "nodes": return nodes as unknown as Record<string, unknown>[];
            case "hpa": return hpa as unknown as Record<string, unknown>[];
            case "events": return events as unknown as Record<string, unknown>[];
            default: return [];
          }
        })();
    if (!filter) return list;
    return list.filter((r) =>
      Object.values(r).some((v) =>
        String(v ?? "").toLowerCase().includes(filter.toLowerCase()),
      ),
    );
  };

  const openDetail = (row: Record<string, unknown>) => {
    const name = String(row.name ?? "");
    const ns = (row.namespace as string | undefined) || null;
    setDetailTarget({
      kind: kindLabel[active].capital,
      namespace: active === "nodes" || active === "namespaces" ? null : ns,
      name,
    });
  };

  const onPickContext = async (name: string) => {
    try {
      await api.setContext(name);
      setCurrentContext(name);
    } catch (e) {
      setError(String(e));
    }
  };

  const columns: ColumnDef[] = useMemo(() => {
    switch (active) {
      case "pods":
        return [
          { key: "name", label: "Name", width: "32%" },
          { key: "namespace", label: "Namespace", width: "14%" },
          { key: "ready", label: "Ready", width: "8%" },
          { key: "status", label: "Status", width: "10%" },
          { key: "restarts", label: "Restarts", width: "8%", align: "right" },
          { key: "age", label: "Age", width: "6%", align: "right" },
          { key: "node", label: "Node", width: "14%" },
          { key: "ip", label: "IP", width: "8%" },
        ];
      case "deployments":
        return [
          { key: "name", label: "Name", width: "36%" },
          { key: "namespace", label: "Namespace", width: "16%" },
          { key: "ready", label: "Ready", width: "10%" },
          { key: "up_to_date", label: "Up-to-date", width: "12%", align: "right" },
          { key: "available", label: "Available", width: "12%", align: "right" },
          { key: "age", label: "Age", width: "8%", align: "right" },
        ];
      case "statefulsets":
        return [
          { key: "name", label: "Name", width: "44%" },
          { key: "namespace", label: "Namespace", width: "20%" },
          { key: "ready", label: "Ready", width: "16%" },
          { key: "age", label: "Age", width: "10%", align: "right" },
        ];
      case "daemonsets":
        return [
          { key: "name", label: "Name", width: "40%" },
          { key: "namespace", label: "Namespace", width: "18%" },
          { key: "desired", label: "Desired", width: "10%", align: "right" },
          { key: "ready", label: "Ready", width: "10%", align: "right" },
          { key: "age", label: "Age", width: "10%", align: "right" },
        ];
      case "replicasets":
        return [
          { key: "name", label: "Name", width: "44%" },
          { key: "namespace", label: "Namespace", width: "20%" },
          { key: "desired", label: "Desired", width: "10%", align: "right" },
          { key: "ready", label: "Ready", width: "10%" },
          { key: "age", label: "Age", width: "10%", align: "right" },
        ];
      case "jobs":
        return [
          { key: "name", label: "Name", width: "34%" },
          { key: "namespace", label: "Namespace", width: "16%" },
          { key: "status", label: "Status", width: "12%" },
          { key: "completions", label: "Completions", width: "14%" },
          { key: "duration", label: "Duration", width: "10%" },
          { key: "age", label: "Age", width: "8%", align: "right" },
        ];
      case "cronjobs":
        return [
          { key: "name", label: "Name", width: "26%" },
          { key: "namespace", label: "Namespace", width: "16%" },
          { key: "schedule", label: "Schedule", width: "22%" },
          { key: "suspend", label: "Suspend", width: "10%" },
          { key: "last_schedule", label: "Last", width: "12%" },
          { key: "age", label: "Age", width: "8%", align: "right" },
        ];
      case "services":
        return [
          { key: "name", label: "Name", width: "28%" },
          { key: "namespace", label: "Namespace", width: "14%" },
          { key: "kind", label: "Type", width: "10%" },
          { key: "cluster_ip", label: "Cluster IP", width: "14%" },
          { key: "ports", label: "Ports", width: "22%" },
          { key: "age", label: "Age", width: "8%", align: "right" },
        ];
      case "configmaps":
        return [
          { key: "name", label: "Name", width: "44%" },
          { key: "namespace", label: "Namespace", width: "22%" },
          { key: "data_keys", label: "Data Keys", width: "14%", align: "right" },
          { key: "age", label: "Age", width: "10%", align: "right" },
        ];
      case "secrets":
        return [
          { key: "name", label: "Name", width: "40%" },
          { key: "namespace", label: "Namespace", width: "20%" },
          { key: "kind", label: "Type", width: "14%" },
          { key: "data_keys", label: "Data Keys", width: "10%", align: "right" },
          { key: "age", label: "Age", width: "10%", align: "right" },
        ];
      case "pvc":
        return [
          { key: "name", label: "Name", width: "32%" },
          { key: "namespace", label: "Namespace", width: "16%" },
          { key: "status", label: "Status", width: "10%" },
          { key: "volume", label: "Volume", width: "18%" },
          { key: "capacity", label: "Capacity", width: "12%" },
          { key: "age", label: "Age", width: "8%", align: "right" },
        ];
      case "nodes":
        return [
          { key: "name", label: "Name", width: "30%" },
          { key: "status", label: "Status", width: "10%" },
          { key: "roles", label: "Roles", width: "16%" },
          { key: "version", label: "Version", width: "14%" },
          { key: "internal_ip", label: "Internal IP", width: "16%" },
          { key: "age", label: "Age", width: "8%", align: "right" },
        ];
      case "namespaces":
        return [
          { key: "name", label: "Name", width: "60%" },
          { key: "status", label: "Status", width: "20%" },
          { key: "age", label: "Age", width: "20%", align: "right" },
        ];
      case "hpa":
        return [
          { key: "name", label: "Name", width: "26%" },
          { key: "namespace", label: "Namespace", width: "14%" },
          { key: "reference", label: "Reference", width: "20%" },
          { key: "targets", label: "Targets", width: "10%" },
          { key: "min_replicas", label: "Min", width: "8%", align: "right" },
          { key: "max_replicas", label: "Max", width: "8%", align: "right" },
          { key: "age", label: "Age", width: "8%", align: "right" },
        ];
      case "events":
        return [
          { key: "type_", label: "Type", width: "8%" },
          { key: "namespace", label: "Namespace", width: "14%" },
          { key: "kind", label: "Kind", width: "10%" },
          { key: "object", label: "Object", width: "22%" },
          { key: "reason", label: "Reason", width: "14%" },
          { key: "message", label: "Message", width: "20%" },
          { key: "last_seen", label: "Last Seen", width: "8%" },
          { key: "count", label: "Cnt", width: "4%", align: "right" },
        ];
    }
  }, [active]);

  const rows = useMemo(() => currentRows(), [
    active, pods, deployments, statefulsets, daemonsets, replicasets,
    jobs, cronjobs, services, configmaps, secrets, pvc, nodes, namespaces,
    hpa, events, filter,
  ]);

  return (
    <div className="app">
      <TopBar
        contexts={contexts}
        currentContext={currentContext}
        namespaces={namespaces}
        namespace={namespace}
        onPickContext={onPickContext}
        onPickNamespace={setNamespace}
        onRefreshNow={reload}
        loading={loading}
        refreshIn={refreshIn}
        filter={filter}
        onFilterChange={setFilter}
        onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
        autoRefresh={autoRefresh}
      />
      <div className="body">
        <Sidebar
          nav={NAV}
          active={active}
          onPick={setActive}
          contextName={currentContext}
        />
        <main className="main">
          {error ? (
            <div className="error">
              <div className="error-title">⚠ Failed to load</div>
              <pre className="error-body">{error}</pre>
              <div className="error-hint">
                Check that your kubeconfig is valid and the cluster is reachable.
              </div>
            </div>
          ) : (
            <ResourceTable
              columns={columns}
              rows={rows}
              loading={loading}
              emptyHint={
                currentContext
                  ? rows.length === 0 && filter
                    ? `No rows match "${filter}".`
                    : "No resources in this view."
                  : "Select a context from the top bar to start."
              }
              selectedIndex={selectedIndex}
              onSelectIndex={setSelectedIndex}
              filter=""
            />
          )}
        </main>
      </div>
      {detailTarget && (
        <DetailPanel
          kind={detailTarget.kind}
          namespace={detailTarget.namespace}
          name={detailTarget.name}
          onClose={() => setDetailTarget(null)}
          onDeleted={reload}
        />
      )}
    </div>
  );
}

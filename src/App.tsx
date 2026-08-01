/**
 * App — the single root component.
 *
 * Owns:
 *   - The active kind + namespace
 *   - The `Map<kind, Row[]>` populated by `resource-update` events
 *   - Cluster status (from `cluster-status` events)
 *   - Watch count (from `watch-status` events)
 *
 * On mount: list contexts, connect to the current one, start listening.
 * On unmount: unsub everything.
 *
 * The Rust backend owns the watcher lifecycle. We never call `list_*`
 * here — we just listen to `resource-update`. For kinds that aren't
 * watched yet (e.g. ingresses — not in the default set), the table
 * renders an empty state and a future P1.5 can start on-demand watchers.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { provider } from "./providers";
import type {
  ClusterInfo,
  ClusterStatus,
  ContextInfo,
  ResourceSnapshot,
  Row,
  Unsub,
} from "./providers/types";
import { columnsFor, DEFAULT_KIND, NAV, apiKindFor } from "./providers/columns";

import { Sidebar } from "./components/sidebar/Sidebar";
import { TopBar } from "./components/topbar/TopBar";
import { StatusBar } from "./components/statusbar/StatusBar";
import { ResourceTable } from "./components/table/ResourceTable";
import { DetailPanel } from "./components/detail/DetailPanel";
import { LogsModal } from "./components/LogsModal";
import { ExecModal } from "./components/ExecModal";
import { PortForwardModal } from "./components/PortForwardModal";
import { ActionBar } from "./components/actions/ActionBar";
import { CommandPalette, type Command } from "./components/CommandPalette";

export default function App() {
  // ---- connection state ----
  const [contexts, setContexts] = useState<ContextInfo[]>([]);
  const [currentContext, setCurrentContext] = useState<string | null>(null);
  const [clusterInfo, setClusterInfo] = useState<ClusterInfo | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // ---- UI state ----
  const [activeKind, setActiveKind] = useState<string>(DEFAULT_KIND);
  const [namespace, setNamespace] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailRow, setDetailRow] = useState<Row | null>(null);
  const [detailTab, setDetailTab] = useState<"yaml" | "events" | "properties">("yaml");
  const [logsRow, setLogsRow] = useState<Row | null>(null);
  const [execRow, setExecRow] = useState<Row | null>(null);
  const [pfRow, setPfRow] = useState<Row | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ---- live data ----
  const [rowsByKind, setRowsByKind] = useState<Map<string, Row[]>>(new Map());
  const [status, setStatus] = useState<ClusterStatus>({
    connected: false,
    version: "",
    apiLatencyMs: 0,
    nodesReady: 0,
    nodesTotal: 0,
    cpuPercent: null,
    memPercent: null,
  });
  const [activeWatchers, setActiveWatchers] = useState(0);

  // ---- connect on mount, subscribe to events ----
  useEffect(() => {
    let cancelled = false;
    let unsubResource: Unsub | null = null;
    let unsubStatus: Unsub | null = null;
    let unsubWatch: Unsub | null = null;

    (async () => {
      try {
        const ctxs = await provider.listContexts();
        if (cancelled) return;
        setContexts(ctxs);
        const initial =
          ctxs.find((c) => c.isCurrent)?.name ?? ctxs[0]?.name ?? null;
        if (!initial) return;
        setCurrentContext(initial);

        const info = await provider.connect(initial);
        if (cancelled) return;
        setClusterInfo(info);
        setConnected(true);

        unsubResource = provider.onResourceUpdate((snap: ResourceSnapshot) => {
          if (cancelled) return;
          setRowsByKind((prev) => {
            const next = new Map(prev);
            next.set(snap.kind, snap.rows);
            return next;
          });
        });
        unsubStatus = provider.onClusterStatus((s) => {
          if (cancelled) return;
          setStatus(s);
        });
        unsubWatch = provider.onWatchStatus((n) => {
          if (cancelled) return;
          setActiveWatchers(n);
        });
      } catch (e) {
        if (cancelled) return;
        setConnectError(String(e));
      }
    })();

    return () => {
      cancelled = true;
      unsubResource?.();
      unsubStatus?.();
      unsubWatch?.();
      provider.disconnect().catch(() => {});
    };
  }, []);

  // Reset selection when kind or filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [activeKind, filter]);

  // ---- derived ----
  const rows = useMemo(() => rowsByKind.get(activeKind) ?? [], [rowsByKind, activeKind]);
  const namespaces = useMemo(() => rowsByKind.get("namespaces") ?? [], [rowsByKind]);
  const clusterScoped = useMemo(
    () => activeKind === "nodes" || activeKind === "namespaces",
    [activeKind],
  );

  // Namespace filter applies client-side to all kinds.
  const filteredRows = useMemo(() => {
    if (clusterScoped || !namespace) return rows;
    return rows.filter((r) => r.namespace === namespace);
  }, [rows, namespace, clusterScoped]);

  const columns = useMemo(() => columnsFor(activeKind), [activeKind]);
  const selectedRow = filteredRows[selectedIndex];

  // ---- handlers ----
  const onPickContext = useCallback(async (name: string) => {
    if (name === currentContext) return;
    setCurrentContext(name);
    setRowsByKind(new Map());
    setSelectedIndex(0);
    setConnected(false);
    try {
      const info = await provider.connect(name);
      setClusterInfo(info);
      setConnected(true);
    } catch (e) {
      setConnectError(String(e));
    }
  }, [currentContext]);

  const onPickNamespace = useCallback((ns: string) => {
    setNamespace(ns);
    setSelectedIndex(0);
  }, []);

  const onPickKind = useCallback((kind: string) => {
    setActiveKind(kind);
    setSelectedIndex(0);
  }, []);

  const onActivate = useCallback((row: Row) => {
    setDetailRow(row);
    setDetailTab("yaml");
  }, []);

  const onCloseDetail = useCallback(() => setDetailRow(null), []);

  const onOpenLogs = useCallback((row: Row) => setLogsRow(row), []);
  const onCloseLogs = useCallback(() => setLogsRow(null), []);

  const onOpenExec = useCallback((row: Row) => setExecRow(row), []);
  const onCloseExec = useCallback(() => setExecRow(null), []);

  const onOpenPortForward = useCallback((row: Row) => setPfRow(row), []);
  const onClosePortForward = useCallback(() => setPfRow(null), []);

  // Dispatch a command from the palette against the current selection.
  // Same paths as the hotkeys, so palette :y == y key, etc.
  const runCommand = useCallback(
    (cmd: Command) => {
      if (!selectedRow) {
        // For some commands we have a reasonable default, but most
        // need a selection. Fall through silently.
        return;
      }
      switch (cmd) {
        case "yaml":
          setDetailRow(selectedRow);
          setDetailTab("yaml");
          break;
        case "describe":
          setDetailRow(selectedRow);
          setDetailTab("properties");
          break;
        case "exec":
          if (activeKind === "pods") onOpenExec(selectedRow);
          break;
        case "logs":
          if (activeKind === "pods" || selectedRow.pod) onOpenLogs(selectedRow);
          break;
        case "port-forward":
          if (activeKind === "pods" || activeKind === "services") {
            onOpenPortForward(selectedRow);
          }
          break;
        case "scale":
        case "restart":
        case "delete":
          // These flow through ActionBar buttons — the palette
          // exists for navigation, not for triggering the same
          // confirm flows twice. We can wire them later if desired.
          break;
      }
    },
    [selectedRow, activeKind, onOpenExec, onOpenLogs, onOpenPortForward],
  );

  const onJump = useCallback(
    (kind: string, row: Row) => {
      setActiveKind(kind);
      // Find the row in the live snapshot to set the right index.
      const list = rowsByKind.get(kind) ?? [];
      const idx = list.findIndex((r) => r.uid === row.uid);
      setSelectedIndex(idx >= 0 ? idx : 0);
    },
    [rowsByKind],
  );

  // k9s-style shortcut handlers — used by the keyboard listener.
  const openLogs = useCallback(() => {
    if (selectedRow && (activeKind === "pods" || selectedRow.pod)) {
      onOpenLogs(selectedRow);
    }
  }, [selectedRow, activeKind, onOpenLogs]);

  const openExec = useCallback(() => {
    if (selectedRow && activeKind === "pods") {
      onOpenExec(selectedRow);
    }
  }, [selectedRow, activeKind, onOpenExec]);

  const openPortForward = useCallback(() => {
    if (pfRow === null && selectedRow && (activeKind === "pods" || activeKind === "services")) {
      onOpenPortForward(selectedRow);
    }
  }, [pfRow, selectedRow, activeKind, onOpenPortForward, onOpenPortForward]);

  // ---- hotkeys ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K / Ctrl-K is global — works even with focus in the filter
      // input. This matches k9s and the standard palette UX.
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const total = filteredRows.length;
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, Math.max(0, total - 1)));
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(0, i - 1));
          break;
        case "g":
          if (!e.shiftKey) {
            e.preventDefault();
            setSelectedIndex(0);
          } else {
            e.preventDefault();
            setSelectedIndex(Math.max(0, total - 1));
          }
          break;
        case "G":
          e.preventDefault();
          setSelectedIndex(Math.max(0, total - 1));
          break;
        case "Enter":
        case "d":
          if (selectedRow) {
            e.preventDefault();
            onActivate(selectedRow);
          }
          break;
        case "y":
          if (selectedRow) {
            e.preventDefault();
            setDetailRow(selectedRow);
            setDetailTab("yaml");
          }
          break;
        case "e":
          if (activeKind === "pods" && selectedRow) {
            e.preventDefault();
            openLogs();
          }
          break;
        case "x":
        case "X":
          if (activeKind === "pods" && selectedRow) {
            e.preventDefault();
            openExec();
          }
          break;
        case "f":
        case "F":
          if (activeKind === "pods" || activeKind === "services") {
            e.preventDefault();
            openPortForward();
          }
          break;
        case "Escape":
          setDetailRow(null);
          setLogsRow(null);
          setExecRow(null);
          setPfRow(null);
          setPaletteOpen(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    filteredRows.length,
    selectedRow,
    onActivate,
    openLogs,
    openExec,
    openPortForward,
    activeKind,
  ]);

  // ---- view ----
  return (
    <div className="app">
      <Sidebar
        nav={NAV}
        active={activeKind}
        onPick={onPickKind}
        contextName={currentContext}
      />
      <main className="main">
        <TopBar
          contexts={contexts}
          currentContext={currentContext}
          namespaces={namespaces}
          namespace={namespace}
          onPickContext={onPickContext}
          onPickNamespace={onPickNamespace}
          filter={filter}
          onFilterChange={setFilter}
          clusterName={clusterInfo?.clusterName}
        />
        <div className="content">
          {connectError ? (
            <div className="error-banner">
              <strong>Connection error:</strong> {connectError}
            </div>
          ) : null}
          {selectedRow && (
            <ActionBar
              row={selectedRow}
              kind={activeKind}
              onOpenLogs={onOpenLogs}
              onOpenExec={onOpenExec}
              onOpenPortForward={onOpenPortForward}
            />
          )}
          <ResourceTable
            columns={columns}
            rows={filteredRows}
            loading={connected && rows.length === 0}
            emptyHint={
              !connected
                ? "Not connected to a cluster."
                : rows.length === 0
                  ? "No resources found."
                  : filteredRows.length === 0
                    ? "No matches in this namespace."
                    : "—"
            }
            selectedIndex={selectedIndex}
            filter={filter}
            onSelectIndex={setSelectedIndex}
            onActivate={onActivate}
          />
        </div>
        <StatusBar status={status} activeWatchers={activeWatchers} />
      </main>
      {detailRow && (
        <DetailPanel
          row={detailRow}
          kindLabel={apiKindFor(activeKind)}
          onClose={onCloseDetail}
          initialTab={detailTab}
        />
      )}
      {logsRow && (
        <LogsModal
          row={logsRow}
          container={logsRow.pod?.containers[0] ?? null}
          onClose={onCloseLogs}
        />
      )}
      {execRow && (
        <ExecModal
          row={execRow}
          container={execRow.pod?.containers[0] ?? null}
          onClose={onCloseExec}
        />
      )}
      {pfRow && (
        <PortForwardModal
          row={pfRow}
          onClose={onClosePortForward}
        />
      )}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        rowsByKind={rowsByKind}
        activeKind={activeKind}
        onCommand={runCommand}
        onJump={onJump}
        onPickKind={onPickKind}
      />
    </div>
  );
}

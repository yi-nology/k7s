/**
 * App bootstrap hook: subscribes the store to the data provider's push events and
 * kicks off the initial connection. Mounted once at the app root.
 *
 * Kept provider-agnostic — it works identically for MockProvider (demo) and
 * TauriProvider (real cluster). The subscriptions are torn down on unmount so a
 * hot reload or window close doesn't leak listeners.
 */

import { useEffect } from "react";
import { getProvider, IS_DEMO } from "../providers";
import { useStore } from "../store";
import { connectTo } from "../lib/connect";
import { reconcileClusterStatus } from "../lib/clusterStatus";
import { isCustomKind, KIND_META } from "../lib/kinds";
import { sanitizeSettings } from "../lib/settings";

export function useBootstrap(): void {
  useEffect(() => {
    const provider = getProvider();
    const {
      setRows,
      setPodMetrics,
      setNodeMetrics,
      setClusterStatus,
      setWatchCount,
      setConnection,
      setContexts,
      setCustomKinds,
      setPortForwards,
      setDrain,
      addNodeSample,
      setNodeStatsError,
      addPodSample,
    } = useStore.getState();

    // Reconcile cluster-status into the connection lifecycle (Story 6.2): a live
    // cluster going unreachable flips the UI to disconnected, and recovery flips it
    // back — without a manual reconnect. Also clears stale metrics when the
    // metrics API disappears (cpuPercent goes null) so CPU/MEM fall back to "—".
    // The reconciliation lives in `lib/clusterStatus` so it can be unit-tested
    // with a hand-rolled store, and so the context gate (drops stale events
    // from a previous cluster) sits in exactly one place.
    const onClusterStatus = (status: Parameters<typeof setClusterStatus>[0]) => {
      // Re-read on every push so the reconciliation sees the latest connection
      // phase (the destructured `setConnection` would be stale after a
      // `connectTo` race; see connect.ts for the same pattern).
      reconcileClusterStatus(status, useStore.getState());
    };

    // Wire every push channel to its store setter. Each returns an unsubscribe fn.
    const unsubs = [
      provider.onResourceUpdate(setRows),
      provider.onPodMetrics(setPodMetrics),
      provider.onNodeMetrics(setNodeMetrics),
      provider.onClusterStatus(onClusterStatus),
      provider.onWatchStatus(setWatchCount),
      provider.onWatchKindStatus((kind, status) => {
        useStore.getState().setWatchStatus(kind, status);
      }),
      // CRD-backed kinds, re-emitted on every connect (B15).
      provider.onCustomKinds(setCustomKinds),
      // Forwards are pushed on add/remove/failure, so a forward that starts
      // failing turns red without the strip polling for it (B16).
      provider.onForwards(setPortForwards),
      // Node drain progress (B20) — lands in the store so it survives navigation.
      provider.onDrainProgress(setDrain),
      // node-exporter samples (B27). Subscribed for the app's lifetime, but the
      // backend only emits for nodes whose Metrics tab is open.
      provider.onNodeStats(addNodeSample),
      provider.onNodeStatsError((e) => setNodeStatsError(e.node, e.message)),
      // Per-pod samples, emitted only for the pod whose Metrics tab is open.
      provider.onPodStats(addPodSample),
    ];

    // Discover contexts, restore saved preferences, then connect (B11).
    setConnection({ phase: "connecting" });
    void (async () => {
      try {
        // Prefs first: imported kubeconfigs must be re-registered *before* the
        // context list is fetched, or their contexts wouldn't be in it (B17).
        const prefs = await provider.loadPrefs();

        if (prefs?.importedFiles?.length) {
          // Files that no longer parse are dropped from what we persist, so a
          // deleted kubeconfig prunes itself instead of warning forever.
          const alive = await provider.restoreImports(prefs.importedFiles);
          useStore.getState().setImportedFiles(alive);
        }

        const contexts = await provider.listContexts();
        setContexts(contexts);

        // Restore last nav/namespace/timestamps before connecting.
        if (prefs) {
          const restore: Partial<ReturnType<typeof useStore.getState>> = {};
          // Settings first: the default namespace below is only a fallback for
          // when no namespace was persisted, and it comes from here (B23).
          restore.settings = sanitizeSettings({
            logBufferCap: prefs.logBufferCap ?? undefined,
            metricsIntervalSecs: prefs.metricsIntervalSecs ?? undefined,
            statusIntervalSecs: prefs.statusIntervalSecs ?? undefined,
            defaultNamespace: prefs.defaultNamespace ?? undefined,
            shellCommand: prefs.shellCommand ?? undefined,
            theme: prefs.theme ?? undefined,
            language: prefs.language ?? undefined,
            nodeShellImage: prefs.nodeShellImage ?? undefined,
          });
          // Custom kinds aren't in KIND_META and aren't discovered yet at this
          // point, so accept any custom-looking id; if this cluster turns out not
          // to have that CRD, the table just renders empty (B15).
          if (prefs.nav && (prefs.nav in KIND_META || isCustomKind(prefs.nav))) {
            restore.nav = prefs.nav;
          } else {
            // No persisted nav preference: land on the Dashboard overlay instead
            // of defaulting to the Pods table.
            restore.overlay = "dashboard";
          }
          // Where you left off wins; the configured default is what a fresh
          // profile (or a cleared namespace) falls back to.
          restore.namespace =
            typeof prefs.namespace === "string" ? prefs.namespace : restore.settings.defaultNamespace;
          if (typeof prefs.showTimestamps === "boolean") restore.showTimestamps = prefs.showTimestamps;
          if (Array.isArray(prefs.hotbar)) restore.hotbar = prefs.hotbar;
          if (Object.keys(restore).length) useStore.setState(restore);
        } else {
          // No prefs at all (first launch): land on the Dashboard overlay.
          useStore.setState({ overlay: "dashboard" });
        }

        // Prefer the saved context if it still exists, else the current-context.
        const saved = prefs?.context ? contexts.find((c) => c.name === prefs.context) : undefined;
        const target = saved ?? contexts.find((c) => c.current) ?? contexts[0];
        if (!target) {
          setConnection({ phase: "error", error: "no kubeconfig contexts found" });
          return;
        }
        await connectTo(target.name);
      } catch (e) {
        setConnection({ phase: "error", error: e instanceof Error ? e.message : String(e) });
      }
    })();

    // Persist relevant state changes (debounced). No-op in demo mode.
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let lastSaved = "";
    const unsubSave = IS_DEMO
      ? () => {}
      : useStore.subscribe((s) => {
          const prefs = {
            context: s.connection.context,
            nav: s.nav,
            namespace: s.namespace,
            showTimestamps: s.showTimestamps,
            // Persisted so imported contexts survive a relaunch (B17).
            importedFiles: s.importedFiles,
            // Pinned contexts for the sidebar hotbar.
            hotbar: s.hotbar,
            // Settings (B23). The backend reads the poll intervals and shell
            // command straight out of this same file.
            ...s.settings,
          };
          const key = JSON.stringify(prefs);
          if (key === lastSaved) return;
          lastSaved = key;
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => void provider.savePrefs(prefs), 500);
        });

    return () => {
      for (const off of unsubs) off();
      unsubSave();
      clearTimeout(saveTimer);
    };
    // Empty deps: run exactly once for the app's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

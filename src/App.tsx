/**
 * App root — the single-window shell (Design §Overview).
 *
 * Layout: Sidebar | (TopBar / content / StatusBar). The content region hosts the
 * resource table and pod detail panel (added in Epics 4 and 5); for now it shows a
 * placeholder so the shell (sidebar, top bar, status bar) can be verified.
 */

import styles from "./App.module.css";
import { useBootstrap } from "./hooks/useBootstrap";
import { useCustomKindWatch } from "./hooks/useCustomKindWatch";
import { useGlobalKeys } from "./hooks/useGlobalKeys";
import { useTheme } from "./hooks/useTheme";
import { useLocaleSync } from "./hooks/useI18n";
import { Sidebar } from "./components/sidebar/Sidebar";
import { TopBar } from "./components/topbar/TopBar";
import { StatusBar } from "./components/statusbar/StatusBar";
import { ResourceTable } from "./components/table/ResourceTable";
import { DetailPanel } from "./components/detail/DetailPanel";
import { ForwardsBar } from "./components/forwards/ForwardsBar";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { CommandPalette } from "./components/palette/CommandPalette";
import { useStore } from "./store";
import { HelmMarket } from "./components/helm/HelmMarket";
import { PodFilesPanel } from "./components/podfiles/PodFilesPanel";
import { ImageRepoPanel } from "./components/imagerepo/ImageRepoPanel";
import { TemplatePicker } from "./components/templates/TemplatePicker";
import { Dashboard } from "./components/dashboard/Dashboard";
import { MetricsExplorer } from "./components/metrics/MetricsExplorer";
import { GrafanaPanel } from "./components/grafana/GrafanaPanel";
import { EndpointsPanel } from "./components/endpoints/EndpointsPanel";
import { TopologyPanel } from "./components/topology/TopologyPanel";
import { AlertsPanel } from "./components/alerting/AlertsPanel";

export default function App() {
  // Wire provider → store and connect on mount.
  useBootstrap();
  // App-level keyboard shortcuts (Esc cascade, detail tab cycling).
  useGlobalKeys();
  // Watch the open CRD kind, and only that one (B15).
  useCustomKindWatch();
  // Apply the colour palette to <html> and follow the OS when set to "system" (B52).
  useTheme();
  // Mirror the active locale onto <html lang> so screen readers and the
  // browser's widgets (spell-check, etc.) follow the user's pick.
  useLocaleSync();

  // Which feature overlay is open, if any (Phase 1/2/4/5 entry points).
  const overlay = useStore((s) => s.overlay);
  const overlayPodRef = useStore((s) => s.overlayPodRef);
  const closeOverlay = useStore((s) => s.closeOverlay);

  return (
    <div className={styles.app}>
      <Sidebar />
      <div className={styles.main}>
        <TopBar />
        <div className={styles.content}>
          {overlay === null && (
            <>
              <ResourceTable />
              <DetailPanel />
            </>
          )}
          {overlay === "helm-market" && (
            <div className={styles.overlay}>
              <HelmMarket onClose={closeOverlay} />
            </div>
          )}
          {overlay === "pod-files" && (
            <div className={styles.overlay}>
              {overlayPodRef ? (
                <PodFilesPanel
                  ref={{
                    kind: "pods",
                    namespace: overlayPodRef.namespace,
                    name: overlayPodRef.name,
                  }}
                  container={overlayPodRef.container}
                  onClose={closeOverlay}
                />
              ) : (
                // No pod picked yet — show a friendly empty state.
                <div className={styles.overlayEmpty}>
                  Open Pod Files from a Pod's row context menu.
                </div>
              )}
            </div>
          )}
          {overlay === "image-repos" && (
            <div className={styles.overlay}>
              <ImageRepoPanel onClose={closeOverlay} />
            </div>
          )}
          {overlay === "templates" && (
            <div className={styles.overlay}>
              <TemplatePicker onClose={closeOverlay} />
            </div>
          )}
          {overlay === "dashboard" && (
            <div className={styles.overlay}>
              <Dashboard />
            </div>
          )}
          {overlay === "metrics" && (
            <div className={styles.overlay}>
              <MetricsExplorer onClose={closeOverlay} />
            </div>
          )}
          {overlay === "grafana" && (
            <div className={styles.overlay}>
              <GrafanaPanel onClose={closeOverlay} />
            </div>
          )}
          {overlay === "endpoints" && (
            <div className={styles.overlay}>
              <EndpointsPanel onClose={closeOverlay} />
            </div>
          )}
          {overlay === "topology" && (
            <div className={styles.overlay}>
              <TopologyPanel onClose={closeOverlay} />
            </div>
          )}
          {overlay === "alerting" && (
            <div className={styles.overlay}>
              <AlertsPanel onClose={closeOverlay} />
            </div>
          )}
        </div>
        <ForwardsBar />
        <StatusBar />
      </div>
      {/* Modals, outside the layout flow. The palette is last so it layers over
          everything — ⌘K works from anywhere, including the settings panel. */}
      <SettingsPanel />
      <CommandPalette />
    </div>
  );
}

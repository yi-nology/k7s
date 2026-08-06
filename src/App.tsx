/**
 * App root — the single-window shell (Design §Overview).
 *
 * Layout: Sidebar | (TopBar / content / StatusBar). The content region hosts the
 * resource table and pod detail panel (added in Epics 4 and 5); for now it shows a
 * placeholder so the shell (sidebar, top bar, status bar) can be verified.
 */

import styles from './App.module.css';
import { useBootstrap } from './hooks/useBootstrap';
import { useCustomKindWatch } from './hooks/useCustomKindWatch';
import { useGlobalKeys } from './hooks/useGlobalKeys';
import { useTheme } from './hooks/useTheme';
import { useLocaleSync, useTranslation } from './hooks/useI18n';
import { useErrorToast } from './hooks/useErrorToast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ErrorToast } from './components/common/ErrorToast';
import { setErrorReporter } from './providers/errorHandler';
import { Sidebar } from './components/sidebar/Sidebar';
import { TopBar } from './components/topbar/TopBar';
import { StatusBar } from './components/statusbar/StatusBar';
import { ResourceTable } from './components/table/ResourceTable';
import { DetailPanel } from './components/detail/DetailPanel';
import { ForwardsBar } from './components/forwards/ForwardsBar';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { CommandPalette } from './components/palette/CommandPalette';
import { useStore } from './store';
import { HelmMarket } from './components/helm/HelmMarket';
import { PodFilesPanel } from './components/podfiles/PodFilesPanel';
import { ImageRepoPanel } from './components/imagerepo/ImageRepoPanel';
import { ImageTransferPanel } from './components/imagetransfer/ImageTransferPanel';
import { TemplatePicker } from './components/templates/TemplatePicker';
import { Dashboard } from './components/dashboard/Dashboard';
import { MetricsExplorer } from './components/metrics/MetricsExplorer';
import { GrafanaPanel } from './components/grafana/GrafanaPanel';
import { EndpointsPanel } from './components/endpoints/EndpointsPanel';
import { TopologyPanel } from './components/topology/TopologyPanel';
import { IngressRouteTopology } from './components/topology/IngressRouteTopology';
import { AlertsPanel } from './components/alerting/AlertsPanel';
import { AuditPanel } from './components/audit/AuditPanel';
import { IngressEditor } from './components/ingress/IngressEditor';
import { ResourceDiff } from './components/diff/ResourceDiff';
import { PluginPanel } from './components/plugins/PluginPanel';
import { SBOMPanel } from './components/sbom/SBOMPanel';
import { usePlugins } from './hooks/usePlugins';
import type { ComponentType } from 'react';
import type { OverlayKey } from './store';

/**
 * Overlays whose panel takes only `{ onClose }` — the overwhelming majority.
 * Each is the same `<backdrop><overlay><Panel onClose/></overlay></backdrop>`
 * shell, so we dispatch through this table instead of repeating the shell 15×.
 * `pod-files` is special (it reads overlayPodRef and renders an empty state),
 * so it's handled separately below.
 */
const overlayPanels: Partial<Record<OverlayKey, ComponentType<{ onClose: () => void }>>> = {
  'helm-market': HelmMarket,
  'image-repos': ImageRepoPanel,
  'image-transfer': ImageTransferPanel,
  templates: TemplatePicker,
  dashboard: Dashboard,
  metrics: MetricsExplorer,
  grafana: GrafanaPanel,
  endpoints: EndpointsPanel,
  topology: TopologyPanel,
  'ingress-routes': IngressRouteTopology,
  alerting: AlertsPanel,
  audit: AuditPanel,
  'ingress-editor': IngressEditor,
  diff: ResourceDiff,
  plugins: PluginPanel,
  sbom: SBOMPanel,
};

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
  // Register built-in plugins and restore enabled state from prefs.
  usePlugins();

  // Error toast system — registers the global error reporter on mount so
  // provider-level errors automatically show as toasts.
  const { toasts, showError, dismissToast } = useErrorToast();
  // Register the reporter once (the hook identity is stable).
  setErrorReporter(showError);

  // Which feature overlay is open, if any (Phase 1/2/4/5 entry points).
  const overlay = useStore((s) => s.overlay);
  const overlayPodRef = useStore((s) => s.overlayPodRef);
  const closeOverlay = useStore((s) => s.closeOverlay);
  const { t } = useTranslation();

  return (
    <ErrorBoundary>
      <div className={styles.app}>
        <Sidebar />
        <div className={styles.main}>
          <TopBar />
          <div className={styles.content}>
            {/* Keep the table + detail panel mounted when an overlay opens —
                scroll position, sort state, and selections survive the round-trip. */}
            <div
              className={styles.tableArea}
              style={{ display: overlay === null ? 'flex' : 'none' }}
            >
              <ResourceTable />
              <DetailPanel />
            </div>
            {(() => {
              if (overlay === null || overlay === 'pod-files') return null;
              const Panel = overlayPanels[overlay];
              if (!Panel) return null;
              return (
                <div className={styles.overlayBackdrop}>
                  <div className={styles.overlay}>
                    <Panel onClose={closeOverlay} />
                  </div>
                </div>
              );
            })()}
            {overlay === 'pod-files' && (
              <div className={styles.overlayBackdrop}>
                <div className={styles.overlay}>
                  {overlayPodRef ? (
                    <PodFilesPanel
                      ref={{
                        kind: 'pods',
                        namespace: overlayPodRef.namespace,
                        name: overlayPodRef.name,
                      }}
                      container={overlayPodRef.container}
                      onClose={closeOverlay}
                    />
                  ) : (
                    // No pod picked yet — show a friendly empty state.
                    <div className={styles.overlayEmpty}>
                      {t('podFiles.noPod', "Open Pod Files from a Pod's row context menu.")}
                    </div>
                  )}
                </div>
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
        {/* Error toasts — rendered above everything else. */}
        <ErrorToast toasts={toasts} onDismiss={dismissToast} />
      </div>
    </ErrorBoundary>
  );
}

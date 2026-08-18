/**
 * App root — the single-window shell (Design §Overview).
 *
 * Layout: Sidebar | (TopBar / content / StatusBar). The content region hosts the
 * resource table and pod detail panel (added in Epics 4 and 5); for now it shows a
 * placeholder so the shell (sidebar, top bar, status bar) can be verified.
 */

import { lazy, Suspense } from 'react';
import styles from './App.module.css';
import { useBootstrap } from './hooks/useBootstrap';
import { useCustomKindWatch } from './hooks/useCustomKindWatch';
import { useGlobalKeys } from './hooks/useGlobalKeys';
import { useTheme } from './hooks/useTheme';
import { useLocaleSync, useTranslation } from './hooks/useI18n';
import { useErrorToast } from './hooks/useErrorToast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginGate } from './components/auth/LoginGate';
import { ErrorToast } from './components/common/ErrorToast';
import { setErrorReporter } from './providers/errorHandler';
import { Sidebar } from './components/sidebar/Sidebar';
import { SubNav } from './components/subnav/SubNav';
import { TopBar } from './components/topbar/TopBar';
import { StatusBar } from './components/statusbar/StatusBar';
import { ResourceTable } from './components/table/ResourceTable';
import { DetailPanel } from './components/detail/DetailPanel';
import { ForwardsBar } from './components/forwards/ForwardsBar';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { CommandPalette } from './components/palette/CommandPalette';
import { EditGuardDialog } from './components/detail/EditGuardDialog';
import { ShortcutsHelp } from './components/common/ShortcutsHelp';
import { useStore } from './store';
// The AI panel drags in react-markdown + shiki (the heaviest dep in the app).
// It only renders when the user opens it, so it's lazy — non-AI sessions never
// download those chunks.
const AiChat = lazy(() => import('./components/ai/AiChat').then((m) => ({ default: m.AiChat })));
import { usePlugins } from './hooks/usePlugins';
import { useEffect } from 'react';
import type { ComponentType } from 'react';
import type { OverlayKey } from './store';
import { AI_ENABLED, IPADOS_HIDDEN_OVERLAYS } from './lib/platform';
import { useSidebarToggle } from './hooks/useSidebarToggle';

// Lazy-load overlay panels — these are heavy and only one is visible at a time.
// This keeps the initial bundle focused on the shell + table + detail panel.
const HelmMarket = lazy(() => import('./components/helm/HelmMarket').then((m) => ({ default: m.HelmMarket })));
const PodFilesPanel = lazy(() => import('./components/podfiles/PodFilesPanel').then((m) => ({ default: m.PodFilesPanel })));
const ImageRepoPanel = lazy(() => import('./components/imagerepo/ImageRepoPanel').then((m) => ({ default: m.ImageRepoPanel })));
const ImageTransferPanel = lazy(() => import('./components/imagetransfer/ImageTransferPanel').then((m) => ({ default: m.ImageTransferPanel })));
const TemplatePicker = lazy(() => import('./components/templates/TemplatePicker').then((m) => ({ default: m.TemplatePicker })));
const Dashboard = lazy(() => import('./components/dashboard/Dashboard').then((m) => ({ default: m.Dashboard })));
const MetricsExplorer = lazy(() => import('./components/metrics/MetricsExplorer').then((m) => ({ default: m.MetricsExplorer })));
const GrafanaPanel = lazy(() => import('./components/grafana/GrafanaPanel').then((m) => ({ default: m.GrafanaPanel })));
const EndpointsPanel = lazy(() => import('./components/endpoints/EndpointsPanel').then((m) => ({ default: m.EndpointsPanel })));
const TopologyPanel = lazy(() => import('./components/topology/TopologyPanel').then((m) => ({ default: m.TopologyPanel })));
const IngressRouteTopology = lazy(() => import('./components/topology/IngressRouteTopology').then((m) => ({ default: m.IngressRouteTopology })));
const AlertsPanel = lazy(() => import('./components/alerting/AlertsPanel').then((m) => ({ default: m.AlertsPanel })));
const AuditPanel = lazy(() => import('./components/audit/AuditPanel').then((m) => ({ default: m.AuditPanel })));
const IngressEditor = lazy(() => import('./components/ingress/IngressEditor').then((m) => ({ default: m.IngressEditor })));
const ResourceDiff = lazy(() => import('./components/diff/ResourceDiff').then((m) => ({ default: m.ResourceDiff })));
const PluginPanel = lazy(() => import('./components/plugins/PluginPanel').then((m) => ({ default: m.PluginPanel })));
const SBOMPanel = lazy(() => import('./components/sbom/SBOMPanel').then((m) => ({ default: m.SBOMPanel })));
// The tools catalog page (P1 IA) — the Tools section's inline content.
const ToolsPage = lazy(() => import('./components/tools/ToolsPage').then((m) => ({ default: m.ToolsPage })));

/**
 * Overlays whose panel takes only `{ onClose }` — the overwhelming majority.
 * Each is the same `<backdrop><overlay><Panel onClose/></overlay></backdrop>`
 * shell, so we dispatch through this table instead of repeating the shell 15×.
 * `pod-files` is special (it reads overlayPodRef and renders an empty state),
 * so it's handled separately below. `dashboard` is no longer an overlay — it
 * renders inline as the overview section's content (P1 IA).
 */
const overlayPanels: Partial<Record<OverlayKey, ComponentType<{ onClose: () => void }>>> = {
  'helm-market': HelmMarket,
  'image-repos': ImageRepoPanel,
  'image-transfer': ImageTransferPanel,
  templates: TemplatePicker,
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

function ShortcutsHelpPanel() {
  const open = useStore((s) => s.shortcutsOpen);
  const setOpen = useStore((s) => s.setShortcutsOpen);
  return <ShortcutsHelp open={open} onClose={() => setOpen(false)} />;
}

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
  // Sidebar drawer toggle (iPadOS only — desktop sidebar is always visible).
  const sidebar = useSidebarToggle();
  // Register the reporter as an effect (not during render) — `showError` is a
  // stable useCallback identity, so this runs once; running it during render
  // is a side-effect-in-render React violation.
  useEffect(() => {
    setErrorReporter(showError);
  }, [showError]);

  // Which feature overlay is open, if any (Phase 1/2/4/5 entry points).
  const overlay = useStore((s) => s.overlay);
  const overlayPodRef = useStore((s) => s.overlayPodRef);
  const closeOverlay = useStore((s) => s.closeOverlay);
  // Active top-level section (P1 IA) — routes the content area.
  const section = useStore((s) => s.section);
  const { t } = useTranslation();

  // AI assistant panel toggle (the panel is a right-side sidebar, not an
  // overlay — it stays open while the user works the table).
  const aiOpen = useStore((s) => s.aiPanelOpen);
  const setAiOpen = useStore((s) => s.setAiPanelOpen);

  return (
    <ErrorBoundary>
      {/* Web-mode auth gate (Task 8): passes children straight through on
          desktop (Tauri) and while the auth status is unknown; only mounts
          its form when the k7s-web server says authRequired. */}
      <LoginGate>
        <div className={styles.app}>
          {/* iPadOS: scrim behind the sidebar drawer; click to close. */}
          {sidebar.isMobile && sidebar.open && (
            <div className={styles.sidebarScrim} onClick={sidebar.close} />
          )}
          <Sidebar open={sidebar.open} onClose={sidebar.close} onToggle={sidebar.toggle} />
          <div className={styles.main}>
            <TopBar onMenuToggle={sidebar.toggle} />
            <div className={styles.content}>
              {/* Section-based content routing (P1 IA): overview hosts the
                  Dashboard inline, tools hosts the ops-tool catalog, and the
                  three resource sections get the SubNav + table + detail panel.
                  Keep the section content mounted when an overlay opens — scroll
                  position, sort state, and selections survive the round-trip. */}
              <div
                className={styles.tableArea}
                style={{ display: overlay === null ? 'flex' : 'none' }}
              >
                <div className={styles.sectionContent}>
                  {section === 'overview' ? (
                    <Suspense fallback={null}>
                      <Dashboard />
                    </Suspense>
                  ) : section === 'tools' ? (
                    <Suspense fallback={null}>
                      <ToolsPage />
                    </Suspense>
                  ) : (
                    <>
                      <SubNav section={section} />
                      <div className={styles.tableRow}>
                        <ResourceTable />
                        <DetailPanel />
                      </div>
                    </>
                  )}
                </div>
                {aiOpen && AI_ENABLED && (
                  <Suspense fallback={null}>
                    <AiChat onClose={() => setAiOpen(false)} />
                  </Suspense>
                )}
              </div>
              {(() => {
                if (overlay === null || overlay === 'pod-files') return null;
                if (IPADOS_HIDDEN_OVERLAYS.has(overlay)) return null;
                const Panel = overlayPanels[overlay];
                if (!Panel) return null;
                return (
                  <div
                    className={styles.overlayBackdrop}
                    // Click the scrim (not the panel) → close. The same contract as
                    // the settings modal and command palette, so every dismissible
                    // surface in the app behaves identically: Esc, ×, or outside.
                    onMouseDown={(e) => {
                      if (e.target === e.currentTarget) closeOverlay();
                    }}
                  >
                    <div className={styles.overlay} role="dialog" aria-modal="true">
                      <Suspense fallback={<div className={styles.overlayEmpty}>…</div>}>
                        <Panel onClose={closeOverlay} />
                      </Suspense>
                    </div>
                  </div>
                );
              })()}
              {overlay === 'pod-files' && !IPADOS_HIDDEN_OVERLAYS.has('pod-files') && (
                <div
                  className={styles.overlayBackdrop}
                  onMouseDown={(e) => {
                    if (e.target === e.currentTarget) closeOverlay();
                  }}
                >
                  <div className={styles.overlay} role="dialog" aria-modal="true">
                    <Suspense fallback={<div className={styles.overlayEmpty}>…</div>}>
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
                    </Suspense>
                  </div>
                </div>
              )}
            </div>
            {/* Floating AI toggle — bottom-right of the content area. Hidden while
                the panel is open (the panel has its own close button) and while a
                feature overlay covers the table — the panel would open invisibly
                behind it, and the click would look dead. */}
            {!aiOpen && overlay === null && AI_ENABLED && (
              <button
                type="button"
                className={styles.aiFab}
                onClick={() => setAiOpen(true)}
                aria-label={t('chrome.aiFab.open')}
                title={t('chrome.aiFab.title')}
              >
                ✦
              </button>
            )}
            <ForwardsBar />
            <StatusBar />
          </div>
          {/* Modals, outside the layout flow. The palette is last so it layers over
              everything — ⌘K works from anywhere, including the settings panel. */}
          <SettingsPanel />
          <CommandPalette />
          <EditGuardDialog />
          <ShortcutsHelpPanel />
          {/* Error toasts — rendered above everything else. */}
          <ErrorToast toasts={toasts} onDismiss={dismissToast} />
        </div>
      </LoginGate>
    </ErrorBoundary>
  );
}

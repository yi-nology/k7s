/**
 * Dashboard — the cluster overview page.
 *
 * Doubles as a full page and an overlay (P1 IA):
 *
 *   - Page mode (no `onClose`): the overview section's home content. When
 *     no cluster is connected it shows an onboarding empty state instead of
 *     a wall of zeroes; when connected it leads with a quick-entry strip.
 *   - Overlay mode (`onClose` provided): the classic Dashboard panel with a
 *     header + close button, rendered above the resource table.
 *
 * The connected pieces:
 *
 *   - Cluster info card (name, version, context, server).
 *   - CPU / memory utilisation bars fed by the live poller in the
 *     backend (already published as `node-metrics` events).
 *   - A row of resource-count cards (one per kind) that link to the
 *     corresponding table.
 *   - The cluster's recent events, so a `CrashLoopBackOff` or a
 *     `FailedScheduling` doesn't get missed.
 */
import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '../../hooks/useI18n';
import { kindLabelFor } from '../../lib/i18n';
import { calculateHealth, gradeColor } from '../../lib/health';
import styles from './Dashboard.module.css';
import { useConnection, useNodeMetrics } from '../../hooks/useStoreHooks';
import { aggregatePercent, meterColor, capitalize, parseResourceValue, parseQuotaMap } from './dashboardUtils';

/**
 * The nine resource cards the dashboard surfaces. Order is intentional — it
 * matches the sidebar's group order (workloads, network, config, cluster) so a
 * user who's been clicking around the sidebar lands on the dashboard and sees
 * the same row they just left.
 *
 * The label is *not* stored here. It's resolved per render through
 * `kindLabelFor()` so a Chinese UI shows `Pod / Deployment / Service / …` and
 * the English UI shows `Pods / Deployments / Services / …` — the canonical
 * kind names the rest of the chrome uses. A new kind added to this list still
 * shows up correctly (the helper falls back to the static `KIND_META` label
 * when the i18n registry doesn't have one yet).
 */
const RESOURCE_KINDS: Array<{
  id:
    | 'pods'
    | 'deployments'
    | 'services'
    | 'configmaps'
    | 'secrets'
    | 'jobs'
    | 'cronjobs'
    | 'nodes'
    | 'namespaces';
  color: string;
}> = [
  { id: 'pods', color: 'var(--accent)' },
  { id: 'deployments', color: '#5cc8ff' },
  { id: 'services', color: '#f7c948' },
  { id: 'configmaps', color: '#a78bfa' },
  { id: 'secrets', color: '#fb7185' },
  { id: 'jobs', color: '#34d399' },
  { id: 'cronjobs', color: '#fb923c' },
  { id: 'nodes', color: '#22d3ee' },
  { id: 'namespaces', color: '#e879f9' },
];

export function Dashboard({ onClose }: { onClose?: () => void } = {}) {
  const { t, locale } = useTranslation();
  const connection = useConnection();
  // The dashboard aggregates many kinds (health inputs, count tiles, resource
  // quotas), so it genuinely needs the full rows map. useShallow compares each
  // kind array by reference so we only re-render when a kind's rows actually
  // change, not on unrelated store fields.
  const rows = useStore(useShallow((s) => s.rows));
  const nodeMetrics = useNodeMetrics();
  const setNav = useStore((s) => s.setNav);
  const closeOverlay = useStore((s) => s.closeOverlay);
  const setSection = useStore((s) => s.setSection);
  const openOverlay = useStore((s) => s.openOverlay);
  const setOnboardingOpen = useStore((s) => s.setOnboardingOpen);

  // Recent events come straight from the live watcher snapshot in the store
  // (the same feed the Cluster → Events table renders), not from a one-shot
  // get_events fetch. The fetch path queried `involvedObject.name=""` which
  // matches nothing, so the panel was always empty; the watcher already has
  // the cluster-wide, newest-first, cap-500 list, so reusing it is both
  // correct and real-time.
  const events = useMemo(() => rows.events ?? [], [rows.events]);

  // Pagination over the events list. The watcher caps at 500 and the panel
  // showed only the first 12; paging lets you reach the rest without leaving
  // the dashboard. State resets to 0 when the event count shrinks below the
  // current page's window (events expire, a new watch snapshot arrives) so the
  // viewport never points past the end.
  const PAGE_SIZE = 12;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageEvents = useMemo(
    () => events.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [events, safePage]
  );

  // Aggregate node CPU/MEM across all known nodes.
  const cpuPercent = aggregatePercent(Object.values(nodeMetrics).map((n) => n.cpuPercent));
  const memPercent = aggregatePercent(Object.values(nodeMetrics).map((n) => n.memPercent));

  // Compute cluster health score from live data.
  const health = useMemo(
    () =>
      calculateHealth(
        rows.nodes ?? [],
        rows.pods ?? [],
        rows.deployments ?? [],
        events,
        nodeMetrics,
        rows.persistentvolumeclaims ?? [],
        rows.horizontalpodautoscalers ?? [],
        rows.cronjobs ?? [],
        rows.daemonsets ?? []
      ),
    [
      rows.nodes,
      rows.pods,
      rows.deployments,
      events,
      nodeMetrics,
      rows.persistentvolumeclaims,
      rows.horizontalpodautoscalers,
      rows.cronjobs,
      rows.daemonsets,
    ]
  );
  const [checksExpanded, setChecksExpanded] = useState(false);

  // No cluster yet — as the home page the overview shows an onboarding empty
  // state rather than a dashboard full of zeroes. Covers every non-connected
  // phase (idle / connecting / error). Must sit after the hooks above so the
  // hook order stays identical between the two branches.
  if (connection.phase !== 'connected') {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyCard}>
          <h2>{t('overview.empty.title', 'No cluster connected yet')}</h2>
          <p>
            {t(
              'overview.empty.hint',
              'Import a kubeconfig to start browsing and operating cluster resources.'
            )}
          </p>
          <div className={styles.emptyActions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => setOnboardingOpen(true)}
            >
              {t('overview.empty.import', 'Import cluster')}
            </button>
            <button type="button" className={styles.ghost} onClick={() => setSection('workloads')}>
              {t('overview.empty.browse', 'Just look around')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        {/* Overlay mode keeps the classic title + close; page mode gets the
            overview heading so the section has an accessible name. */}
        <h2>{onClose ? t('dashboard.title', 'Dashboard') : t('overview.title', 'Overview')}</h2>
        {onClose && (
          <button className={styles.close} onClick={onClose}>
            {t('dashboard.close', 'Close')}
          </button>
        )}
      </header>

      {/* Quick entries — the one-click paths off the home page. */}
      <div className={styles.quickEntries}>
        <button type="button" className={styles.quickEntry} onClick={() => setSection('workloads')}>
          {t('overview.quick.workloads', 'Workloads')}
        </button>
        <button type="button" className={styles.quickEntry} onClick={() => openOverlay('metrics')}>
          {t('overview.quick.metrics', 'Metrics')}
        </button>
        <button type="button" className={styles.quickEntry} onClick={() => openOverlay('alerting')}>
          {t('overview.quick.alerts', 'Alerts')}
        </button>
        <button
          type="button"
          className={styles.quickEntry}
          onClick={() => openOverlay('templates')}
        >
          {t('overview.quick.create', 'Create workload')}
        </button>
      </div>

      <div className={styles.infoCard}>
        <div>
          <div className={styles.infoLabel}>{t('dashboard.cluster', 'Cluster')}</div>
          <div className={styles.infoValue}>{connection.context ?? '—'}</div>
        </div>
        <div>
          <div className={styles.infoLabel}>{t('dashboard.phase', 'Status')}</div>
          <div className={styles.infoValue}>{connection.phase}</div>
        </div>
        <div>
          <div className={styles.infoLabel}>{t('dashboard.nodes', 'Nodes')}</div>
          <div className={styles.infoValue}>
            {Object.keys(nodeMetrics).length || rows.nodes.length}
          </div>
        </div>
      </div>

      {/* Consolidated overview: health ring on the left, CPU + Memory bars
          stacked on the right, all in a single horizontal card. */}
      <div className={styles.overviewCard}>
        <div className={styles.overviewRing}>
          <svg viewBox="0 0 100 100" className={styles.healthRingSvg}>
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="var(--bg-terminal)"
              strokeWidth="8"
            />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke={gradeColor(health.grade)}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${(health.score / 100) * 264} 264`}
              className={styles.healthRingArc}
            />
          </svg>
          <div className={styles.healthGrade} style={{ color: gradeColor(health.grade) }}>
            {health.grade}
          </div>
        </div>
        <div className={styles.overviewStats}>
          <div className={styles.overviewMeta}>
            <div className={styles.healthScore}>
              {health.checks.length > 0 ? health.score : '—'}
              {health.checks.length > 0 && <span className={styles.healthScoreUnit}>/100</span>}
            </div>
            <div className={styles.healthLabel}>{t('dashboard.healthScore', 'Cluster Health')}</div>
          </div>
          <div className={styles.overviewStat}>
            <span className={styles.overviewLabel}>{t('dashboard.cpu', 'CPU')}</span>
            <span className={styles.overviewBar}>
              <span
                className={styles.overviewFill}
                style={{
                  width: `${Math.min(100, cpuPercent)}%`,
                  background: meterColor(cpuPercent),
                }}
              />
            </span>
            <span className={styles.overviewValue}>{cpuPercent.toFixed(0)}%</span>
          </div>
          <div className={styles.overviewStat}>
            <span className={styles.overviewLabel}>{t('dashboard.mem', 'MEM')}</span>
            <span className={styles.overviewBar}>
              <span
                className={styles.overviewFill}
                style={{
                  width: `${Math.min(100, memPercent)}%`,
                  background: meterColor(memPercent),
                }}
              />
            </span>
            <span className={styles.overviewValue}>{memPercent.toFixed(0)}%</span>
          </div>
          {health.checks.length > 0 && (
            <button
              type="button"
              className={styles.healthToggle}
              onClick={() => setChecksExpanded((v) => !v)}
            >
              {checksExpanded
                ? t('dashboard.healthHide', 'Hide checks')
                : t('dashboard.healthShow', `Show ${health.checks.length} checks`)}
            </button>
          )}
        </div>
      </div>
      {checksExpanded && health.checks.length > 0 && (
        <ul className={styles.healthChecks}>
          {health.checks.map((c) => (
            <li key={c.name} className={styles.healthCheckItem}>
              <span className={styles[`check${capitalize(c.status)}`]}>
                {c.status === 'pass' ? '\u2713' : c.status === 'warn' ? '!' : '\u2717'}
              </span>
              <span className={styles.checkName}>{c.name}</span>
              <span className={styles.checkMessage}>{c.message}</span>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.resourceGrid}>
        {RESOURCE_KINDS.map((k) => {
          // kindLabelFor falls back to the static KIND_META label if the
          // i18n registry ever drops a kind, so a future refactor that
          // adds a kind here without adding it to the registry still
          // renders something readable (the canonical English name) — not
          // a blank tile.
          const label = kindLabelFor(k.id, [], locale) ?? k.id;
          return (
            <button
              type="button"
              key={k.id}
              className={styles.resourceCard}
              onClick={() => {
                setNav(k.id);
                if (onClose) onClose();
                else closeOverlay();
              }}
            >
              <div className={styles.resourceCount}>{rows[k.id]?.length ?? 0}</div>
              <div className={styles.resourceLabel} style={{ color: k.color }}>
                {label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Resource Quotas — progress bars showing usage vs hard limits.
          Rendered only when the cluster has at least one ResourceQuota. */}
      {(rows.resourcequotas?.length ?? 0) > 0 && (
        <div className={styles.quotaSection}>
          <h3 className={styles.panelTitle}>{t('dashboard.quotas', 'Resource Quotas')}</h3>
          <div className={styles.quotaGrid}>
            {rows.resourcequotas!.map((rq) => {
              // Cells: [NAME, NAMESPACE, HARD, USED, AGE]
              const name = rq.cells[0]?.text ?? '';
              const ns = rq.cells[1]?.text ?? '';
              const hardMap = parseQuotaMap(rq.cells[2]?.text ?? '');
              const usedMap = parseQuotaMap(rq.cells[3]?.text ?? '');

              // Iterate the HARD keys so we show every resource the quota
              // defines, even when USED hasn't reported it yet (renders 0).
              const resources = Array.from(hardMap.entries());

              return (
                <div key={rq.uid} className={styles.quotaCard}>
                  <div className={styles.quotaName}>{name}</div>
                  <div className={styles.quotaNs}>{ns}</div>
                  {resources.map(([key, hardRaw]) => {
                    const hardVal = parseResourceValue(hardRaw, key);
                    const usedRaw = usedMap.get(key) ?? '';
                    const usedVal = parseResourceValue(usedRaw, key);
                    const pct = hardVal > 0 ? Math.min(100, (usedVal / hardVal) * 100) : 0;
                    return (
                      <div key={key} className={styles.quotaItem}>
                        <div className={styles.quotaItemHeader}>
                          <span className={styles.quotaLabel}>{key}</span>
                          <span className={styles.quotaValues}>
                            {usedRaw || '0'} / {hardRaw}
                          </span>
                        </div>
                        <div className={styles.barOuter}>
                          <div
                            className={styles.barInner}
                            style={{
                              width: `${pct}%`,
                              background: meterColor(pct),
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={styles.eventsPanel}>
        <h3 className={styles.panelTitle}>{t('dashboard.events', 'Recent events')}</h3>
        {events.length === 0 ? (
          <div className={styles.empty}>{t('dashboard.eventsEmpty', 'No recent events')}</div>
        ) : (
          <>
            <ul className={styles.eventList}>
              {pageEvents.map((e) => {
                // Row cells from map_event: [TYPE, REASON, OBJECT, NS, AGE, COUNT, MESSAGE].
                const cells = e.cells;
                const type = cells[0]?.text ?? 'Normal';
                const reason = cells[1]?.text ?? '';
                const message = cells[6]?.text ?? '';
                const age = cells[4]?.text ?? '';
                return (
                  <li
                    key={e.uid ?? `${reason}-${message}`}
                    className={type === 'Warning' ? styles.eventWarn : styles.eventNormal}
                  >
                    <span className={styles.eventReason}>{reason}</span>
                    <span className={styles.eventMessage}>{message}</span>
                    <span className={styles.eventTime}>{age}</span>
                  </li>
                );
              })}
            </ul>
            {pageCount > 1 && (
              <div className={styles.pager}>
                <button
                  type="button"
                  className={styles.pagerBtn}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                >
                  {t('dashboard.eventsPrev', '‹ Prev')}
                </button>
                <span className={styles.pagerInfo}>
                  {safePage + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  className={styles.pagerBtn}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={safePage === pageCount - 1}
                >
                  {t('dashboard.eventsNext', 'Next ›')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Utility functions extracted to ./dashboardUtils.ts:
// - aggregatePercent, meterColor, capitalize, parseResourceValue, parseQuotaMap

/**
 * Dashboard — the cluster overview page.
 *
 * The first thing the user sees when they connect: a glanceable summary
 * of the active cluster. The pieces:
 *
 *   - Cluster info card (name, version, context, server).
 *   - CPU / memory utilisation bars fed by the live poller in the
 *     backend (already published as `node-metrics` events).
 *   - A row of resource-count cards (one per kind) that link to the
 *     corresponding table.
 *   - The cluster's recent events, so a `CrashLoopBackOff` or a
 *     `FailedScheduling` doesn't get missed.
 *
 * Why a separate route rather than a sidebar entry: the dashboard
 * *is* the home view, set as the default `nav` when the app boots.
 */
import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '../../hooks/useI18n';
import { kindLabelFor } from '../../lib/i18n';
import { calculateHealth, gradeColor } from '../../lib/health';
import styles from './Dashboard.module.css';

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
  const connection = useStore((s) => s.connection);
  // The dashboard aggregates many kinds (health inputs, count tiles, resource
  // quotas), so it genuinely needs the full rows map. useShallow compares each
  // kind array by reference so we only re-render when a kind's rows actually
  // change, not on unrelated store fields.
  const rows = useStore(useShallow((s) => s.rows));
  const nodeMetrics = useStore((s) => s.nodeMetrics);
  const setNav = useStore((s) => s.setNav);
  const closeOverlay = useStore((s) => s.closeOverlay);

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

  return (
    <div className={styles.dashboard}>
      {onClose && (
        <header className={styles.header}>
          <h2>{t('dashboard.title', 'Dashboard')}</h2>
          <button className={styles.close} onClick={onClose}>
            {t('dashboard.close', 'Close')}
          </button>
        </header>
      )}
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
            <div
              key={k.id}
              className={styles.resourceCard}
              onClick={() => {
                // Jump to the kind's table — closing the overlay so the
                // table is actually visible behind it. setNav alone would
                // change the active kind but leave the dashboard covering
                // everything, which was the point of the audit fix.
                setNav(k.id);
                if (onClose) onClose();
                else closeOverlay();
              }}
            >
              <div className={styles.resourceCount}>{rows[k.id]?.length ?? 0}</div>
              <div className={styles.resourceLabel} style={{ color: k.color }}>
                {label}
              </div>
            </div>
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
                    const hardVal = parseResourceValue(hardRaw);
                    const usedRaw = usedMap.get(key) ?? '';
                    const usedVal = parseResourceValue(usedRaw);
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

function aggregatePercent(perNode: number[]): number {
  if (perNode.length === 0) return 0;
  const sum = perNode.reduce((a, b) => a + b, 0);
  return sum / perNode.length;
}

function meterColor(p: number): string {
  if (p < 60) return 'var(--status-ok)';
  if (p < 85) return 'var(--status-warn)';
  return 'var(--status-err)';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Parse a Kubernetes resource quantity string into a comparable number.
 *
 * CPU: "100m" → 100, "1" → 1000, "500m" → 500  (all in millicores)
 * Memory: "128Mi" → 128, "1Gi" → 1024, "512Ki" → 0.5  (all in MiB)
 * Plain numbers (pods, services, etc.): parsed directly.
 *
 * Returns 0 for empty or unparseable strings so a missing "USED" value
 * renders as a zero-fill bar rather than crashing the math.
 */
function parseResourceValue(s: string): number {
  if (!s) return 0;
  const trimmed = s.trim();

  // CPU — millicores ("100m") or cores ("1", "2")
  if (trimmed.endsWith('m')) {
    return parseFloat(trimmed) || 0;
  }

  // Memory — binary suffixes
  const memMatch = trimmed.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|Pi|Ei)$/);
  if (memMatch) {
    const val = parseFloat(memMatch[1]);
    switch (memMatch[2]) {
      case 'Ki':
        return val / 1024; // normalise to MiB
      case 'Mi':
        return val;
      case 'Gi':
        return val * 1024;
      case 'Ti':
        return val * 1024 * 1024;
      case 'Pi':
        return val * 1024 * 1024 * 1024;
      case 'Ei':
        return val * 1024 * 1024 * 1024 * 1024;
    }
  }

  // Plain number (pods, services, secrets, …) — or a core count ("4")
  // For cores, multiply by 1000 to match the millicore scale above.
  const num = parseFloat(trimmed);
  if (isNaN(num)) return 0;
  // Heuristic: if the value is a small integer and the string had no unit
  // suffix at all, treat it as a core count → millicores so cpu bars scale
  // correctly against "100m"-style used values.
  if (Number.isInteger(num) && num <= 64 && !/[a-zA-Z]/.test(trimmed)) {
    return num * 1000;
  }
  return num;
}

/**
 * Parse a comma-separated "key=value" string (the format Kubernetes uses for
 * ResourceQuota HARD and USED columns) into a Map of resource name → raw value
 * string.  Example: "cpu=4,memory=8Gi,pods=10" → { cpu: "4", memory: "8Gi", pods: "10" }.
 */
function parseQuotaMap(raw: string): Map<string, string> {
  const m = new Map<string, string>();
  if (!raw) return m;
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    m.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return m;
}

/**
 * TopologyPanel -- wraps the d3 force-directed graph with a slim sidebar
 * (the Service list), a search box, a header, and a health summary bar.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatError, getProvider } from '../../providers';
import { useAsyncEffect } from '../../hooks/useAsyncEffect';
import { cx } from '../../lib/cx';
import type { EndpointRow } from '../../providers/types';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '../../hooks/useI18n';
import { TopologyGraph } from './TopologyGraph';
import styles from './TopologyPanel.module.css';

interface ServiceTopology {
  service: string;
  namespace: string;
  slices: EndpointRow[];
}

interface HealthSummary {
  total: number;
  healthy: number;
  unhealthy: number;
  unknown: number;
}

export function TopologyPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [services, setServices] = useState<ServiceTopology[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [focusedService, setFocusedService] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [health, setHealth] = useState<HealthSummary>({
    total: 0,
    healthy: 0,
    unhealthy: 0,
    unknown: 0,
  });
  const [matchTotal, setMatchTotal] = useState(0);
  const [matchCurrent, setMatchCurrent] = useState(-1);
  const navigateMatchRef = useRef<((dir: 'next' | 'prev') => void) | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleMatchInfoChange = useCallback((total: number, current: number) => {
    setMatchTotal(total);
    setMatchCurrent(current);
  }, []);

  const nextMatch = useCallback(() => navigateMatchRef.current?.('next'), []);
  const prevMatch = useCallback(() => navigateMatchRef.current?.('prev'), []);

  // Focus search input on "/" key.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        (document.activeElement?.tagName !== 'INPUT' &&
          document.activeElement?.tagName !== 'TEXTAREA')
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Only services + pods are read here — subscribe to those two kinds,
  // shallow-compared, instead of the whole rows map.
  const { services: svcRows, pods: podRows } = useStore(
    useShallow((s) => ({
      services: s.rows.services ?? [],
      pods: s.rows.pods ?? [],
    }))
  );

  useAsyncEffect(async (isMounted) => {
    try {
      // Primary: EndpointSlice-based.
      let all: EndpointRow[] = [];
      try {
        all = await getProvider().listEndpoints();
      } catch {
        // EndpointSlice API unavailable -- fall through.
      }
      if (!isMounted()) return;

      const byService = new Map<string, ServiceTopology>();
      for (const slc of all) {
        if (!slc.service) continue;
        const key = `${slc.namespace}/${slc.service}`;
        let entry = byService.get(key);
        if (!entry) {
          entry = {
            service: slc.service,
            namespace: slc.namespace,
            slices: [],
          };
          byService.set(key, entry);
        }
        entry.slices.push(slc);
      }

      // Fallback: build from Services + Pods when no EndpointSlices.
      if (byService.size === 0) {
        for (const svc of svcRows) {
          const ns = svc.namespace ?? '';
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
          byService.set(`${ns}/${svc.name}`, {
            service: svc.name,
            namespace: ns,
            slices: matchingPods.map((p) => ({
              name: p.name,
              namespace: ns,
              service: svc.name,
              ready: p.pod?.status === 'Running' ? 1 : 0,
              total: 1,
              addresses: [],
              age: '',
            })),
          });
        }
      }

      if (isMounted()) {
        setServices([...byService.values()].sort((a, b) => a.service.localeCompare(b.service)));
      }
    } catch (e: unknown) {
      if (isMounted()) setError(formatError(e));
    }
  }, [svcRows, podRows]);

  const handleServiceClick = (svc: ServiceTopology) => {
    const id = `svc:${svc.namespace}/${svc.service}`;
    setFocusedService(id);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
  };

  const clearSearch = () => {
    setSearchQuery('');
  };

  const handleHealthChange = useCallback((h: HealthSummary) => {
    setHealth(h);
  }, []);

  // Filter sidebar services by search query.
  const filteredServices =
    searchQuery.trim() === ''
      ? services
      : services.filter((s) => s.service.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2>{t('topology.title', 'Service Topology')}</h2>
        {onClose && (
          <button className={styles.btn} onClick={onClose}>
            {t('topology.close', 'Close')}
          </button>
        )}
      </header>
      {error && <div className={styles.error}>{error}</div>}

      {/* Health summary bar */}
      <div className={styles.healthBar}>
        <div className={styles.healthItem}>
          <span className={styles.healthCount}>{health.total}</span>
          <span className={styles.healthLabel}>{t('topology.health.total', 'Total')}</span>
        </div>
        <div className={styles.healthSeparator} />
        <div className={styles.healthItem}>
          <span className={styles.healthCount} style={{ color: 'var(--status-ok, #34d399)' }}>
            {health.healthy}
          </span>
          <span className={styles.healthLabel}>{t('topology.health.healthy', 'Healthy')}</span>
        </div>
        <div className={styles.healthItem}>
          <span className={styles.healthCount} style={{ color: 'var(--status-err, #ef4444)' }}>
            {health.unhealthy}
          </span>
          <span className={styles.healthLabel}>{t('topology.health.unhealthy', 'Unhealthy')}</span>
        </div>
        <div className={styles.healthItem}>
          <span className={styles.healthCount} style={{ color: 'var(--text-muted, #64748b)' }}>
            {health.unknown}
          </span>
          <span className={styles.healthLabel}>{t('topology.health.unknown', 'Unknown')}</span>
        </div>
      </div>

      <div className={styles.body}>
        <aside className={styles.side}>
          {/* Search box */}
          <div className={styles.searchWrap}>
            <input
              ref={searchInputRef}
              className={styles.searchInput}
              type="text"
              placeholder={t('topology.search.placeholder', 'Search nodes...')}
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { if (e.shiftKey) prevMatch(); else nextMatch(); }
                if (e.key === 'Escape') {
                  setSearchQuery('');
                  searchInputRef.current?.blur();
                }
              }}
            />
            {searchQuery && matchTotal > 0 && (
              <>
                <span className={styles.matchCount}>
                  {matchCurrent + 1}/{matchTotal}
                </span>
                <button
                  className={styles.navBtn}
                  onClick={prevMatch}
                  title={t('topology.search.prev', 'Previous match')}
                >
                  &#x2191;
                </button>
                <button
                  className={styles.navBtn}
                  onClick={nextMatch}
                  title={t('topology.search.next', 'Next match')}
                >
                  &#x2193;
                </button>
              </>
            )}
            {searchQuery && matchTotal === 0 && (
              <span className={styles.matchCount}>0</span>
            )}
            {searchQuery && (
              <button
                className={styles.searchClear}
                onClick={clearSearch}
                title={t('topology.search.clear', 'Clear')}
              >
                &times;
              </button>
            )}
          </div>

          <h3 className={styles.colHeader}>{t('topology.col.service', 'Service')}</h3>
          {filteredServices.length === 0 ? (
            <div className={styles.empty}>{t('topology.empty', 'No services with endpoints')}</div>
          ) : (
            <ul className={styles.list}>
              {filteredServices.map((s) => {
                const id = `svc:${s.namespace}/${s.service}`;
                const isFocused = focusedService === id;
                return (
                  <li
                    key={`${s.namespace}/${s.service}`}
                    className={cx(styles.item, isFocused && styles.itemFocused)}
                    onClick={() => handleServiceClick(s)}
                  >
                    <div className={styles.itemName}>{s.service}</div>
                    <div className={styles.itemMeta}>
                      {s.namespace} &middot; {s.slices.length} slice
                      {s.slices.length === 1 ? '' : 's'} &middot;{' '}
                      {s.slices.reduce((n, sl) => n + sl.ready, 0)} ready
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
        <main className={styles.main}>
          <TopologyGraph
            focusedService={focusedService}
            searchQuery={searchQuery}
            onHealthChange={handleHealthChange}
            onMatchInfoChange={handleMatchInfoChange}
            navigateMatch={navigateMatchRef}
          />
        </main>
      </div>
    </div>
  );
}

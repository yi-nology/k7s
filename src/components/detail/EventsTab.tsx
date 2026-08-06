/**
 * Events tab (Design §4-Events). Fetches events for the selected pod on open (and
 * on pod change) and renders them as cards: Normal (green) / Warning (red).
 *
 * A time-range filter (mirrors the Cluster → Events table's) narrows the list to
 * "what happened lately". Beyond the cluster's --event-ttl the API server has
 * already dropped events, so the empty state calls that out rather than implying
 * the object has never had any.
 */

import { useMemo, useState } from 'react';
import styles from './EventsTab.module.css';
import { useStore } from '../../store';
import { getProvider } from '../../providers';
import { useAsyncEffect } from '../../hooks/useAsyncEffect';
import { useTranslation } from '../../hooks/useI18n';
import { useNow } from '../../hooks/useNow';
import type { EventItem } from '../../providers/types';
import { eventWithinSince, parseEventMs, SINCE_OPTIONS, type SinceOption } from '../../lib/events';

export function EventsTab() {
  const row = useStore((s) => s.selectedRow);
  const kind = useStore((s) => s.nav);
  const eventsSince = useStore((s) => s.eventsSince);
  const setEventsSince = useStore((s) => s.setEventsSince);
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const { t } = useTranslation();
  const now = useNow();

  useAsyncEffect(async (isMounted) => {
    if (!row) return;
    setEvents(null); // show loading while fetching
    try {
      const items = await getProvider().getEvents({
        kind,
        namespace: row.namespace,
        name: row.name,
      });
      if (isMounted()) setEvents(items);
    } catch {
      if (isMounted()) setEvents([]);
    }
  }, [row, kind]);

  // Apply the time-range filter client-side: keep events whose last-seen falls in
  // the window. An event with no parseable timestamp is kept (filtering it out
  // would hide real data behind a serialization quirk).
  const visible = useMemo(() => {
    if (events === null) return null;
    return eventsSince === 'all'
      ? events
      : events.filter((ev) => {
          const ms = parseEventMs(ev.lastTimestamp);
          return ms === null || eventWithinSince(ms, eventsSince, now);
        });
  }, [events, eventsSince, now]);

  if (visible === null) {
    return <div className={styles.empty}>{t('events.loading')}</div>;
  }

  return (
    <div className={styles.list}>
      {/* Time-range filter — same vocabulary as the Cluster → Events table.
          "all" is the default because the cluster has already GC'd events past
          its --event-ttl, so the full retained set is usually small. */}
      <div className={styles.toolbar}>
        <select
          className={styles.sinceSelect}
          value={eventsSince}
          onChange={(e) => setEventsSince(e.target.value as SinceOption)}
          title={t('events.howFarBack')}
          data-testid="events-tab-since"
        >
          {SINCE_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o === 'all' ? t('events.sinceAll') : t('events.sinceLast', o)}
            </option>
          ))}
        </select>
        <span className={styles.count}>
          {visible.length}/{events!.length}
        </span>
      </div>
      {visible.length === 0 ? (
        <div className={styles.empty}>
          {events!.length === 0
            ? t('events.empty', 'no recent events — events expire after ~1h')
            : t('events.empty', 'no recent events — events expire after ~1h')}
          <div className={styles.emptyHint}>{t('events.hint')}</div>
        </div>
      ) : (
        visible.map((ev, i) => (
          <div key={i} className={styles.card}>
            <span
              className={styles.type}
              style={{ color: ev.type === 'Warning' ? 'var(--status-err)' : 'var(--status-ok)' }}
            >
              {ev.type}
            </span>
            <div className={styles.body}>
              <div className={styles.headline}>
                <span className={styles.reason}>{ev.reason}</span>
                <span className={styles.meta}>
                  {ev.age} · ×{ev.count}
                </span>
              </div>
              <div className={styles.message}>{ev.message}</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

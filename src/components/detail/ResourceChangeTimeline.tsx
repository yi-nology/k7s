/**
 * ResourceChangeTimeline — the "Timeline" detail tab for all resource kinds.
 *
 * Shows Kubernetes Events for the selected resource as a vertical timeline.
 * Each event is a dot on the timeline, colored by type (Normal/Warning).
 * Clicking a card expands it to show the full event message.
 *
 * Unlike CronJobTimeline (which shows Job execution history), this component
 * surfaces the resource's own Kubernetes Events — useful for any kind.
 */

import { useState, useMemo } from 'react';
import { useAsyncEffect } from '../../hooks/useAsyncEffect';
import { getProvider } from '../../providers';
import type { EventItem } from '../../providers/types';
import { eventWithinSince, parseEventMs, SINCE_OPTIONS, type SinceOption } from '../../lib/events';
import { useNow } from '../../hooks/useNow';
import { formatAge } from '../../lib/format';
import { useTranslation } from '../../hooks/useI18n';
import styles from './ResourceChangeTimeline.module.css';

interface Props {
  kind: string;
  namespace: string;
  name: string;
}

export function ResourceChangeTimeline({ kind, namespace, name }: Props) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [since, setSince] = useState<SinceOption>('24h');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const now = useNow(10_000);

  useAsyncEffect(async (mounted) => {
    setLoading(true);
    try {
      const items = await getProvider().getEvents({ kind, namespace, name });
      if (mounted()) setEvents(items);
    } catch {
      if (mounted()) setEvents([]);
    } finally {
      if (mounted()) setLoading(false);
    }
  }, [kind, namespace, name]);

  const filtered = useMemo(() => {
    return events
      .filter((e) => {
        const ms = parseEventMs(e.lastTimestamp);
        return ms === null || eventWithinSince(ms, since, now);
      })
      .sort((a, b) => {
        const ta = parseEventMs(a.lastTimestamp) ?? 0;
        const tb = parseEventMs(b.lastTimestamp) ?? 0;
        return tb - ta; // newest first
      });
  }, [events, since, now]);

  const warningCount = filtered.filter((e) => e.type === 'Warning').length;
  const normalCount = filtered.filter((e) => e.type === 'Normal').length;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.summary}>
          <span className={styles.normalDot} />
          <span className={styles.count}>{normalCount}</span>
          <span className={styles.warningDot} />
          <span className={styles.count}>{warningCount}</span>
        </div>
        <select
          className={styles.sinceSelect}
          value={since}
          onChange={(e) => setSince(e.target.value as SinceOption)}
        >
          {SINCE_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o === 'all' ? t('events.sinceAll') : t('events.sinceLast', o)}
            </option>
          ))}
        </select>
      </div>

      {loading && <div className={styles.empty}>{t('events.loading')}</div>}
      {!loading && filtered.length === 0 && (
        <div className={styles.empty}>{t('events.noEvents')}</div>
      )}

      <div className={styles.timeline}>
        {filtered.map((event, i) => {
          const isWarning = event.type === 'Warning';
          const expanded = expandedIdx === i;
          const ms = parseEventMs(event.lastTimestamp);
          const age = ms ? formatAge(event.lastTimestamp!, now) : event.age;

          return (
            <div key={i} className={styles.entry}>
              <div className={styles.lineSegment}>
                <div className={isWarning ? styles.dotWarning : styles.dotNormal} />
              </div>
              <div
                className={`${styles.card} ${isWarning ? styles.cardWarning : ''}`}
                onClick={() => setExpandedIdx(expanded ? null : i)}
              >
                <div className={styles.cardHeader}>
                  <span
                    className={`${styles.typeBadge} ${isWarning ? styles.badgeWarning : styles.badgeNormal}`}
                  >
                    {event.type}
                  </span>
                  <span className={styles.reason}>{event.reason}</span>
                  {event.count > 1 && (
                    <span className={styles.eventCount}>x{event.count}</span>
                  )}
                  <span className={styles.age}>{age}</span>
                </div>
                {expanded && <div className={styles.message}>{event.message}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

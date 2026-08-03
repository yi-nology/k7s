/**
 * Events time-range filtering (shared by the Cluster → Events table and the
 * detail-panel EventsTab).
 *
 * Reuses the log view's `SinceOption` vocabulary (`all / 5m / 1h / 24h`) so the
 * two surfaces speak the same "how far back" language. Pure, so the mapping
 * from the toolbar choice to a keep/drop decision is testable without React.
 */

import type { SinceOption } from "./logview";
import { sinceSeconds } from "./logview";

export type { SinceOption };
export { SINCE_OPTIONS } from "./logview";

/**
 * Keep an event whose last-seen epoch (ms) falls inside the chosen window?
 *
 * `all` keeps everything (the cluster has already GC'd events past its
 * `--event-ttl`, so "all" is already bounded by what the API server retains).
 * Other options keep events seen within the last N seconds, inclusive of the
 * boundary (an event exactly `since` old is kept — "1h" should not flicker a
 * 3600.0s-old event in and out).
 */
export function eventWithinSince(
  lastSeenMs: number,
  option: SinceOption,
  nowMs: number,
): boolean {
  const secs = sinceSeconds(option);
  if (secs === undefined) return true; // "all"
  const cutoffMs = nowMs - secs * 1000;
  return lastSeenMs >= cutoffMs;
}

/**
 * Parse an ISO-8601 timestamp (the shape `lastTimestamp` carries on the wire
 * and that `map_event` writes into the AGE cell) into epoch ms.
 *
 * Returns `null` for a missing/garbage value rather than throwing: an event
 * with no parseable time is kept regardless of the since choice (filtering it
 * out would hide real data behind a serialization quirk).
 */
export function parseEventMs(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

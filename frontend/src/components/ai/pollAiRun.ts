/**
 * pollAiRun — the per-run event poll loop behind AiChat's send().
 *
 * Extracted from the component so its failure paths are unit-testable: the
 * loop talks to the raw `/api/invoke/ai_poll_events` endpoint (not the
 * provider layer) because it needs per-iteration abort control, and every
 * dependency (fetch, sleep, signal) is injected.
 *
 * Error contract:
 * - Non-2xx HTTP → explicit `HTTP <status>` error (res.json() on an error
 *   page would throw something far less actionable).
 * - `ok: false` in the body (e.g. an expired auth token) → reported once and
 *   the run ends: retrying can't fix a dead session.
 * - Network/parse errors → tolerated up to MAX_POLL_FAILURES *consecutive*
 *   misses before the run is declared lost, so a transient blip doesn't kill
 *   an otherwise healthy agent run, but a dead endpoint can't loop forever.
 * - AbortError (component unmounted mid-request) → silent stop.
 *
 * Whenever the run ends through an error the caller gets onError (push an
 * error row) followed by onFinish (clear busy/runId) — before this contract
 * a lost run left the panel spinning forever.
 */

import type { AgentEvent } from '../../lib/ai/types';

/** Consecutive failed polls tolerated before the run is declared lost. */
export const MAX_POLL_FAILURES = 5;

/** Delay between polls — matches the interval the UI was built around. */
const DEFAULT_INTERVAL_MS = 800;

/** One entry of the `events` array the backend returns for a poll. */
export interface PollEventEntry {
  runId: string;
  event: AgentEvent;
}

/** The `data` payload of a successful ai_poll_events response. */
export interface PollEventsData {
  events?: PollEventEntry[];
  total?: number;
  done?: boolean;
}

/** Everything pollAiRun needs from its host; all injected for testability. */
export interface PollDeps {
  fetchImpl: typeof fetch;
  /** Auth headers for the invoke endpoint (transport's apiHeaders). */
  headers: () => Promise<Record<string, string>>;
  sleep: (ms: number) => Promise<void>;
  /** True once the host component wants the loop to stop (unmount). */
  isCancelled: () => boolean;
  /** Fresh AbortSignal per request so unmount cancels the in-flight one. */
  signalFor: () => AbortSignal | undefined;
  onEvent: (ev: AgentEvent) => void;
  /** Push an error row into the transcript. */
  onError: (message: string) => void;
  /** Clear the run UI (busy flag + runId) — the run is over, one way or another. */
  onFinish: () => void;
  intervalMs?: number;
}

export async function pollAiRun(runId: string, deps: PollDeps): Promise<void> {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  let afterIndex = 0;
  let failures = 0;
  while (!deps.isCancelled()) {
    await deps.sleep(intervalMs);
    if (deps.isCancelled()) return;
    try {
      const res = await deps.fetchImpl('/api/invoke/ai_poll_events', {
        method: 'POST',
        headers: await deps.headers(),
        body: JSON.stringify({ runId, afterIndex }),
        signal: deps.signalFor(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.ok === false) {
        // The wire layer always answers { ok, data | error }; ok:false never
        // recovers on retry (auth expired, run purged) — report and stop.
        deps.onError(json.error ?? 'AI event polling failed');
        deps.onFinish();
        return;
      }
      // Unwrap { ok, data }; tolerate an already-unwrapped body.
      const data: PollEventsData = json.ok ? json.data : json;
      if (data?.events) {
        for (const entry of data.events) {
          // Drop events belonging to a superseded run (newChat / cancel).
          if (entry.runId === runId) deps.onEvent(entry.event);
        }
        afterIndex = data.total ?? afterIndex + data.events.length;
      }
      failures = 0;
      if (data?.done) return;
    } catch (e) {
      // AbortError is expected on unmount; anything else counts as a failure.
      if ((e as Error)?.name === 'AbortError') return;
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) {
        deps.onError(`AI event polling failed ${failures} times in a row: ${String(e)}`);
        deps.onFinish();
        return;
      }
      // Transient — the next iteration retries after the usual interval.
    }
  }
}

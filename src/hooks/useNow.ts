/**
 * useNow — returns a timestamp that updates on a fixed interval, so age columns
 * ("4d2h") re-render periodically without each row owning a timer. Default 30s.
 *
 * Uses a shared global timer: every component that calls `useNow` subscribes to
 * the same clock instead of each one creating its own setInterval. This cuts
 * timer overhead from N (one per mounted component) to 1.
 */

import { useSyncExternalStore } from 'react';

type Listener = () => void;

interface SharedClock {
  /** Current timestamp (ms). */
  now: number;
  /** Subscribe to tick updates. */
  subscribe: (listener: Listener) => () => void;
  /** Get the current snapshot (for useSyncExternalStore). */
  getSnapshot: () => number;
}

const clocks = new Map<number, SharedClock>();

function getClock(intervalMs: number): SharedClock {
  let clock = clocks.get(intervalMs);
  if (clock) return clock;

  let value = Date.now();
  const listeners = new Set<Listener>();

  const id = setInterval(() => {
    value = Date.now();
    for (const l of listeners) l();
  }, intervalMs);

  // Allow the timer to not keep the process alive (e.g. in tests).
  // Node's setInterval returns an object with `unref`; browser returns a number.
  if (typeof id !== 'number') (id as unknown as { unref: () => void }).unref?.();

  clock = {
    get now() {
      return value;
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        // Tear down the shared timer when the last subscriber leaves.
        if (listeners.size === 0) {
          clearInterval(id);
          clocks.delete(intervalMs);
        }
      };
    },
    getSnapshot() {
      return value;
    },
  };

  clocks.set(intervalMs, clock);
  return clock;
}

export function useNow(intervalMs = 30_000): number {
  const clock = getClock(intervalMs);
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot);
}

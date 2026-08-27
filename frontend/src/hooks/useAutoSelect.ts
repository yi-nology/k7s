/**
 * useFirstInstance / mergeErrors — the instance-picker boilerplate every
 * observability panel (Alerts / Audit / Grafana / Metrics) used to repeat
 * verbatim:
 *
 *   const [selected, setSelected] = useState<string | null>(null);
 *   useEffect(() => {
 *     if (instances.length > 0 && !selected) setSelected(instances[0].name);
 *   }, [instances, selected]);
 *   ...
 *   const error = actionError ?? q1.error ?? q2.error ?? null;
 *
 * Extracted so the four copies can't drift apart.
 */

import { useEffect, useState } from 'react';

/**
 * A `useState` for "which instance is selected", plus the auto-select
 * effect: once a non-empty instance list arrives and nothing is picked, the
 * first entry becomes the selection. Manual selection still wins — the
 * returned setter is an ordinary state setter.
 */
export function useFirstInstance<T extends { name: string }>(
  instances: T[]
): [string | null, (name: string | null) => void] {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (instances.length > 0 && !selected) setSelected(instances[0].name);
  }, [instances, selected]);
  return [selected, setSelected];
}

/**
 * First non-empty error, or null. Panel-local (action) errors are passed
 * first so they outrank the background queries' errors.
 */
export function mergeErrors(...errs: Array<string | null | undefined>): string | null {
  for (const e of errs) {
    if (e) return e;
  }
  return null;
}

/**
 * useProviderQuery — the one-shot provider fetch pattern as a hook.
 *
 * Replaces the hand-rolled fetch boilerplate that ~13 panels repeated:
 *
 *   // before
 *   const [rows, setRows] = useState<Row[]>([]);
 *   const [loading, setLoading] = useState(false);
 *   const [error, setError] = useState<string | null>(null);
 *   useEffect(() => {
 *     if (!selected) return;              // dependency not ready
 *     setLoading(true); setError(null);
 *     getProvider().listRows(selected)
 *       .then((r) => { setRows(r); setLoading(false); })
 *       .catch((e) => { setError(formatError(e)); setLoading(false); });
 *   }, [selected]);
 *
 *   // after
 *   const { data, loading, error, reload } = useProviderQuery({
 *     query: () => (selected ? getProvider().listRows(selected) : null),
 *     deps: [selected],
 *     key: `panel:rows:${selected ?? 'none'}`,
 *   });
 *   const rows = data ?? [];
 *
 * Semantics:
 *   - Runs on mount and whenever `deps` change (shallow compare — the deps
 *     feed a normal useEffect dependency array).
 *   - `query()` returning null means "not ready": no fetch, no loading, the
 *     previous data (if any) stands.
 *   - While a run is in flight the previous data is kept (stale-while-
 *     revalidate); a newer run supersedes an older in-flight one.
 *   - `reload()` forces a re-run with the latest `query()` closure, bypassing
 *     the cache.
 *   - With a `key`, successful results are written to a module-level TTL
 *     cache; a fresh cache hit seeds the hook at mount and skips the initial
 *     fetch. Cache reads happen only at mount — dep changes always refetch.
 *
 * Not for: polling, streams/SSE, or mutation handlers that need the
 * resolved value immediately (those keep their imperative form).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatError } from '../providers/errorHandler';

export interface QueryOptions<T> {
  /** Build the provider query; return null to skip (dependency not ready). */
  query: () => Promise<T> | null;
  deps: unknown[];
  /** Cache key; same key remounts reuse cached data within ttl. */
  key?: string;
  /** Cache TTL ms; default 30000, 0 disables caching. */
  ttlMs?: number;
}

export interface QueryResult<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  reload: () => void;
}

interface CacheEntry {
  at: number;
  data: unknown;
}

/** Module-level TTL cache shared by every useProviderQuery consumer. */
const cache = new Map<string, CacheEntry>();

/** Default cache TTL: 30s. */
const DEFAULT_TTL_MS = 30_000;

/** Empty the query cache. Exported for tests (and manual invalidation). */
export function clearProviderQueryCache(): void {
  cache.clear();
}

/** Return fresh cached data for `key`, or undefined when absent/expired. */
function readCache<T>(key: string | undefined, ttlMs: number): T | undefined {
  if (!key || ttlMs <= 0) return undefined;
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at >= ttlMs) return undefined;
  return entry.data as T;
}

export function useProviderQuery<T>(opts: QueryOptions<T>): QueryResult<T> {
  const { query, deps, key, ttlMs = DEFAULT_TTL_MS } = opts;

  // Mount-time cache read. Both initializers run exactly once per mount, so
  // a fresh hit seeds `data` directly and flags the first effect run to skip.
  const [initial] = useState(() => {
    const cached = readCache<T>(key, ttlMs);
    return { cached, seeded: cached !== undefined };
  });
  const [data, setData] = useState<T | undefined>(initial.cached);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);

  // `mounted` kills updates after unmount; `runId` lets a newer run discard
  // an older in-flight resolution (a slow stale fetch must not overwrite the
  // replacement that came after it).
  const mounted = useRef(true);
  const seeded = useRef(initial.seeded);
  const runId = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const id = ++runId.current;
    // A cache-seeded mount already has its data — skip the first fetch.
    const wasSeeded = seeded.current;
    seeded.current = false;
    if (!wasSeeded) run();
    function run(): void {
      let promise: Promise<T> | null;
      try {
        promise = query();
      } catch (e) {
        setError(formatError(e));
        setLoading(false);
        return;
      }
      if (promise === null) {
        // Dependency not ready: not loading, previous data stands.
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(undefined);
      void promise.then(
        (value) => {
          if (!mounted.current || id !== runId.current) return;
          if (key !== undefined && ttlMs > 0) {
            cache.set(key, { at: Date.now(), data: value });
          }
          setData(value);
          setLoading(false);
        },
        (e: unknown) => {
          if (!mounted.current || id !== runId.current) return;
          setError(formatError(e));
          setLoading(false);
        },
      );
    }
    // Always register the cleanup so an unmount kills in-flight updates,
    // even when this run skipped fetching.
    return () => {
      mounted.current = false;
    };
    // The caller's `deps` drive refetches (spread into the array below so
    // React's own shallow element compare IS the shallow compare); the
    // reload token is `reload()`. `query`/`key`/`ttlMs` are read from the
    // latest closure at run time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken, ...deps]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { data, loading, error, reload };
}

/**
 * Tests for useProviderQuery — the one-shot provider fetch hook.
 *
 * Covers: success path, error path, null-query skip, cache hit within the
 * ttl, cache miss after expiry, reload() forcing a re-run, dep-change
 * refetch with stale-while-revalidate, and ttlMs=0 disabling the cache.
 *
 * The provider is mocked at '../providers' following the established panel-
 * test pattern (importOriginal + getProvider override); the queries under
 * test call `provider().listItems()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getProvider } from '../providers';
import {
  clearProviderQueryCache,
  useProviderQuery,
  type QueryOptions,
  type QueryResult,
} from './useProviderQuery';

// React refuses to run act() without this, and says so loudly.
declare global {
   
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock the provider (same importOriginal + override shape as the panel tests).
const providerMocks = vi.hoisted(() => ({ listItems: vi.fn() }));
vi.mock('../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      listItems: providerMocks.listItems,
    }),
  };
});

// The mock factory swaps getProvider's runtime return type; this typed alias
// keeps the query call sites readable and type-safe.
const provider = getProvider as unknown as () => {
  listItems: (typeof providerMocks)['listItems'];
};

// ---------------------------------------------------------------------------
// Harness — like hooks/testUtils renderHook, plus rerender support so tests
// can change deps and assert refetch behavior.
// ---------------------------------------------------------------------------

interface ProbeHandle<T> {
  /** The most recently rendered QueryResult. */
  latest: () => QueryResult<T>;
  /** Re-render the harness with new options (e.g. changed deps). */
  rerender: (opts: QueryOptions<T>) => void;
  unmount: () => void;
}

/** Mount a component that runs the hook with `opts`, recording every result. */
function renderProbe<T>(initialOpts: QueryOptions<T>): ProbeHandle<T> {
  const results: QueryResult<T>[] = [];
  const Harness = (props: { opts: QueryOptions<T> }): ReactNode => {
    results.push(useProviderQuery(props.opts));
    return null;
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const commit = (opts: QueryOptions<T>) => {
    act(() => {
      root.render(createElement(Harness, { opts }));
    });
  };
  commit(initialOpts);
  return {
    latest: () => results[results.length - 1],
    rerender: commit,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Flush pending microtasks so in-flight promises land inside act(). */
async function flush(): Promise<void> {
  await act(async () => {});
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useProviderQuery', () => {
  beforeEach(() => {
    clearProviderQueryCache();
    providerMocks.listItems.mockReset();
  });

  it('fetches on mount and reports data once resolved', async () => {
    providerMocks.listItems.mockResolvedValue(['a', 'b']);
    const probe = renderProbe({ query: () => provider().listItems(), deps: [] });

    // In flight: loading, no data yet.
    expect(probe.latest().loading).toBe(true);
    expect(probe.latest().data).toBeUndefined();

    await flush();
    expect(probe.latest().data).toEqual(['a', 'b']);
    expect(probe.latest().loading).toBe(false);
    expect(probe.latest().error).toBeUndefined();
    probe.unmount();
  });

  it('reports a string error when the query rejects', async () => {
    providerMocks.listItems.mockRejectedValue(new Error('boom'));
    const probe = renderProbe({ query: () => provider().listItems(), deps: [] });

    await flush();
    expect(probe.latest().error).toBe('boom');
    expect(probe.latest().data).toBeUndefined();
    expect(probe.latest().loading).toBe(false);
    probe.unmount();
  });

  it('skips fetching while query() returns null (dependency not ready)', async () => {
    const probe = renderProbe({ query: () => null, deps: [] });

    await flush();
    expect(providerMocks.listItems).not.toHaveBeenCalled();
    expect(probe.latest().loading).toBe(false);
    expect(probe.latest().data).toBeUndefined();
    probe.unmount();
  });

  it('keeps previous data while a null query would run (deps back to not-ready)', async () => {
    providerMocks.listItems.mockResolvedValue(['kept']);
    let ready = true;
    const probe = renderProbe({
      query: () => (ready ? provider().listItems() : null),
      deps: [ready],
    });
    await flush();
    expect(probe.latest().data).toEqual(['kept']);

    // Dep flips to "not ready" — no fetch, previous data stands.
    ready = false;
    probe.rerender({
      query: () => (ready ? provider().listItems() : null),
      deps: [ready],
    });
    await flush();
    expect(providerMocks.listItems).toHaveBeenCalledTimes(1);
    expect(probe.latest().data).toEqual(['kept']);
    expect(probe.latest().loading).toBe(false);
    probe.unmount();
  });

  it('reuses cached data when the same key remounts within the ttl', async () => {
    providerMocks.listItems.mockResolvedValue(['cached']);
    const first = renderProbe({ query: () => provider().listItems(), deps: [], key: 'k' });
    await flush();
    expect(first.latest().data).toEqual(['cached']);
    first.unmount();

    providerMocks.listItems.mockClear();
    const second = renderProbe({ query: () => provider().listItems(), deps: [], key: 'k' });
    // Seeded synchronously from the cache — no fetch, no loading.
    expect(second.latest().data).toEqual(['cached']);
    expect(second.latest().loading).toBe(false);
    await flush();
    expect(providerMocks.listItems).not.toHaveBeenCalled();
    second.unmount();
  });

  it('refetches once the cached entry has expired', async () => {
    vi.useFakeTimers();
    providerMocks.listItems.mockResolvedValue(['old']);
    const first = renderProbe({ query: () => provider().listItems(), deps: [], key: 'k' });
    await flush();
    expect(first.latest().data).toEqual(['old']);
    first.unmount();

    providerMocks.listItems.mockClear();
    providerMocks.listItems.mockResolvedValue(['fresh']);
    await vi.advanceTimersByTimeAsync(30_001); // past the default 30s ttl

    const second = renderProbe({ query: () => provider().listItems(), deps: [], key: 'k' });
    expect(second.latest().data).toBeUndefined(); // cache miss → not seeded
    await flush();
    expect(providerMocks.listItems).toHaveBeenCalledTimes(1);
    expect(second.latest().data).toEqual(['fresh']);
    second.unmount();
  });

  it('does not cache when ttlMs is 0', async () => {
    providerMocks.listItems.mockResolvedValue(['x']);
    const first = renderProbe({
      query: () => provider().listItems(),
      deps: [],
      key: 'k0',
      ttlMs: 0,
    });
    await flush();
    first.unmount();

    providerMocks.listItems.mockClear();
    const second = renderProbe({
      query: () => provider().listItems(),
      deps: [],
      key: 'k0',
      ttlMs: 0,
    });
    expect(second.latest().data).toBeUndefined();
    await flush();
    expect(providerMocks.listItems).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it('reload() forces a re-run', async () => {
    providerMocks.listItems.mockResolvedValueOnce(['one']).mockResolvedValueOnce(['two']);
    const probe = renderProbe({ query: () => provider().listItems(), deps: [] });
    await flush();
    expect(probe.latest().data).toEqual(['one']);

    act(() => probe.latest().reload());
    await flush();
    expect(providerMocks.listItems).toHaveBeenCalledTimes(2);
    expect(probe.latest().data).toEqual(['two']);
    probe.unmount();
  });

  it('refetches on dep change and keeps previous data while loading', async () => {
    let resolve: (v: string[]) => void = () => {};
    providerMocks.listItems.mockImplementation(
      () => new Promise<string[]>((r) => {
        resolve = r;
      })
    );
    const probe = renderProbe<string[]>({
      query: () => provider().listItems(),
      deps: ['a'],
    });
    resolve(['a-data']);
    await flush();
    expect(probe.latest().data).toEqual(['a-data']);

    probe.rerender({ query: () => provider().listItems(), deps: ['b'] });
    // Deps changed → new run in flight; previous data stands.
    expect(probe.latest().loading).toBe(true);
    expect(probe.latest().data).toEqual(['a-data']);
    resolve(['b-data']);
    await flush();
    expect(probe.latest().data).toEqual(['b-data']);
    probe.unmount();
  });

  it('does not refetch when deps are shallow-equal across renders', async () => {
    providerMocks.listItems.mockResolvedValue(['once']);
    const opts = { query: () => provider().listItems(), deps: ['same'] };
    const probe = renderProbe(opts);
    await flush();
    probe.rerender({ ...opts, deps: ['same'] });
    await flush();
    expect(providerMocks.listItems).toHaveBeenCalledTimes(1);
    probe.unmount();
  });

  // The cache used to be write-only: entries for every panel-selection pair
  // lived forever. Writes must now evict beyond the cap (oldest first) and
  // drop stale entries, so a long session can't grow it without bound.
  it('bounds the cache: exceeding 100 entries evicts the oldest', async () => {
    providerMocks.listItems.mockResolvedValue(['v']);
    // 101 distinct keys via dep changes on one probe: each write leaves one
    // entry, so the 101st must push the 1st out.
    const probe = renderProbe<string[]>({ query: () => provider().listItems(), deps: ['k0'], key: 'k0' });
    await flush();
    for (let i = 1; i <= 100; i++) {
      probe.rerender({ query: () => provider().listItems(), deps: [`k${i}`], key: `k${i}` });
      await flush();
    }
    // 'k0' was evicted — remounting with that key refetches instead of
    // seeding from cache.
    const callsAfterEviction = providerMocks.listItems.mock.calls.length;
    const again = renderProbe<string[]>({ query: () => provider().listItems(), deps: ['k0'], key: 'k0' });
    await flush();
    expect(providerMocks.listItems.mock.calls.length).toBeGreaterThan(callsAfterEviction);
    expect(again.latest().data).toEqual(['v']);
    probe.unmount();
    again.unmount();
  });
});

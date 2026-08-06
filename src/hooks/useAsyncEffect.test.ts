import { describe, it, expect, vi } from 'vitest';
import { renderHook } from './testUtils';
import { useAsyncEffect } from './useAsyncEffect';

describe('useAsyncEffect', () => {
  it('runs a sync effect and reports isMounted() === true', () => {
    let seen: boolean | null = null;
    renderHook(() =>
      useAsyncEffect((isMounted) => {
        seen = isMounted();
      }, []),
    );
    expect(seen).toBe(true);
  });

  it('guards a late async state update against unmount', async () => {
    vi.useFakeTimers();
    let late: boolean | null = null;
    const slow = () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 50));

    // Mount, then unmount synchronously — before the 50ms timer can fire.
    // The effect's awaited continuation must observe isMounted() === false.
    const handle = renderHook(() =>
      useAsyncEffect(async (isMounted) => {
        const r = await slow();
        late = isMounted() && r;
      }, []),
    );
    handle.unmount();
    await vi.advanceTimersByTimeAsync(50);
    expect(late).toBe(false);
    vi.useRealTimers();
  });

  it('completes the async update when still mounted', async () => {
    vi.useFakeTimers();
    let late: boolean | null = null;
    const slow = () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 10));
    renderHook(() =>
      useAsyncEffect(async (isMounted) => {
        const r = await slow();
        late = isMounted() && r;
      }, []),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(late).toBe(true);
    vi.useRealTimers();
  });

  it('runs the async effect to completion when still mounted', async () => {
    let result: string | null = null;
    const quick = () => Promise.resolve('ok');
    renderHook(() =>
      useAsyncEffect(async (isMounted) => {
        const r = await quick();
        if (isMounted()) result = r;
      }, []),
    );
    await vi.waitFor(() => expect(result).toBe('ok'));
  });

  it('does not throw when the effect returns a non-thenable', () => {
    renderHook(() =>
      useAsyncEffect(() => {
        /* no-op sync */
      }, []),
    );
    // reaching here without throwing is the assertion
    expect(true).toBe(true);
  });
});

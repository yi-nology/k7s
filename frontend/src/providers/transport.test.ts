/**
 * SSE event-bus behaviour tests. The bus is module-private, so these drive
 * it through `httpSubscribe` with a stubbed `fetch` — the same seam the
 * HttpProvider uses.
 */
import { describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { httpSubscribe } = await import('./transport');

/** A `fetch` response whose body yields `chunks` then ends (`done`). */
function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    body: {
      getReader() {
        return {
          read: async () => {
            if (i < chunks.length) {
              return { value: encoder.encode(chunks[i++]), done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    },
  };
}

/** A response whose stream stays open forever (a healthy live connection). */
function sseHangingResponse(chunks: string[] = []) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    body: {
      getReader() {
        return {
          read: async () => {
            if (i < chunks.length) {
              return { value: encoder.encode(chunks[i++]), done: false };
            }
            return new Promise<never>(() => {}); // never resolves
          },
        };
      },
    },
  };
}

function eventsCalls(): number {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes('/events')).length;
}

describe('sharedEventBus reconnect', () => {
  it('reconnects and resumes dispatch after the server closes the stream', async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 't' }) }) // /api/web-token
      .mockResolvedValueOnce(sseResponse([])) // first /events: closes cleanly
      .mockResolvedValueOnce(sseHangingResponse(['event: ping\ndata: {"v":7}\n\n']));

    const seen: unknown[] = [];
    const sub = httpSubscribe<{ v: number }>('ping', (p) => seen.push(p));

    // Backoff starts at 250ms — wait past it for the second connection.
    await new Promise((r) => setTimeout(r, 600));

    expect(eventsCalls()).toBe(2);
    expect(seen).toEqual([{ v: 7 }]); // the reconnected stream is live
    sub.unsubscribe();
  });

  it('dispatches events from a healthy stream without reconnecting', async () => {
    fetchMock.mockReset();
    // NOTE: the web-token promise is cached from the first test, so the only
    // fetch issued here is the /events one.
    fetchMock.mockResolvedValueOnce(sseHangingResponse(['event: tick\ndata: {"n":1}\n\n']));

    const seen: unknown[] = [];
    const sub = httpSubscribe<{ n: number }>('tick', (p) => seen.push(p));
    await new Promise((r) => setTimeout(r, 100));

    expect(seen).toEqual([{ n: 1 }]);
    expect(eventsCalls()).toBe(1);
    sub.unsubscribe();
  });
});

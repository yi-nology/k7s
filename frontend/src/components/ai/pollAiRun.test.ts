/**
 * Tests for pollAiRun — the AI run's event poll loop.
 *
 * Covers the failure contract: non-2xx HTTP, ok:false bodies, the
 * consecutive-failure cap (with recovery after a transient blip), and the
 * silent AbortError path — plus event delivery and afterIndex progression.
 */

import { describe, expect, it, vi } from 'vitest';

import { MAX_POLL_FAILURES, pollAiRun } from './pollAiRun';
import type { PollEventEntry } from './pollAiRun';
import type { AgentEvent } from '../../lib/ai/types';

/** A Response-shaped stand-in — pollAiRun only reads ok/status/json. */
function res(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

interface Harness {
  bodies: Array<() => unknown>; // queue: each poll pops the next response body
  requests: Array<{ afterIndex: number; runId: string }>;
  events: AgentEvent[];
  errors: string[];
  finished: number;
  run: (runId?: string) => Promise<void>;
}

function harness(bodies: Array<() => unknown>, failWith?: () => never): Harness {
  const h: Harness = {
    bodies,
    requests: [],
    events: [],
    errors: [],
    finished: 0,
    run: () => Promise.resolve(),
  };
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { afterIndex: number; runId: string };
    h.requests.push(body);
    const next = h.bodies.shift();
    if (next === undefined) {
      // No more scripted responses: park forever-ish so the loop's own
      // termination is what ends the test, not a missing mock.
      return res({ ok: true, data: { done: true } });
    }
    return next();
  });
  if (failWith) {
    // Replace the queued behavior with a hard network failure every time.
    h.bodies = [];
    fetchImpl.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { afterIndex: number; runId: string };
      h.requests.push(body);
      failWith();
    });
  }
  h.run = (runId = 'run-1') =>
    pollAiRun(runId, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      headers: async () => ({}),
      // No real waiting — the loop's pacing is not under test.
      sleep: () => Promise.resolve(),
      isCancelled: () => false,
      signalFor: () => undefined,
      onEvent: (ev) => h.events.push(ev),
      onError: (msg) => h.errors.push(msg),
      onFinish: () => {
        h.finished += 1;
      },
    });
  return h;
}

describe('pollAiRun', () => {
  describe('happy path', () => {
    it('delivers events and advances afterIndex by total', async () => {
      const text: AgentEvent = { type: 'textDelta', text: 'hi' };
      const entry = (runId: string): PollEventEntry => ({ runId, event: text });
      const h = harness([
        () => res({ ok: true, data: { events: [entry('run-1')], total: 3 } }),
        () => res({ ok: true, data: { events: [entry('run-1')], total: 4, done: true } }),
      ]);
      await h.run();
      expect(h.events.length).toBe(2);
      // The second request must resume from the first response's total.
      expect(h.requests.map((r) => r.afterIndex)).toEqual([0, 3]);
      // done ends the run without an error or a forced finish.
      expect(h.errors).toEqual([]);
      expect(h.finished).toBe(0);
    });

    it('drops events whose runId does not match the polled run', async () => {
      const h = harness([
        () =>
          res({
            ok: true,
            data: { events: [{ runId: 'other-run', event: { type: 'textDelta', text: 'x' } }], done: true },
          }),
      ]);
      await h.run('run-1');
      expect(h.events).toEqual([]);
    });
  });

  describe('error paths', () => {
    it('reports an explicit HTTP error and stops on non-2xx status', async () => {
      const badGateway = () => res({ message: 'server exploded' }, /* ok */ false, 502);
      const h = harness(Array.from({ length: MAX_POLL_FAILURES }, () => badGateway));
      await h.run();
      // The loop tolerates failures up to the cap before giving up — a 502
      // alone must not kill the run, but it must never be silently swallowed.
      expect(h.requests.length).toBe(MAX_POLL_FAILURES);
      expect(h.errors.length).toBe(1);
      expect(h.errors[0]).toContain('HTTP 502');
      expect(h.finished).toBe(1);
    });

    it('reports the server error and stops immediately on ok:false', async () => {
      const h = harness([
        () => res({ ok: false, error: 'token expired' }),
        () => res({ ok: true, data: { done: true } }),
      ]);
      await h.run();
      expect(h.errors).toEqual(['token expired']);
      expect(h.finished).toBe(1);
      // Stopped for good: the second scripted response is never consumed.
      expect(h.requests.length).toBe(1);
    });

    it('falls back to a generic message when ok:false carries no error', async () => {
      const h = harness([() => res({ ok: false })]);
      await h.run();
      expect(h.errors.length).toBe(1);
      expect(h.errors[0]).not.toContain('undefined');
    });

    it('survives transient network failures and resets the counter', async () => {
      let calls = 0;
      const h = harness([
        () => {
          calls += 1;
          if (calls === 1) throw new TypeError('network blip');
          return res({ ok: true, data: { done: true } });
        },
      ]);
      await h.run();
      expect(h.errors).toEqual([]);
      expect(h.finished).toBe(0);
      expect(h.requests.length).toBe(2);
    });

    it('gives up after MAX_POLL_FAILURES consecutive network errors', async () => {
      const h = harness(
        [],
        () => {
          throw new TypeError('network down');
        }
      );
      await h.run();
      expect(h.requests.length).toBe(MAX_POLL_FAILURES);
      expect(h.errors.length).toBe(1);
      expect(h.errors[0]).toContain('network down');
      expect(h.finished).toBe(1);
    });

    it('stops silently on AbortError (component unmount)', async () => {
      const h = harness(
        [],
        () => {
          const e = new Error('aborted') as Error & { name: string };
          e.name = 'AbortError';
          throw e;
        }
      );
      await h.run();
      expect(h.errors).toEqual([]);
      expect(h.finished).toBe(0);
    });

    it('stops without side effects when cancelled between polls', async () => {
      const h = harness([() => res({ ok: true, data: { done: true } })]);
      await pollAiRun('run-1', {
        fetchImpl: (() => Promise.resolve(res({ ok: true, data: {} }))) as unknown as typeof fetch,
        headers: async () => ({}),
        sleep: () => Promise.resolve(),
        isCancelled: () => true,
        signalFor: () => undefined,
        onEvent: () => {},
        onError: (msg) => h.errors.push(msg),
        onFinish: () => {
          h.finished += 1;
        },
      });
      expect(h.requests.length).toBe(0);
      expect(h.errors).toEqual([]);
      expect(h.finished).toBe(0);
    });
  });
});

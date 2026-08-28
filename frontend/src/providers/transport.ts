/**
 * Transport — the single seam between the UI and whatever's on the other end.
 *
 * Two implementations:
 * - Tauri: goes through `@tauri-apps/api`'s `invoke` / `listen`. The wire
 *   format is the Tauri IPC channel. Used in the desktop app.
 * - HTTP: goes through `fetch` / `EventSource`. The wire format is JSON over
 *   HTTP for one-shot commands and SSE for live events. Used by the browser
 *   shell, which talks to a k7s-web axum server.
 *
 * Both produce the same `invoke` / `subscribe` surface to the rest of the
 * UI, so `TauriProvider` and `HttpProvider` (sibling files) just differ in
 * which transport they bind to.
 */

/** True when the app is running inside a Tauri webview. */
export const IS_TAURI =
  typeof window !== 'undefined' &&
  // The Tauri runtime sets this global before any user code runs.
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

/** True when the app was started in demo mode. Takes precedence over both. */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

/**
 * True when the app is running on iPadOS / iOS inside the Tauri mobile webview.
 * Detected via the user-agent string set by WKWebView — the Tauri mobile shell
 * sets a custom user-agent that includes "k7s-ios" (see tauri.conf.json), but
 * we also fall back to the standard iPad/iPhone UA tokens for robustness.
 */
export const IS_IPADOS =
  IS_TAURI &&
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as "Macintosh" in the UA but has touch support.
    ('ontouchend' in document && navigator.maxTouchPoints > 0 && /Macintosh/.test(navigator.userAgent)));

/**
 * One-shot RPC: call a named command with JSON-serialisable args, get a
 * JSON value back (or a rejected promise with the error message).
 */
export type Invoker = <T>(cmd: string, args?: unknown) => Promise<T>;

/** One-way push: the server emits typed events; the UI hands them to `cb`. */
export type EventSubscription = {
  /** Stop receiving events. Idempotent. */
  unsubscribe: () => void;
};

/** Subscribe to a named event stream. Returns an unsubscribe handle. */
export type SubscribeFn = <T>(event: string, cb: (payload: T) => void) => EventSubscription;

// ---------------------------------------------------------------------------
// HTTP transport (browser shell, talks to k7s-web).
// ---------------------------------------------------------------------------

/**
 * Base URL for the back-end. Vite's dev server proxies `/api/*` to the
 * k7s-web server, so the browser sees one origin (1420) and the HTTP
 * traffic lands on 7180 transparently.
 */
const API_BASE = '/api';

/** Wire shape every command returns. Mirrors the Rust `InvokeResponse<T>`. */
interface WireResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Bearer token for the k7s-web API. The loopback server publishes a random
 * token at `GET /api/web-token` (same-origin, so only the SPA can read it);
 * every `/api/invoke/*` + `/hooks/*` call must carry it. Fetched once, cached
 * for the page lifetime. Returns '' when there's no token (Tauri desktop, or a
 * non-loopback bind that didn't set K7S_WEB_TOKEN) — callers then send no
 * Authorization header and the request 401s, which is the correct failure.
 */
let webTokenPromise: Promise<string> | null = null;
function getWebToken(): Promise<string> {
  if (webTokenPromise) return webTokenPromise;
  webTokenPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/web-token`);
      if (!res.ok) return '';
      const body = (await res.json()) as { token?: string };
      return body.token ?? '';
    } catch {
      return '';
    }
  })();
  return webTokenPromise;
}

/** Headers (incl. the bearer token when present) for an API request. */
export async function apiHeaders(
  extra?: Record<string, string>
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  const token = await getWebToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export const httpInvoke: Invoker = async <T>(cmd: string, args?: unknown): Promise<T> => {
  const url = `${API_BASE}/invoke/${cmd}`;
  const init: RequestInit = {
    method: 'POST',
    headers: await apiHeaders(),
    body: args === undefined ? undefined : JSON.stringify(args),
  };
  const res = await fetch(url, init);
  // The back-end always returns 200 with `{ ok, data | error }` so the body
  // shape is uniform; treat 4xx/5xx as a hard transport failure (server
  // crashed, network down, etc.).
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${cmd}`);
  }
  const body = (await res.json()) as WireResponse<T>;
  if (!body.ok) {
    // Surface the server's own error message verbatim — it includes the
    // k8s API error string for failed calls.
    throw new Error(body.error ?? `${cmd} failed (no error message)`);
  }
  return body.data as T;
};

/**
 * POST JSON to a dedicated `/api/*` route (not the registry catch-all) and
 * decode the same `{ ok, data | error }` envelope. Mirrors {@link httpInvoke}
 * exactly — same bearer-token header, same uniform-200 body shape, same
 * verbatim error surfacing — but takes the full path instead of building
 * `/api/invoke/{cmd}`. Exists for routes whose body limit the registry's
 * catch-all can't carry (e.g. the 90MB chart-upload route vs axum's 2MB
 * default for `/api/invoke/*`).
 */
export async function httpPostJson<T>(path: string, body: unknown): Promise<T> {
  const init: RequestInit = {
    method: 'POST',
    headers: await apiHeaders(),
    body: JSON.stringify(body),
  };
  const res = await fetch(path, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${path}`);
  }
  const wire = (await res.json()) as WireResponse<T>;
  if (!wire.ok) {
    throw new Error(wire.error ?? `${path} failed (no error message)`);
  }
  return wire.data as T;
}

export const httpSubscribe: SubscribeFn = <T>(
  event: string,
  cb: (payload: T) => void
): EventSubscription => {
  // The browser caps HTTP/1.1 connections per origin at 6 (Chrome/Edge/Firefox
  // and 6 on Safari). With 6 long-lived SSE streams open, *no* connection is
  // free for one-shot `/api/invoke/*` POSTs — the browser queues them and
  // they sit there forever, so the UI looks "frozen" right after boot (load_prefs
  // returns first because the page only opened two connections at that
  // point; list_contexts goes in the queue and never comes back).
  //
  // Fix: share a single fetch+ReadableStream across every subscriber. The
  // server-side `/api/events` endpoint already fans out every event type
  // to every open connection, so a single client connection sees them all;
  // we demux by `event:` line in this file and dispatch to the right
  // callback. The connection auto-reconnects on transient errors.
  return sharedEventBus.subscribe(event, cb);
};

/**
 * One fetch+ReadableStream per browser tab, multiplexing every named
 * subscription. The transport owns it; `httpSubscribe` joins the
 * subscriber set, `unsubscribe` leaves. If the connection drops, we
 * reconnect with exponential backoff and re-attach the still-active
 * subscribers automatically.
 */
type Listener = (payload: unknown) => void;

const sharedEventBus = (() => {
  const listeners = new Map<string, Set<Listener>>();
  let controller: AbortController | null = null;
  let backoffMs = 250;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const dispatch = (event: string, payload: unknown) => {
    const set = listeners.get(event);
    if (!set) return;
    for (const l of set) {
      try {
        l(payload);
      } catch (e) {
        // A buggy listener shouldn't take down its peers.

        console.error(`[transport] listener for "${event}" threw:`, e);
      }
    }
  };

  const connect = () => {
    if (controller) return; // already connecting/connected
    controller = new AbortController();
    const url = `${API_BASE}/events`;
    void (async () => {
      try {
        const res = await fetch(url, {
          signal: controller!.signal,
          headers: await apiHeaders(),
        });
        if (!res.ok || !res.body) {
          throw new Error(`SSE: HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let currentEvent: string | null = null;
        backoffMs = 250; // healthy connection — reset backoff
         
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).replace(/\r$/, '');
            buf = buf.slice(nl + 1);
            if (line === '') {
              currentEvent = null;
            } else if (line.startsWith('event: ')) {
              currentEvent = line.slice(7);
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const payload = JSON.parse(line.slice(6));
                dispatch(currentEvent, payload);
              } catch {
                // Ignore malformed lines — server should always send JSON.
              }
            }
          }
        }
        // The server closed the stream cleanly (done). Reconnect so live
        // updates resume — the old code just fell out of the loop here,
        // leaving `controller` truthy so neither `connect()` nor a later
        // `subscribe()` would ever reopen, and the event bus went silently
        // dead until a full page reload. (An intentional abort never reaches
        // this point: abort makes `read()` reject and returns via catch.)
        scheduleReconnect();
      } catch (e) {
        if ((e as Error).name === 'AbortError') return; // intentional

        console.warn(`[transport] SSE dropped, reconnecting:`, e);
        scheduleReconnect();
      }
    })();
  };

  const scheduleReconnect = () => {
    controller = null;
    if (listeners.size === 0) return; // no one wants the stream
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, backoffMs);
    backoffMs = Math.min(backoffMs * 2, 5000);
  };

  return {
    subscribe<T>(event: string, cb: (payload: T) => void): EventSubscription {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      const wrapped = cb as Listener;
      set.add(wrapped);
      if (!controller) connect();
      let active = true;
      return {
        unsubscribe: () => {
          if (!active) return;
          active = false;
          set!.delete(wrapped);
          if (set!.size === 0) listeners.delete(event);
          // If nobody is listening anymore, drop the connection so the
          // browser frees the slot for one-shot HTTP calls.
          if (listeners.size === 0 && controller) {
            controller.abort();
            controller = null;
          }
        },
      };
    },
  };
})();

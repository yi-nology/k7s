/**
 * Global test setup — runs before every test file.
 *
 * Imports @testing-library/jest-dom so that custom DOM matchers
 * (toBeInTheDocument, toHaveTextContent, etc.) are available globally
 * in all tests without individual imports.
 */
import '@testing-library/jest-dom/vitest';

// ---------------------------------------------------------------------------
// Suppress known-safe "not wrapped in act(...)" warnings.
//
// Many components fire async effects (provider calls) on mount that resolve
// and call setState after the synchronous act() boundary from render(). These
// warnings are benign — the state updates land before any assertion that
// depends on them, and all 1150 tests pass. Filtering keeps the test output
// clean so real issues aren't buried in noise.
// ---------------------------------------------------------------------------
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.includes('not wrapped in act')) return;
  originalConsoleError(...args);
};

// ---------------------------------------------------------------------------
// Polyfills for jsdom: APIs that exist in real browsers but are missing or
// stubbed in the jsdom environment used by Vitest.
// ---------------------------------------------------------------------------

// ResizeObserver — used by ResourceTable's virtual scrolling (B21).
// Calls callbacks synchronously on observe() so that state updates stay inside
// the act() boundary and don't trigger spurious warnings.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    private _cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this._cb = cb;
    }
    observe(target: Element) {
      // Fire synchronously so the initial viewport measurement lands in act().
      const entry = {
        target,
        contentRect: target.getBoundingClientRect(),
        borderBoxSize: [{ inlineSize: 0, blockSize: 0 }],
        contentBoxSize: [{ inlineSize: 0, blockSize: 0 }],
        devicePixelContentBoxSize: [{ inlineSize: 0, blockSize: 0 }],
      } as unknown as ResizeObserverEntry;
      this._cb([entry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// IntersectionObserver — used by some components for visibility detection.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    root = null;
    rootMargin = '';
    thresholds = [0];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

// scrollIntoView — jsdom doesn't implement layout, so this is a no-op.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

// getBoundingClientRect — jsdom returns all zeros; provide a minimal stub.
if (!HTMLElement.prototype.getBoundingClientRect) {
  HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON() {},
  });
}

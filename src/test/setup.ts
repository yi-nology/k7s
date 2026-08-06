/**
 * Global test setup — runs before every test file.
 *
 * Imports @testing-library/jest-dom so that custom DOM matchers
 * (toBeInTheDocument, toHaveTextContent, etc.) are available globally
 * in all tests without individual imports.
 */
import '@testing-library/jest-dom/vitest';

// ---------------------------------------------------------------------------
// Polyfills for jsdom: APIs that exist in real browsers but are missing or
// stubbed in the jsdom environment used by Vitest.
// ---------------------------------------------------------------------------

// ResizeObserver — used by ResourceTable's virtual scrolling (B21).
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
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

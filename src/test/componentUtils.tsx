/**
 * Component test harness — extends testUtils with a render function for
 * React components (not just hooks).
 *
 * Uses React 18's createRoot directly since @testing-library/react is not
 * installed. Provides query helpers scoped to the mounted container.
 */

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach } from 'vitest';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  cleanup();
});

/** Render a React component into the DOM and return query helpers. */
export function render(ui: ReactNode): RenderResult {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  mounted.push({ root, container });
  return makeQueries(container);
}

/** Unmount everything. */
export function cleanup(): void {
  act(() => {
    for (const { root } of mounted) root.unmount();
  });
  for (const { container } of mounted) container.remove();
  mounted.length = 0;
}

// ---------------------------------------------------------------------------
// Query helpers (scoped to the container)
// ---------------------------------------------------------------------------

export interface RenderResult {
  container: HTMLElement;
  /** Find element by text content (exact match or regex). */
  getByText(text: string | RegExp): HTMLElement;
  /** Find element by text content (exact match or regex). */
  queryByText(text: string | RegExp): HTMLElement | null;
  /** Find all elements matching text. */
  queryAllByText(text: string | RegExp): HTMLElement[];
  /** Find by data-testid. */
  getByTestId(id: string): HTMLElement;
  queryByTestId(id: string): HTMLElement | null;
  /** Find by role. */
  queryByRole(role: string, options?: { name?: string }): HTMLElement | null;
  queryAllByRole(role: string, options?: { name?: string }): HTMLElement[];
  /** Find by placeholder text. */
  queryByPlaceholderText(text: string): HTMLElement | null;
  /** Find <select> or <input> by label text. */
  queryByLabelText(text: string): HTMLElement | null;
  /** Find by CSS selector. */
  querySelector(selector: string): HTMLElement | null;
  querySelectorAll(selector: string): HTMLElement[];
  /** Fire a click event. */
  click(element: HTMLElement): void;
  /** Fire a change event on an input. */
  change(element: HTMLElement, value: string): void;
  /** Fire a keyboard event. */
  keyDown(element: HTMLElement, key: string, opts?: KeyboardEventInit): void;
}

function makeQueries(container: HTMLElement): RenderResult {
  return {
    container,
    getByText(text: string): HTMLElement {
      const el = findByText(container, text);
      if (!el) throw new Error(`getByText: "${text}" not found`);
      return el;
    },
    queryByText(text: string): HTMLElement | null {
      return findByText(container, text);
    },
    queryAllByText(text: string): HTMLElement[] {
      return findAllByText(container, text);
    },
    getByTestId(id: string): HTMLElement {
      const el = container.querySelector(`[data-testid="${id}"]`);
      if (!el) throw new Error(`getByTestId: "${id}" not found`);
      return el as HTMLElement;
    },
    queryByTestId(id: string): HTMLElement | null {
      return container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    },
    queryByRole(role: string, opts?: { name?: string }): HTMLElement | null {
      const candidates = container.querySelectorAll(`[role="${role}"]`);
      for (const el of candidates) {
        if (!opts?.name || el.textContent?.includes(opts.name)) return el as HTMLElement;
      }
      // Fallback: semantic roles via tag
      const semantic: Record<string, string> = {
        button: 'button',
        textbox: 'input, textarea',
        combobox: 'select',
        tablist: '[role="tablist"]',
        tab: '[role="tab"]',
      };
      if (semantic[role]) {
        const el = container.querySelector(semantic[role]);
        if (el && (!opts?.name || el.textContent?.includes(opts.name))) return el as HTMLElement;
      }
      return null;
    },
    queryAllByRole(role: string, opts?: { name?: string }): HTMLElement[] {
      const els = container.querySelectorAll(`[role="${role}"]`);
      const result: HTMLElement[] = [];
      els.forEach((el) => {
        if (!opts?.name || el.textContent?.includes(opts.name)) result.push(el as HTMLElement);
      });
      return result;
    },
    queryByPlaceholderText(text: string): HTMLElement | null {
      return container.querySelector(`[placeholder="${text}"]`) as HTMLElement | null;
    },
    queryByLabelText(text: string): HTMLElement | null {
      const labels = container.querySelectorAll('label');
      for (const label of labels) {
        if (label.textContent?.includes(text)) {
          const forId = label.getAttribute('for');
          if (forId) return container.querySelector(`#${forId}`) as HTMLElement | null;
          return label.querySelector('input, select, textarea') as HTMLElement | null;
        }
      }
      return null;
    },
    querySelector(selector: string): HTMLElement | null {
      return container.querySelector(selector) as HTMLElement | null;
    },
    querySelectorAll(selector: string): HTMLElement[] {
      return Array.from(container.querySelectorAll(selector)) as HTMLElement[];
    },
    click(element: HTMLElement): void {
      act(() => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    },
    change(element: HTMLElement, value: string): void {
      act(() => {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(element, value);
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      });
    },
    keyDown(element: HTMLElement, key: string, opts?: KeyboardEventInit): void {
      act(() => {
        element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Internal text search
// ---------------------------------------------------------------------------

function findByText(root: HTMLElement, text: string | RegExp): HTMLElement | null {
  const match = (s: string) =>
    typeof text === 'string' ? s === text : text.test(s);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const trimmed = node.textContent?.trim() ?? '';
    if (trimmed && match(trimmed)) {
      const el = node.parentElement;
      if (el) return el;
    }
  }
  // Fallback: check all leaf-ish elements
  const all = root.querySelectorAll('*');
  for (const el of all) {
    const trimmed = el.textContent?.trim() ?? '';
    if (trimmed && match(trimmed)) {
      return el as HTMLElement;
    }
  }
  return null;
}

function findAllByText(root: HTMLElement, text: string): HTMLElement[] {
  const results: HTMLElement[] = [];
  const all = root.querySelectorAll('*');
  for (const el of all) {
    if (el.textContent?.trim() === text) {
      results.push(el as HTMLElement);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Mock data factories
// ---------------------------------------------------------------------------

import type { Row, Cell, PodMeta } from '../providers/types/table';

/** Create a mock Cell with sensible defaults. */
export function createMockCell(overrides: Partial<Cell> = {}): Cell {
  return {
    text: 'test-value',
    tone: 'primary',
    ...overrides,
  };
}

/** Create a mock Row with sensible defaults. */
export function createMockRow(overrides: Partial<Row> = {}): Row {
  return {
    uid: overrides.uid ?? `uid-${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name ?? 'test-resource',
    namespace: overrides.namespace ?? 'default',
    cells: overrides.cells ?? [
      createMockCell({ text: overrides.name ?? 'test-resource' }),
      createMockCell({ text: 'default', tone: 'muted' }),
      createMockCell({ text: '1/1' }),
      createMockCell({ text: 'Running', tone: 'ok', dot: true }),
    ],
    ...('pod' in overrides ? { pod: overrides.pod } : {}),
    ...('labels' in overrides ? { labels: overrides.labels } : {}),
    ...('selector' in overrides ? { selector: overrides.selector } : {}),
    ...('involved' in overrides ? { involved: overrides.involved } : {}),
  };
}

/** Create a mock PodMeta. */
export function createMockPodMeta(overrides: Partial<PodMeta> = {}): PodMeta {
  return {
    node: 'test-node',
    containers: ['app'],
    status: 'Running',
    ready: '1/1',
    restarts: 0,
    creationTs: '2024-01-01T00:00:00Z',
    statusTone: 'ok',
    resources: {
      cpuRequestMillis: null,
      cpuLimitMillis: null,
      memRequestBytes: null,
      memLimitBytes: null,
    },
    ...overrides,
  };
}

/** Create a mock pod Row (with PodMeta). */
export function createMockPodRow(overrides: Partial<Row> = {}): Row {
  return createMockRow({
    name: 'test-pod',
    uid: 'pod-uid-1',
    cells: [
      createMockCell({ text: 'test-pod' }),
      createMockCell({ text: 'default', tone: 'muted' }),
      createMockCell({ text: '1/1' }),
      createMockCell({ text: '0' }),
      createMockCell({ text: '50m' }),
      createMockCell({ text: '64Mi' }),
      createMockCell({ text: '2024-01-01T00:00:00Z', format: 'age' }),
      createMockCell({ text: 'Running', tone: 'ok', dot: true }),
    ],
    pod: createMockPodMeta(),
    ...overrides,
  });
}

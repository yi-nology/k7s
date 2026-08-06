/**
 * A minimal hook harness for tests.
 *
 * Just enough to mount a hook so its effects run — which is what tests of
 * document-level key handlers need, since the binding only exists once the effect
 * has. React Testing Library would do this and much more; this is ~20 lines and
 * one fewer dependency, and the "much more" (queries, user-event) is for testing
 * rendered markup, which these tests don't.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach } from 'vitest';

// React refuses to run act() without this, and says so loudly.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  cleanup();
});

/** Mount a component that calls `hook`, running its effects. */
export function renderHook(hook: () => void): { unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const Harness = () => {
    hook();
    return null;
  };
  act(() => {
    root.render(createElement(Harness));
  });
  mounted.push({ root, container });
  // Detach so afterEach cleanup no longer double-unmounts this root.
  let active = true;
  return {
    unmount: () => {
      if (!active) return;
      active = false;
      act(() => root.unmount());
      container.remove();
      const idx = mounted.findIndex((m) => m.root === root);
      if (idx >= 0) mounted.splice(idx, 1);
    },
  };
}

/** Unmount everything, so a hook's listeners don't leak into the next test. */
export function cleanup(): void {
  act(() => {
    for (const { root } of mounted) root.unmount();
  });
  for (const { container } of mounted) container.remove();
  mounted.length = 0;
}

// ---------------------------------------------------------------------------
// Mock data factories
// ---------------------------------------------------------------------------

/** Create a mock Kubernetes resource with sensible defaults. */
export const createMockResource = (overrides: Record<string, unknown> = {}) => ({
  metadata: {
    name: 'test-resource',
    namespace: 'default',
    uid: 'test-uid',
    creationTimestamp: '2024-01-01T00:00:00Z',
    ...overrides,
  },
});

/** Create a mock Pod resource. */
export const createMockPod = (overrides: Record<string, unknown> = {}) => ({
  ...createMockResource({ name: 'test-pod', ...overrides }),
  spec: {
    nodeName: 'test-node',
    containers: [{ name: 'app', image: 'nginx:latest' }],
  },
  status: {
    phase: 'Running',
    conditions: [{ type: 'Ready', status: 'True' }],
    ...((overrides as { status?: Record<string, unknown> }).status ?? {}),
  },
});

/** Create a mock Node resource. */
export const createMockNode = (overrides: Record<string, unknown> = {}) => ({
  ...createMockResource({ name: 'test-node', ...overrides }),
  spec: {
    taints: [],
  },
  status: {
    conditions: [{ type: 'Ready', status: 'True' }],
    capacity: { cpu: '4', memory: '8Gi' },
    ...((overrides as { status?: Record<string, unknown> }).status ?? {}),
  },
});

/** Create a mock Service resource. */
export const createMockService = (overrides: Record<string, unknown> = {}) => ({
  ...createMockResource({ name: 'test-service', ...overrides }),
  spec: {
    type: 'ClusterIP',
    ports: [{ port: 80, targetPort: 8080, protocol: 'TCP' }],
    selector: { app: 'test' },
  },
  status: {},
});

/** Create a mock Deployment resource. */
export const createMockDeployment = (overrides: Record<string, unknown> = {}) => ({
  ...createMockResource({ name: 'test-deployment', ...overrides }),
  spec: {
    replicas: 3,
    selector: { matchLabels: { app: 'test' } },
    template: {
      metadata: { labels: { app: 'test' } },
      spec: { containers: [{ name: 'app', image: 'nginx:latest' }] },
    },
  },
  status: {
    replicas: 3,
    readyReplicas: 3,
    availableReplicas: 3,
    ...((overrides as { status?: Record<string, unknown> }).status ?? {}),
  },
});

/** Create a mock ConfigMap resource. */
export const createMockConfigMap = (overrides: Record<string, unknown> = {}) => ({
  ...createMockResource({ name: 'test-configmap', ...overrides }),
  data: { key: 'value' },
});

/** Create a mock Secret resource. */
export const createMockSecret = (overrides: Record<string, unknown> = {}) => ({
  ...createMockResource({ name: 'test-secret', ...overrides }),
  type: 'Opaque',
  data: { password: 'cGFzc3dvcmQ=' },
});

/** Create a mock Namespace resource. */
export const createMockNamespace = (overrides: Record<string, unknown> = {}) => ({
  ...createMockResource({ name: 'test-ns', namespace: '', ...overrides }),
  spec: { finalizers: ['kubernetes'] },
  status: { phase: 'Active' },
});

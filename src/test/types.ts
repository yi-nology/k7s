/**
 * Shared test type definitions for k7s test suite.
 *
 * Provides type-safe mock interfaces for Kubernetes resources and provider
 * methods, replacing `any` types in test files. These types are intentionally
 * more permissive than production types — they accept partial objects and
 * loose field shapes so tests can focus on the behavior under test rather
 * than constructing fully-valid Kubernetes manifests.
 *
 * Usage:
 *   import type { MockPod, MockProvider } from '../test/types';
 */

import type { EventItem, Row } from '../providers/types/table';
import type { ResourceRef } from '../providers/types/cluster';
import type { Settings } from '../lib/settings';

// ---------------------------------------------------------------------------
// Kubernetes resource base types
// ---------------------------------------------------------------------------

/**
 * Standard Kubernetes ObjectMeta fields commonly used in tests.
 * Every mock resource carries at least `name`; the rest are optional so
 * tests can supply only the fields they care about.
 */
export interface MockObjectMeta {
  name: string;
  namespace?: string;
  uid?: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

/**
 * A generic Kubernetes-style resource for tests that don't need a specific
 * kind's shape. Carries the standard metadata + freeform spec/status so
 * tests can assert on the fields they exercise without constructing a
 * full manifest.
 */
export interface MockKubeResource {
  metadata: MockObjectMeta;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pod
// ---------------------------------------------------------------------------

/** A single container inside a Pod spec. */
export interface MockContainer {
  name: string;
  image: string;
  ports?: Array<{ containerPort: number; protocol?: string }>;
}

/** Pod-specific spec fields. */
export interface MockPodSpec {
  containers: MockContainer[];
  nodeName?: string;
}

/** Pod-specific status fields. */
export interface MockPodStatus {
  phase?: string;
  conditions?: Array<{
    type: string;
    status: string;
    lastTransitionTime?: string;
  }>;
}

/** A mock Kubernetes Pod. */
export interface MockPod extends Omit<MockKubeResource, 'spec' | 'status'> {
  spec?: MockPodSpec;
  status?: MockPodStatus;
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

/** Deployment-specific spec fields. */
export interface MockDeploymentSpec {
  replicas?: number;
  selector?: { matchLabels?: Record<string, string> };
  template?: { metadata?: { labels?: Record<string, string> } };
}

/** Deployment-specific status fields. */
export interface MockDeploymentStatus {
  replicas?: number;
  readyReplicas?: number;
  availableReplicas?: number;
  updatedReplicas?: number;
}

/** A mock Kubernetes Deployment. */
export interface MockDeployment extends Omit<MockKubeResource, 'spec' | 'status'> {
  spec?: MockDeploymentSpec;
  status?: MockDeploymentStatus;
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

/**
 * A mock Kubernetes Event.
 *
 * Unlike other mock types, events have a flat structure (no nested spec/status)
 * because the real Kubernetes Event object is structured this way.
 */
export interface MockEvent {
  metadata: MockObjectMeta;
  reason: string;
  message: string;
  type: 'Normal' | 'Warning';
  firstTimestamp?: string;
  lastTimestamp?: string;
  involvedObject: {
    kind: string;
    name: string;
    namespace?: string;
  };
}

// ---------------------------------------------------------------------------
// Mock function helpers
// ---------------------------------------------------------------------------

/**
 * A type-safe wrapper around `vi.fn()`.
 *
 * Use this instead of `vi.fn()` when you need the mock to satisfy a specific
 * function signature. Example:
 *
 *   const fetchPods: MockFn<[string], Promise<Row[]>> = vi.fn();
 *
 * The generic parameters mirror the native `Function` shape:
 *   - `Args`: a tuple of the function's parameter types
 *   - `Return`: the function's return type (defaults to `void`)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MockFn<Args extends any[] = unknown[], Return = void> = (...args: Args) => Return;

// ---------------------------------------------------------------------------
// Provider mock
// ---------------------------------------------------------------------------

/**
 * A partial mock of the DataProvider for tests that only exercise a subset
 * of the provider contract. Every method is optional so tests can supply
 * only the methods they call.
 *
 * Use `as unknown as DataProvider` after constructing the mock to satisfy
 * the full interface in production code paths.
 */
export interface MockProvider {
  getPods?: MockFn<[], Promise<Row[]>>;
  getDeployments?: MockFn<[], Promise<Row[]>>;
  getEvents?: MockFn<[ResourceRef], Promise<EventItem[]>>;
  deletePod?: MockFn<[ResourceRef], Promise<void>>;
  scaleDeployment?: MockFn<[ResourceRef, number], Promise<void>>;
  getYaml?: MockFn<[ResourceRef], Promise<string>>;
  applyYaml?: MockFn<[ResourceRef, string], Promise<void>>;
  deleteResource?: MockFn<[ResourceRef], Promise<void>>;
  restartPod?: MockFn<[ResourceRef], Promise<void>>;
  restartRollout?: MockFn<[ResourceRef], Promise<void>>;
}

// ---------------------------------------------------------------------------
// Factory helpers (convenience for constructing mock objects)
// ---------------------------------------------------------------------------

/**
 * Create a MockObjectMeta with sensible defaults.
 * Supply only the fields you care about; the rest get safe defaults.
 */
export function createMockMeta(overrides: Partial<MockObjectMeta> = {}): MockObjectMeta {
  return {
    name: 'test-resource',
    namespace: 'default',
    uid: `uid-${Math.random().toString(36).slice(2, 8)}`,
    creationTimestamp: '2024-01-01T00:00:00Z',
    labels: {},
    annotations: {},
    ...overrides,
  };
}

/**
 * Create a MockKubeResource with sensible defaults.
 */
export function createMockResource(overrides: Partial<MockKubeResource> = {}): MockKubeResource {
  return {
    metadata: createMockMeta(),
    spec: {},
    status: {},
    ...overrides,
  };
}

/**
 * Create a MockPod with sensible defaults.
 */
export function createMockPod(overrides: Partial<MockPod> = {}): MockPod {
  return {
    metadata: createMockMeta({ name: 'test-pod', ...overrides.metadata }),
    spec: {
      containers: [{ name: 'app', image: 'nginx:latest' }],
      ...overrides.spec,
    },
    status: {
      phase: 'Running',
      ...overrides.status,
    },
  };
}

/**
 * Create a MockDeployment with sensible defaults.
 */
export function createMockDeployment(overrides: Partial<MockDeployment> = {}): MockDeployment {
  return {
    metadata: createMockMeta({ name: 'test-deployment', ...overrides.metadata }),
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: 'test' } },
      ...overrides.spec,
    },
    status: {
      replicas: 1,
      readyReplicas: 1,
      ...overrides.status,
    },
  };
}

/**
 * Create a MockEvent with sensible defaults.
 */
export function createMockEvent(overrides: Partial<MockEvent> = {}): MockEvent {
  return {
    metadata: createMockMeta({ name: 'test-event', ...overrides.metadata }),
    reason: 'Created',
    message: 'Created pod',
    type: 'Normal',
    firstTimestamp: '2024-01-01T00:00:00Z',
    lastTimestamp: '2024-01-01T00:00:00Z',
    involvedObject: {
      kind: 'Pod',
      name: 'test-pod',
      namespace: 'default',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Settings mock
// ---------------------------------------------------------------------------

/**
 * A partial mock of the Settings for tests that only exercise a subset
 * of the settings. Every field has a sensible default so tests can supply
 * only the fields they care about.
 */
export type MockSettings = Partial<Settings>;

/**
 * Create a mock Settings object with sensible defaults.
 * Supply only the fields you care about; the rest get safe defaults.
 */
export function createMockSettings(overrides: MockSettings = {}): Settings {
  return {
    logBufferCap: 200,
    metricsIntervalSecs: 15,
    statusIntervalSecs: 10,
    defaultNamespace: 'default',
    shellCommand: '',
    theme: 'system',
    language: 'en',
    nodeShellImage: '',
    scannerTrivyPath: '',
    scannerGrypePath: '',
    scannerTimeout: '',
    editorFontSize: 12,
    terminalFontSize: 12,
    terminalScrollback: 5000,
    detailWidthPct: 48,
    ...overrides,
  };
}

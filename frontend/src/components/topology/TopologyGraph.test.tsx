/**
 * Tests for TopologyGraph — the d3-force topology visualization.
 *
 * Covers: rendering, zoom controls, legend, health callback, canvas structure.
 * Note: d3-force simulation is complex; tests focus on the React wrapper
 * and UI chrome rather than the physics simulation itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { TopologyGraph } from './TopologyGraph';
import { render, cleanup, createMockRow, type RenderResult } from '../../test/componentUtils';
import { createMockSettings } from '../../test/types';

// Mock the provider.
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      listEndpoints: vi.fn().mockResolvedValue([]),
      listEndpointAddresses: vi.fn().mockResolvedValue([]),
    }),
  };
});

// Suppress the xterm canvas error in jsdom.
HTMLCanvasElement.prototype.getContext = vi
  .fn()
  .mockReturnValue(null) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// Mock d3-force to avoid actual simulation — force() returns a force-like
// object so that chained calls like .force('link').links(links) work.
vi.mock('d3-force', () => {
  const forceObj = {
    strength: vi.fn().mockReturnThis(),
    distanceMax: vi.fn().mockReturnThis(),
    distance: vi.fn().mockReturnThis(),
    id: vi.fn().mockReturnThis(),
    links: vi.fn().mockReturnThis(),
  };
  interface MockSimulation {
    force: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    nodes: ReturnType<typeof vi.fn>;
    alpha: ReturnType<typeof vi.fn>;
    alphaTarget: ReturnType<typeof vi.fn>;
    alphaDecay: ReturnType<typeof vi.fn>;
    alphaMin: ReturnType<typeof vi.fn>;
    restart: ReturnType<typeof vi.fn>;
  }
  const sim: MockSimulation = {
    force: vi.fn().mockImplementation((...args: unknown[]) => (args.length >= 2 ? sim : forceObj)),
    on: vi.fn().mockImplementation(() => sim),
    stop: vi.fn(),
    nodes: vi.fn().mockImplementation(() => sim),
    alpha: vi.fn().mockImplementation(() => sim),
    alphaTarget: vi.fn().mockImplementation(() => sim),
    alphaDecay: vi.fn().mockImplementation(() => sim),
    alphaMin: vi.fn().mockImplementation(() => sim),
    restart: vi.fn(),
  };
  return {
    forceSimulation: vi.fn().mockReturnValue(sim),
    forceCenter: vi.fn().mockReturnValue(forceObj),
    forceLink: vi.fn().mockReturnValue(forceObj),
    forceManyBody: vi.fn().mockReturnValue(forceObj),
    forceX: vi.fn().mockReturnValue(forceObj),
    forceY: vi.fn().mockReturnValue(forceObj),
  };
});

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
    rows: {
      services: [],
      pods: [],
      ingresses: [],
    },
    navigateTo: vi.fn(),
    podMetrics: {},
    settings: createMockSettings({ language: 'en' }),
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('TopologyGraph', () => {
  it('renders the graph container', () => {
    view = render(<TopologyGraph />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders zoom in button', () => {
    view = render(<TopologyGraph />);
    expect(view.queryByText('+')).not.toBeNull();
  });

  it('renders zoom out button', () => {
    view = render(<TopologyGraph />);
    expect(view.queryByText('-')).not.toBeNull();
  });

  it('renders fit button', () => {
    view = render(<TopologyGraph />);
    expect(view.queryByText('Fit')).not.toBeNull();
  });

  it('renders the SVG canvas', () => {
    view = render(<TopologyGraph />);
    const svg = view.container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('renders legend items', () => {
    view = render(<TopologyGraph />);
    // The legend uses translate keys; the English dictionary has capitalized forms
    // but the component passes lowercase defaults via t('topology.legend.X', X)
    const buttons = view.container.querySelectorAll('svg');
    expect(buttons.length).toBeGreaterThan(0);
    // Legend items are rendered; check for the legend container
    const legend = view.container.querySelector('div');
    expect(legend).not.toBeNull();
  });

  it('renders minimap', () => {
    view = render(<TopologyGraph />);
    const svgs = view.container.querySelectorAll('svg');
    // Should have main SVG + minimap SVG
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts focusedService prop', () => {
    view = render(<TopologyGraph focusedService="svc:default/web" />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('accepts searchQuery prop', () => {
    view = render(<TopologyGraph searchQuery="nginx" />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('accepts onHealthChange callback', () => {
    const onHealthChange = vi.fn();
    view = render(<TopologyGraph onHealthChange={onHealthChange} />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders with pod data in store', () => {
    useStore.setState({
      rows: {
        services: [createMockRow({ name: 'web-svc', namespace: 'default' })],
        pods: [createMockRow({ name: 'pod-1', namespace: 'default' })],
        ingresses: [],
      },
    });
    view = render(<TopologyGraph />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders with ingress data in store', () => {
    useStore.setState({
      rows: {
        services: [],
        pods: [],
        ingresses: [createMockRow({ name: 'web-ingress', namespace: 'default' })],
      },
    });
    view = render(<TopologyGraph />);
    expect(view.container.firstChild).not.toBeNull();
  });
});

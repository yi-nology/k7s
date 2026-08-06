/**
 * Tests for TopologyPanel — the service topology panel with sidebar and graph.
 *
 * Covers: rendering, header, close button, health bar, search box, service list,
 * empty state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { TopologyPanel } from './TopologyPanel';
import { render, cleanup, createMockRow, type RenderResult } from '../../test/componentUtils';
import { createMockSettings } from '../../test/types';

// Mock the provider — use a stable mock so we can override per-test.
const mockListEndpoints = vi.fn().mockResolvedValue([
  {
    name: 'ep-1',
    namespace: 'default',
    service: 'web-svc',
    ready: 2,
    total: 2,
    addresses: [],
    age: '1d',
  },
  {
    name: 'ep-2',
    namespace: 'default',
    service: 'api-svc',
    ready: 1,
    total: 1,
    addresses: [],
    age: '2d',
  },
]);
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      listEndpoints: mockListEndpoints,
      listEndpointAddresses: vi.fn().mockResolvedValue([]),
    }),
  };
});

// Mock TopologyGraph to avoid d3-force complexity.
vi.mock('./TopologyGraph', () => ({
  TopologyGraph: ({
    focusedService,
    searchQuery,
  }: {
    focusedService?: string;
    searchQuery?: string;
  }) => (
    <div data-testid="topology-graph">
      <span>MockGraph</span>
      {focusedService && <span>focused: {focusedService}</span>}
      {searchQuery && <span>search: {searchQuery}</span>}
    </div>
  ),
}));

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
    rows: {
      services: [
        createMockRow({ name: 'web-svc', namespace: 'default' }),
        createMockRow({ name: 'api-svc', namespace: 'default' }),
      ],
      pods: [],
    },
    settings: createMockSettings({ language: 'en' }),
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('TopologyPanel', () => {
  it('renders the panel', async () => {
    view = render(<TopologyPanel />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders the title', () => {
    view = render(<TopologyPanel />);
    expect(view.queryByText('Service Topology')).not.toBeNull();
  });

  it('renders close button when onClose is provided', () => {
    view = render(<TopologyPanel onClose={vi.fn()} />);
    expect(view.queryByText('Close')).not.toBeNull();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    view = render(<TopologyPanel onClose={onClose} />);
    const closeBtn = view.queryByText('Close');
    if (closeBtn) view.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders health bar with total count', () => {
    view = render(<TopologyPanel />);
    expect(view.queryByText('Total')).not.toBeNull();
  });

  it('renders health bar with healthy count', () => {
    view = render(<TopologyPanel />);
    expect(view.queryByText('Healthy')).not.toBeNull();
  });

  it('renders health bar with unhealthy count', () => {
    view = render(<TopologyPanel />);
    expect(view.queryByText('Unhealthy')).not.toBeNull();
  });

  it('renders health bar with unknown count', () => {
    view = render(<TopologyPanel />);
    expect(view.queryByText('Unknown')).not.toBeNull();
  });

  it('renders search input', () => {
    view = render(<TopologyPanel />);
    const input = view.container.querySelector('input');
    expect(input).not.toBeNull();
  });

  it('renders service list after loading', async () => {
    view = render(<TopologyPanel />);
    await new Promise((r) => setTimeout(r, 100));
    expect(view.queryByText('web-svc')).not.toBeNull();
    expect(view.queryByText('api-svc')).not.toBeNull();
  });

  it('renders the mock graph', () => {
    view = render(<TopologyPanel />);
    expect(view.queryByText('MockGraph')).not.toBeNull();
  });

  it('renders the Service column header', () => {
    view = render(<TopologyPanel />);
    expect(view.queryByText('Service')).not.toBeNull();
  });

  it('shows empty state when no endpoints and no services', async () => {
    mockListEndpoints.mockResolvedValueOnce([]);
    useStore.setState({ rows: { services: [], pods: [] } });
    view = render(<TopologyPanel />);
    await new Promise((r) => setTimeout(r, 200));
    expect(view.queryByText('No services with endpoints')).not.toBeNull();
  });
});

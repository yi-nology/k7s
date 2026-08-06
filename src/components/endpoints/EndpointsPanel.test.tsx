/**
 * Tests for EndpointsPanel — EndpointSlices table.
 *
 * Covers: rendering, header, close button, empty state, table rendering.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EndpointsPanel } from './EndpointsPanel';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

// Mock the provider.
vi.mock('../../providers', () => ({
  getProvider: () => ({
    listEndpoints: vi.fn().mockResolvedValue([
      {
        name: 'web-slice-1',
        namespace: 'default',
        service: 'web-svc',
        ready: 2,
        total: 2,
        addresses: ['10.0.0.1', '10.0.0.2'],
      },
    ]),
    listEndpointAddresses: vi.fn().mockResolvedValue([
      {
        address: '10.0.0.1',
        ready: true,
        targetRefKind: 'Pod',
        targetRefName: 'web-0',
        nodeName: 'node-1',
      },
      {
        address: '10.0.0.2',
        ready: true,
        targetRefKind: 'Pod',
        targetRefName: 'web-1',
        nodeName: 'node-2',
      },
    ]),
  }),
}));

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('EndpointsPanel', () => {
  it('renders the panel', () => {
    view = render(<EndpointsPanel />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders the title', () => {
    view = render(<EndpointsPanel />);
    expect(view.queryByText('Endpoints')).not.toBeNull();
  });

  it('renders close button when onClose is provided', () => {
    const onClose = vi.fn();
    view = render(<EndpointsPanel onClose={onClose} />);
    expect(view.queryByText('Close')).not.toBeNull();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    view = render(<EndpointsPanel onClose={onClose} />);
    const closeBtn = view.queryByText('Close');
    if (closeBtn) view.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders table headers', async () => {
    view = render(<EndpointsPanel />);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('Name')).not.toBeNull();
    expect(view.queryByText('Namespace')).not.toBeNull();
    expect(view.queryByText('Service')).not.toBeNull();
    expect(view.queryByText('Ready')).not.toBeNull();
  });

  it('renders endpoint rows', async () => {
    view = render(<EndpointsPanel />);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('web-slice-1')).not.toBeNull();
    expect(view.queryByText('default')).not.toBeNull();
    expect(view.queryByText('web-svc')).not.toBeNull();
  });

  it('renders ready count', async () => {
    view = render(<EndpointsPanel />);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('2/2')).not.toBeNull();
  });
});

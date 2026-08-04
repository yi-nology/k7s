/**
 * Tests for IngressRouteTopology — the ingress-to-service routing diagram.
 *
 * Covers: rendering, empty state, ingress/service nodes, route edges,
 * close button, legend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { IngressRouteTopology } from './IngressRouteTopology';
import { render, cleanup, createMockRow, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
    rows: {
      ingresses: [],
      services: [],
    } as any,
    settings: { language: 'en' } as any,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('IngressRouteTopology', () => {
  it('renders the panel', () => {
    view = render(<IngressRouteTopology />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders the title', () => {
    view = render(<IngressRouteTopology />);
    expect(view.queryByText('Ingress Route Topology')).not.toBeNull();
  });

  it('renders close button when onClose is provided', () => {
    view = render(<IngressRouteTopology onClose={vi.fn()} />);
    expect(view.queryByText('Close')).not.toBeNull();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    view = render(<IngressRouteTopology onClose={onClose} />);
    const closeBtn = view.queryByText('Close');
    if (closeBtn) view.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows empty state when no ingresses or services', () => {
    view = render(<IngressRouteTopology />);
    expect(view.queryByText('No ingresses or services found')).not.toBeNull();
  });

  it('renders SVG when data is present', () => {
    useStore.setState({
      rows: {
        ingresses: [
          createMockRow({
            name: 'web-ingress',
            namespace: 'default',
            cells: [
              { text: 'web-ingress', tone: 'primary' },
              { text: 'default', tone: 'muted' },
              { text: 'web.example.com', tone: 'primary' },
              { text: 'nginx', tone: 'primary' },
            ],
          }),
        ],
        services: [
          createMockRow({
            name: 'web-ingress',
            namespace: 'default',
            cells: [
              { text: 'ClusterIP', tone: 'primary' },
              { text: '10.0.0.1', tone: 'primary' },
              { text: '80/TCP', tone: 'primary' },
            ],
          }),
        ],
      } as any,
    });
    view = render(<IngressRouteTopology />);
    const svg = view.container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('renders ingress column header', () => {
    useStore.setState({
      rows: {
        ingresses: [
          createMockRow({
            name: 'web-ingress',
            namespace: 'default',
            cells: [
              { text: 'web-ingress', tone: 'primary' },
              { text: 'default', tone: 'muted' },
              { text: 'web.example.com', tone: 'primary' },
              { text: 'nginx', tone: 'primary' },
            ],
          }),
        ],
        services: [
          createMockRow({
            name: 'web-ingress',
            namespace: 'default',
            cells: [
              { text: 'ClusterIP', tone: 'primary' },
              { text: '10.0.0.1', tone: 'primary' },
              { text: '80/TCP', tone: 'primary' },
            ],
          }),
        ],
      } as any,
    });
    view = render(<IngressRouteTopology />);
    expect(view.queryByText('INGRESS')).not.toBeNull();
  });

  it('renders service column header', () => {
    useStore.setState({
      rows: {
        ingresses: [
          createMockRow({
            name: 'web-ingress',
            namespace: 'default',
            cells: [
              { text: 'web-ingress', tone: 'primary' },
              { text: 'default', tone: 'muted' },
              { text: 'web.example.com', tone: 'primary' },
              { text: 'nginx', tone: 'primary' },
            ],
          }),
        ],
        services: [
          createMockRow({
            name: 'web-ingress',
            namespace: 'default',
            cells: [
              { text: 'ClusterIP', tone: 'primary' },
              { text: '10.0.0.1', tone: 'primary' },
              { text: '80/TCP', tone: 'primary' },
            ],
          }),
        ],
      } as any,
    });
    view = render(<IngressRouteTopology />);
    expect(view.queryByText('SERVICE')).not.toBeNull();
  });

  it('renders TLS legend when data is present', () => {
    useStore.setState({
      rows: {
        ingresses: [
          createMockRow({
            name: 'web-ingress',
            namespace: 'default',
            cells: [
              { text: 'web-ingress', tone: 'primary' },
              { text: 'default', tone: 'muted' },
              { text: 'web.example.com', tone: 'primary' },
              { text: 'nginx', tone: 'primary' },
            ],
          }),
        ],
        services: [
          createMockRow({
            name: 'web-ingress',
            namespace: 'default',
            cells: [
              { text: 'ClusterIP', tone: 'primary' },
              { text: '10.0.0.1', tone: 'primary' },
              { text: '80/TCP', tone: 'primary' },
            ],
          }),
        ],
      } as any,
    });
    view = render(<IngressRouteTopology />);
    expect(view.queryByText('TLS')).not.toBeNull();
  });

  it('renders no-TLS legend when data is present', () => {
    useStore.setState({
      rows: {
        ingresses: [
          createMockRow({
            name: 'web-ingress',
            namespace: 'default',
            cells: [
              { text: 'web-ingress', tone: 'primary' },
              { text: 'default', tone: 'muted' },
              { text: 'web.example.com', tone: 'primary' },
              { text: 'nginx', tone: 'primary' },
            ],
          }),
        ],
        services: [
          createMockRow({
            name: 'web-ingress',
            namespace: 'default',
            cells: [
              { text: 'ClusterIP', tone: 'primary' },
              { text: '10.0.0.1', tone: 'primary' },
              { text: '80/TCP', tone: 'primary' },
            ],
          }),
        ],
      } as any,
    });
    view = render(<IngressRouteTopology />);
    expect(view.queryByText('No TLS')).not.toBeNull();
  });

  it('matches ingress to service by name', () => {
    useStore.setState({
      rows: {
        ingresses: [
          createMockRow({
            name: 'my-app',
            namespace: 'default',
            cells: [
              { text: 'my-app', tone: 'primary' },
              { text: 'default', tone: 'muted' },
              { text: 'my-app.example.com', tone: 'primary' },
              { text: 'nginx', tone: 'primary' },
            ],
          }),
        ],
        services: [
          createMockRow({
            name: 'my-app',
            namespace: 'default',
            cells: [
              { text: 'ClusterIP', tone: 'primary' },
              { text: '10.0.0.1', tone: 'primary' },
              { text: '80/TCP', tone: 'primary' },
            ],
          }),
        ],
      } as any,
    });
    view = render(<IngressRouteTopology />);
    // Both ingress and service names should appear
    expect(view.queryByText('my-app')).not.toBeNull();
  });
});

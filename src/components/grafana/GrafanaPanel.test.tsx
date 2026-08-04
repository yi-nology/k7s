/**
 * Tests for GrafanaPanel — Grafana instance management and dashboard embedding.
 *
 * Covers: rendering, header, close button, instance list, add form, presets.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GrafanaPanel } from './GrafanaPanel';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

// Mock the provider.
vi.mock('../../providers', () => ({
  getProvider: () => ({
    grafanaList: vi.fn().mockResolvedValue([
      { name: 'grafana-main', url: 'https://grafana.example.com', defaultDatasource: 'Prometheus' },
    ]),
    grafanaPresets: vi.fn().mockResolvedValue([
      { uid: 'k8s-resources', title: 'K8s Resources', description: 'Cluster resource usage' },
    ]),
    grafanaDashboardUrl: vi.fn().mockResolvedValue('https://grafana.example.com/d/k8s-resources'),
    grafanaUpsert: vi.fn().mockResolvedValue(undefined),
    grafanaTest: vi.fn().mockResolvedValue(undefined),
    grafanaRemove: vi.fn().mockResolvedValue(undefined),
    grafanaSearchDashboards: vi.fn().mockResolvedValue([]),
  }),
}));

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('GrafanaPanel', () => {
  it('renders the panel', () => {
    view = render(<GrafanaPanel />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders the title', () => {
    view = render(<GrafanaPanel />);
    expect(view.queryByText('Grafana')).not.toBeNull();
  });

  it('renders close button when onClose is provided', () => {
    const onClose = vi.fn();
    view = render(<GrafanaPanel onClose={onClose} />);
    expect(view.queryByText('Close')).not.toBeNull();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    view = render(<GrafanaPanel onClose={onClose} />);
    const closeBtn = view.queryByText('Close');
    if (closeBtn) view.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders the add instance button', () => {
    view = render(<GrafanaPanel />);
    expect(view.queryByText('Add instance')).not.toBeNull();
  });

  it('shows add form when add button is clicked', () => {
    view = render(<GrafanaPanel />);
    const addBtn = view.queryByText('Add instance');
    if (addBtn) view.click(addBtn);
    expect(view.queryByText('Grafana instance')).not.toBeNull();
    expect(view.queryByText('Save')).not.toBeNull();
    expect(view.queryByText('Cancel')).not.toBeNull();
  });

  it('hides add form when cancel is clicked', () => {
    view = render(<GrafanaPanel />);
    const addBtn = view.queryByText('Add instance');
    if (addBtn) view.click(addBtn);
    const cancelBtn = view.queryByText('Cancel');
    if (cancelBtn) view.click(cancelBtn);
    expect(view.queryByText('Add instance')).not.toBeNull();
  });

  it('renders instance list', async () => {
    view = render(<GrafanaPanel />);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('grafana-main')).not.toBeNull();
  });

  it('renders preset dashboards section', async () => {
    view = render(<GrafanaPanel />);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('Preset dashboards')).not.toBeNull();
  });

  it('renders range presets', async () => {
    view = render(<GrafanaPanel />);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('Last 1h')).not.toBeNull();
    expect(view.queryByText('Last 6h')).not.toBeNull();
    expect(view.queryByText('Last 24h')).not.toBeNull();
    expect(view.queryByText('Last 7d')).not.toBeNull();
  });

  it('renders preset items', async () => {
    view = render(<GrafanaPanel />);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('K8s Resources')).not.toBeNull();
  });
});

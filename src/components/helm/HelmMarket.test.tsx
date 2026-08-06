/**
 * Tests for HelmMarket — the chart marketplace panel.
 *
 * Covers: rendering, tabs, search, chart list, repo list, close button.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { HelmMarket } from './HelmMarket';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import { createMockSettings } from '../../test/types';

// Mock the provider.
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      helmListRepos: vi
        .fn()
        .mockResolvedValue([
          { name: 'bitnami', url: 'https://charts.bitnami.com', lastRefreshed: '2024-01-01' },
        ]),
      helmSearchCharts: vi.fn().mockResolvedValue([
        {
          name: 'nginx',
          repo: 'bitnami',
          version: '1.0.0',
          appVersion: '1.25',
          description: 'NGINX web server',
        },
        {
          name: 'redis',
          repo: 'bitnami',
          version: '18.0.0',
          appVersion: '7.0',
          description: 'Redis cache',
        },
      ]),
      helmUpdateAllRepos: vi.fn().mockResolvedValue(undefined),
      helmUpdateRepo: vi.fn().mockResolvedValue(undefined),
      helmRemoveRepo: vi.fn().mockResolvedValue(undefined),
      helmAddRepo: vi.fn().mockResolvedValue(undefined),
      helmChartVersions: vi
        .fn()
        .mockResolvedValue([{ version: '1.0.0', appVersion: '1.25', created: '', urls: [] }]),
      helmRenderDefaultValues: vi.fn().mockResolvedValue('# default values'),
      helmRunOp: vi.fn().mockResolvedValue({ success: true }),
      onHelmOpLog: vi.fn().mockReturnValue(() => {}),
      onHelmOpDone: vi.fn().mockReturnValue(() => {}),
    }),
  };
});

let view: RenderResult;

function resetStore() {
  useStore.setState({
    settings: createMockSettings({ language: 'en' }),
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('HelmMarket', () => {
  it('renders the panel', () => {
    view = render(<HelmMarket />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders the title when onClose is provided', () => {
    view = render(<HelmMarket onClose={vi.fn()} />);
    expect(view.queryByText('Helm Market')).not.toBeNull();
  });

  it('renders the Charts tab', () => {
    view = render(<HelmMarket />);
    expect(view.queryByText('Charts')).not.toBeNull();
  });

  it('renders the Repositories tab', () => {
    view = render(<HelmMarket />);
    expect(view.queryByText(/Repositories/)).not.toBeNull();
  });

  it('renders search input in charts tab', () => {
    view = render(<HelmMarket />);
    const input = view.container.querySelector('input');
    expect(input).not.toBeNull();
  });

  it('renders chart list after loading', async () => {
    view = render(<HelmMarket />);
    await new Promise((r) => setTimeout(r, 100));
    expect(view.queryByText('nginx')).not.toBeNull();
    expect(view.queryByText('redis')).not.toBeNull();
  });

  it('renders chart descriptions', async () => {
    view = render(<HelmMarket />);
    await new Promise((r) => setTimeout(r, 100));
    expect(view.queryByText('NGINX web server')).not.toBeNull();
  });

  it('renders chart versions', async () => {
    view = render(<HelmMarket />);
    await new Promise((r) => setTimeout(r, 100));
    expect(view.queryByText(/v1\.0\.0/)).not.toBeNull();
  });

  it('switches to repos tab', async () => {
    view = render(<HelmMarket />);
    const reposTab = view.queryByText(/Repositories/);
    if (reposTab) view.click(reposTab);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('bitnami')).not.toBeNull();
  });

  it('renders close button when onClose is provided', () => {
    const onClose = vi.fn();
    view = render(<HelmMarket onClose={onClose} />);
    expect(view.queryByText('Close')).not.toBeNull();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    view = render(<HelmMarket onClose={onClose} />);
    const closeBtn = view.queryByText('Close');
    if (closeBtn) view.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows repo count badge', async () => {
    view = render(<HelmMarket />);
    await new Promise((r) => setTimeout(r, 100));
    expect(view.queryByText(/\(1\)/)).not.toBeNull();
  });

  it('renders the pick chart hint when no chart is selected', async () => {
    view = render(<HelmMarket />);
    await new Promise((r) => setTimeout(r, 100));
    expect(view.queryByText('Pick a chart on the left to install')).not.toBeNull();
  });
});

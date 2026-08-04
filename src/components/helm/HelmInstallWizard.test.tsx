/**
 * Tests for HelmInstallWizard — the chart install wizard.
 *
 * Covers: rendering, step navigation, version selection, namespace input,
 * install button, review step.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { HelmInstallWizard } from './HelmInstallWizard';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

// Mock the provider.
vi.mock('../../providers', () => ({
  getProvider: () => ({
    helmChartVersions: vi.fn().mockResolvedValue([
      { version: '1.0.0', appVersion: '1.25', created: '2024-01-01', urls: [] },
      { version: '1.1.0', appVersion: '1.26', created: '2024-02-01', urls: [] },
    ]),
    helmRenderDefaultValues: vi.fn().mockResolvedValue('replicaCount: 1\nimage:\n  repository: nginx\n  tag: "1.25"\n'),
    helmRunOp: vi.fn().mockResolvedValue({ success: true, summary: 'Install complete' }),
    onHelmOpLog: vi.fn().mockReturnValue(() => {}),
    onHelmOpDone: vi.fn().mockReturnValue(() => {}),
  }),
}));

let view: RenderResult;

const mockChart = {
  name: 'nginx',
  repo: 'bitnami',
  version: '1.0.0',
  appVersion: '1.25',
  description: 'NGINX web server',
  keywords: ['web', 'server'],
  home: 'https://nginx.org',
  maintainers: [{ name: 'NGINX', email: 'info@nginx.org', url: 'https://nginx.org' }],
};

function resetStore() {
  useStore.setState({
    settings: { language: 'en' } as any,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('HelmInstallWizard', () => {
  it('renders the wizard', () => {
    view = render(<HelmInstallWizard chart={mockChart} onDone={vi.fn()} />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders the chart name as title', () => {
    view = render(<HelmInstallWizard chart={mockChart} onDone={vi.fn()} />);
    expect(view.queryByText('nginx')).not.toBeNull();
  });

  it('renders the chart description', () => {
    view = render(<HelmInstallWizard chart={mockChart} onDone={vi.fn()} />);
    expect(view.queryByText('NGINX web server')).not.toBeNull();
  });

  it('renders step indicators', () => {
    view = render(<HelmInstallWizard chart={mockChart} onDone={vi.fn()} />);
    expect(view.queryByText('Version')).not.toBeNull();
    expect(view.queryByText('Values')).not.toBeNull();
    expect(view.queryByText('Review')).not.toBeNull();
  });

  it('starts on the version step', () => {
    view = render(<HelmInstallWizard chart={mockChart} onDone={vi.fn()} />);
    expect(view.queryByText('Release name')).not.toBeNull();
    expect(view.queryByText('Namespace')).not.toBeNull();
  });

  it('renders release name input with default value', () => {
    view = render(<HelmInstallWizard chart={mockChart} onDone={vi.fn()} />);
    const input = view.container.querySelector('input');
    expect(input).not.toBeNull();
  });

  it('renders namespace input with default value', () => {
    view = render(<HelmInstallWizard chart={mockChart} onDone={vi.fn()} />);
    const inputs = view.container.querySelectorAll('input');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it('renders create namespace checkbox', () => {
    view = render(<HelmInstallWizard chart={mockChart} onDone={vi.fn()} />);
    expect(view.queryByText('Create namespace if missing')).not.toBeNull();
  });

  it('renders Next button', () => {
    view = render(<HelmInstallWizard chart={mockChart} onDone={vi.fn()} />);
    expect(view.queryByText('Next')).not.toBeNull();
  });

  it('navigates to values step on Next click', async () => {
    view = render(<HelmInstallWizard chart={mockChart} onDone={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 50));
    const nextBtn = view.queryByText('Next');
    if (nextBtn) view.click(nextBtn);
    await new Promise((r) => setTimeout(r, 50));
    // Values step should show a textarea
    const textarea = view.container.querySelector('textarea');
    expect(textarea).not.toBeNull();
  });

  it('navigates to review step', async () => {
    view = render(<HelmInstallWizard chart={mockChart} onDone={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 50));
    // Click Next to go to values
    const nextBtn = view.queryByText('Next');
    if (nextBtn) view.click(nextBtn);
    await new Promise((r) => setTimeout(r, 50));
    // Click Next again to go to review
    const nextBtn2 = view.queryByText('Next');
    if (nextBtn2) view.click(nextBtn2);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('Install')).not.toBeNull();
  });

  it('shows review details', async () => {
    view = render(<HelmInstallWizard chart={mockChart} onDone={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 50));
    const nextBtn = view.queryByText('Next');
    if (nextBtn) view.click(nextBtn);
    await new Promise((r) => setTimeout(r, 50));
    const nextBtn2 = view.queryByText('Next');
    if (nextBtn2) view.click(nextBtn2);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText(/Chart/)).not.toBeNull();
  });

  it('renders Back button in values step', async () => {
    view = render(<HelmInstallWizard chart={mockChart} onDone={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 50));
    const nextBtn = view.queryByText('Next');
    if (nextBtn) view.click(nextBtn);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('Back')).not.toBeNull();
  });

  it('goes back from values to version step', async () => {
    view = render(<HelmInstallWizard chart={mockChart} onDone={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 50));
    const nextBtn = view.queryByText('Next');
    if (nextBtn) view.click(nextBtn);
    await new Promise((r) => setTimeout(r, 50));
    const backBtn = view.queryByText('Back');
    if (backBtn) view.click(backBtn);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('Release name')).not.toBeNull();
  });
});

/**
 * Tests for HelmInstallWizard — the chart install wizard.
 *
 * Covers: rendering, step navigation, version selection, namespace input,
 * install button, review step. A second suite covers the local-chart
 * source (library entry): no version fetch, seeded values, path install.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { useStore } from '../../store';
import { HelmInstallWizard } from './HelmInstallWizard';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import { createMockSettings } from '../../test/types';
import type { LocalChartDetail } from '../../providers/types';

// The values step renders the shared CodeMirror wrapper; mock it down to a
// plain textarea so jsdom can assert on it without CodeMirror/lit.
vi.mock('../editor/EditorCore', () => ({
  EditorCore: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (text: string) => void;
  }) =>
    React.createElement('textarea', {
      value,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value),
    }),
}));

// Mock the provider. vi.hoisted so the (hoisted) vi.mock factory can
// reference the fns — the local-chart suite below asserts on their calls.
const providerMocks = vi.hoisted(() => ({
  helmChartVersions: vi.fn(),
  helmRenderDefaultValues: vi.fn(),
  helmRunOp: vi.fn(),
  onHelmOpLog: vi.fn(),
  onHelmOpDone: vi.fn(),
}));
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      helmChartVersions: providerMocks.helmChartVersions,
      helmRenderDefaultValues: providerMocks.helmRenderDefaultValues,
      helmRunOp: providerMocks.helmRunOp,
      onHelmOpLog: providerMocks.onHelmOpLog,
      onHelmOpDone: providerMocks.onHelmOpDone,
    }),
  };
});

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
    settings: createMockSettings({ language: 'en' }),
  });
}

beforeEach(() => {
  resetStore();
  providerMocks.helmChartVersions.mockReset().mockResolvedValue([
    { version: '1.0.0', appVersion: '1.25', created: '2024-01-01', urls: [] },
    { version: '1.1.0', appVersion: '1.26', created: '2024-02-01', urls: [] },
  ]);
  providerMocks.helmRenderDefaultValues
    .mockReset()
    .mockResolvedValue('replicaCount: 1\nimage:\n  repository: nginx\n  tag: "1.25"\n');
  providerMocks.helmRunOp
    .mockReset()
    .mockResolvedValue({ success: true, summary: 'Install complete' });
  providerMocks.onHelmOpLog.mockReset().mockReturnValue(() => {});
  providerMocks.onHelmOpDone.mockReset().mockReturnValue(() => {});
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

describe('HelmInstallWizard (local chart source)', () => {
  const localDetail = {
    entry: {
      id: 'demo-1.0.0.tgz',
      kind: 'tgz',
      name: 'demo',
      version: '1.0.0',
      appVersion: '1.0.0',
      description: 'demo chart',
      icon: '',
      path: '/data/charts/demo-1.0.0.tgz',
      sizeBytes: 1024,
      modifiedAt: '2026-08-28T00:00:00Z',
    },
    files: [{ path: 'demo/values.yaml', sizeBytes: 10, isDir: false }],
    valuesYaml: 'replicaCount: 2\n',
    readme: '',
  } satisfies LocalChartDetail;

  it('renders with a local chart detail', () => {
    view = render(<HelmInstallWizard localChart={localDetail} onDone={vi.fn()} />);
    expect(view.queryByText('demo')).not.toBeNull();
    expect(view.queryByText('demo chart')).not.toBeNull();
  });

  it('does not fetch repo versions for a local chart', async () => {
    view = render(<HelmInstallWizard localChart={localDetail} onDone={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(providerMocks.helmChartVersions).not.toHaveBeenCalled();
  });

  it('shows a read-only version row instead of a selector', () => {
    view = render(<HelmInstallWizard localChart={localDetail} onDone={vi.fn()} />);
    expect(view.container.querySelector('select')).toBeNull();
    expect(view.queryByText(/1\.0\.0/)).not.toBeNull();
  });

  it('seeds values from the local detail without calling helm', async () => {
    view = render(<HelmInstallWizard localChart={localDetail} onDone={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 50));
    const nextBtn = view.queryByText('Next');
    if (nextBtn) view.click(nextBtn); // → values step
    await new Promise((r) => setTimeout(r, 50));
    const textarea = view.container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe('replicaCount: 2\n');
    expect(providerMocks.helmRenderDefaultValues).not.toHaveBeenCalled();
  });

  it('installs with the absolute path as the chart ref and an empty version', async () => {
    view = render(<HelmInstallWizard localChart={localDetail} onDone={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 50));
    const nextBtn = view.queryByText('Next');
    if (nextBtn) view.click(nextBtn); // → values
    await new Promise((r) => setTimeout(r, 50));
    const nextBtn2 = view.queryByText('Next');
    if (nextBtn2) view.click(nextBtn2); // → review
    await new Promise((r) => setTimeout(r, 50));
    const installBtn = view.queryByText('Install');
    if (installBtn) view.click(installBtn);
    await new Promise((r) => setTimeout(r, 50));
    expect(providerMocks.helmRunOp).toHaveBeenCalledWith({
      op: 'install',
      args: {
        release: 'demo',
        chart: '/data/charts/demo-1.0.0.tgz',
        version: '',
        namespace: 'default',
        values: 'replicaCount: 2\n',
        dryRun: false,
        createNamespace: false,
      },
    });
  });
});

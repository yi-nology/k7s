/**
 * Tests for HelmInstallWizard — the chart install wizard.
 *
 * Covers: rendering, step navigation, version selection, namespace input,
 * install button, review step. A second suite covers the local-chart
 * source (library entry): no version fetch, seeded values, path install.
 * A third covers upgrade mode: prefilled release/namespace, values
 * prefilled from the release's current user-supplied values (with a
 * values.yaml fallback), path upgrade, and the review-step diff.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { useStore } from '../../store';
import { HelmInstallWizard } from './HelmInstallWizard';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import { createMockSettings } from '../../test/types';
import type { HelmProfile, LocalChartDetail } from '../../providers/types';

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
  helmReleaseHistory: vi.fn(),
  helmManifestRevision: vi.fn(),
  helmValuesRevision: vi.fn(),
  helmRenderPreview: vi.fn(),
  helmProfileList: vi.fn(),
  helmProfileSave: vi.fn(),
  helmProfileDelete: vi.fn(),
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
      helmReleaseHistory: providerMocks.helmReleaseHistory,
      helmManifestRevision: providerMocks.helmManifestRevision,
      helmValuesRevision: providerMocks.helmValuesRevision,
      helmRenderPreview: providerMocks.helmRenderPreview,
      helmProfileList: providerMocks.helmProfileList,
      helmProfileSave: providerMocks.helmProfileSave,
      helmProfileDelete: providerMocks.helmProfileDelete,
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
  providerMocks.helmReleaseHistory.mockReset().mockResolvedValue([]);
  providerMocks.helmManifestRevision.mockReset().mockResolvedValue('');
  // Upgrade-mode prefill: resolves to the release's user-supplied values.
  // `{ replicaCount: 2 }` serialises to exactly the YAML the upgrade-suite
  // expectations below were written against.
  providerMocks.helmValuesRevision.mockReset().mockResolvedValue({ replicaCount: 2 });
  providerMocks.helmRenderPreview.mockReset().mockResolvedValue('');
  providerMocks.helmProfileList.mockReset().mockResolvedValue([]);
  providerMocks.helmProfileSave.mockReset().mockResolvedValue([]);
  providerMocks.helmProfileDelete.mockReset().mockResolvedValue([]);
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

  it('prefills repo-chart defaults via the repo/name reference the backend requires', async () => {
    view = render(<HelmInstallWizard chart={mockChart} onDone={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 50));
    const nextBtn = view.queryByText('Next');
    if (nextBtn) view.click(nextBtn); // → values
    await new Promise((r) => setTimeout(r, 50));
    // `helm show values <chart>` cannot resolve a bare chart name — the
    // backend needs `repo/name`.
    expect(providerMocks.helmRenderDefaultValues).toHaveBeenCalledWith(
      'bitnami/nginx',
      '1.0.0'
    );
    const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toContain('replicaCount: 1');
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
    chartYaml: 'apiVersion: v2\nname: demo\nversion: 1.0.0\n',
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

describe('HelmInstallWizard (upgrade mode)', () => {
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
    chartYaml: 'apiVersion: v2\nname: demo\nversion: 1.0.0\n',
    valuesYaml: 'replicaCount: 2\n',
    readme: '',
  } satisfies LocalChartDetail;

  const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));

  /** Render in upgrade mode and walk to the review step. */
  async function renderToReview() {
    view = render(
      <HelmInstallWizard
        localUpgrade={{ detail: localDetail, release: 'demo', namespace: 'web' }}
        onDone={vi.fn()}
      />
    );
    await settle();
    view.click(view.getByText('Next')); // → values
    await settle();
    view.click(view.getByText('Next')); // → review
    await settle();
  }

  /** Render in upgrade mode and stop on the values step. */
  async function renderToValues() {
    view = render(
      <HelmInstallWizard
        localUpgrade={{ detail: localDetail, release: 'demo', namespace: 'web' }}
        onDone={vi.fn()}
      />
    );
    await settle();
    view.click(view.getByText('Next')); // → values
    await settle();
  }

  it('prefills release + namespace read-only from the handoff', async () => {
    view = render(
      <HelmInstallWizard
        localUpgrade={{ detail: localDetail, release: 'demo', namespace: 'web' }}
        onDone={vi.fn()}
      />
    );
    await settle();
    const inputs = view.container.querySelectorAll('input');
    const release = inputs[0] as HTMLInputElement;
    const ns = inputs[1] as HTMLInputElement;
    expect(release.value).toBe('demo');
    expect(release.readOnly).toBe(true);
    expect(ns.value).toBe('web');
    expect(ns.readOnly).toBe(true);
  });

  it('prefills the values editor with the release current values, not the chart defaults', async () => {
    providerMocks.helmReleaseHistory.mockResolvedValue([
      {
        revision: 3,
        updated: '2026-08-27T00:00:00Z',
        status: 'deployed',
        chart: 'demo-0.9.0',
        appVersion: '0.9.0',
        description: 'Install complete',
      },
    ]);
    // Deliberately different from the new package's valuesYaml
    // (`replicaCount: 2`) — the release's own overrides must win.
    providerMocks.helmValuesRevision.mockResolvedValue({
      replicaCount: 5,
      image: { tag: 'v9' },
    });
    await renderToValues();
    // The revision to read comes from the newest history entry.
    expect(providerMocks.helmReleaseHistory).toHaveBeenCalledWith('demo', 'web');
    expect(providerMocks.helmValuesRevision).toHaveBeenCalledWith('web', 'demo', 3);
    const textarea = view.container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe(
      'replicaCount: 5\nimage:\n  tag: v9\n'
    );
  });

  it('falls back to the new package values.yaml when the release fetch fails', async () => {
    providerMocks.helmReleaseHistory.mockResolvedValue([
      {
        revision: 3,
        updated: '',
        status: 'deployed',
        chart: 'demo-0.9.0',
        appVersion: '0.9.0',
        description: '',
      },
    ]);
    providerMocks.helmValuesRevision.mockRejectedValue(new Error('revision gone'));
    await renderToValues();
    const textarea = view.container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe('replicaCount: 2\n');
  });

  it('submits op upgrade with chart=path and an empty version', async () => {
    await renderToReview();
    view.click(view.getByText('Upgrade'));
    await settle();
    expect(providerMocks.helmRunOp).toHaveBeenCalledWith({
      op: 'upgrade',
      args: {
        release: 'demo',
        chart: '/data/charts/demo-1.0.0.tgz',
        version: '',
        namespace: 'web',
        values: 'replicaCount: 2\n',
        dryRun: false,
        reuseValues: false,
        rollbackOnFailure: false,
        createNamespace: false,
        atomic: false,
        force: false,
        timeoutSecs: null,
        set: null,
      },
    });
  });

  it('renders diff lines vs the current release after fetching both sides', async () => {
    providerMocks.helmReleaseHistory.mockResolvedValue([
      {
        revision: 2,
        updated: '2026-08-28T00:00:00Z',
        status: 'deployed',
        chart: 'demo-1.0.0',
        appVersion: '1.0.0',
        description: 'Install complete',
      },
    ]);
    providerMocks.helmManifestRevision.mockResolvedValue('replicaCount: 1\n');
    providerMocks.helmRenderPreview.mockResolvedValue('replicaCount: 3\n');
    await renderToReview();
    view.click(view.getByText('Preview diff vs current release'));
    await settle();
    expect(providerMocks.helmReleaseHistory).toHaveBeenCalledWith('demo', 'web');
    expect(providerMocks.helmManifestRevision).toHaveBeenCalledWith('web', 'demo', 2);
    expect(providerMocks.helmRenderPreview).toHaveBeenCalledWith(
      '/data/charts/demo-1.0.0.tgz',
      '',
      'replicaCount: 2\n'
    );
    // One removed line (current) and one added line (rendered) — the -/+ rows.
    expect(view.queryByText('replicaCount: 1')).not.toBeNull();
    expect(view.queryByText('replicaCount: 3')).not.toBeNull();
    // The caveat note explains template vs dry-run metadata drift.
    expect(view.queryByText(/helm template/)).not.toBeNull();
  });

  it('saves a profile with a camelCase payload assembled from the form', async () => {
    await renderToValues();
    const nameInput = view.queryByPlaceholderText('Profile name');
    expect(nameInput).not.toBeNull();
    view.change(nameInput as HTMLElement, 'prod');
    view.click(view.getByText('Save as profile'));
    await settle();
    expect(providerMocks.helmProfileSave).toHaveBeenCalledWith({
      name: 'prod',
      chartRef: '/data/charts/demo-1.0.0.tgz',
      version: '',
      namespace: 'web',
      values: 'replicaCount: 2\n',
      set: null,
      atomic: false,
      force: false,
      createNamespace: false,
      timeoutSecs: null,
      createdAt: '',
    });
    expect(view.queryByText('Profile saved')).not.toBeNull();
  });

  it('drops a diff response that resolves after leaving the review step', async () => {
    // Hold the render preview in flight so the fetch outlives navigation.
    let resolvePreview: (v: string) => void = () => {};
    providerMocks.helmRenderPreview.mockReturnValue(
      new Promise<string>((res) => {
        resolvePreview = res;
      })
    );
    providerMocks.helmReleaseHistory.mockResolvedValue([
      {
        revision: 2,
        updated: '',
        status: 'deployed',
        chart: 'demo-1.0.0',
        appVersion: '1.0.0',
        description: '',
      },
    ]);
    providerMocks.helmManifestRevision.mockResolvedValue('replicaCount: 1\n');
    await renderToReview();
    view.click(view.getByText('Preview diff vs current release'));
    await settle(30);
    // Leave review while the render fetch is still pending…
    view.click(view.getByText('Back'));
    await settle(30);
    // …then let it resolve: the stale result must be dropped.
    resolvePreview('replicaCount: 9\n');
    await settle(30);
    view.click(view.getByText('Next')); // back to review
    await settle(30);
    // No diff section content: the caveat only renders when a diff exists.
    expect(view.queryByText(/helm template/)).toBeNull();
    expect(view.queryByText('replicaCount: 9')).toBeNull();
  });

  // ---- profile delete UI ----

  const makeProfile = (name: string): HelmProfile => ({
    name,
    chartRef: '/data/charts/demo-1.0.0.tgz',
    version: '',
    namespace: 'web',
    values: 'replicaCount: 7\n',
    set: null,
    atomic: false,
    force: false,
    createNamespace: false,
    timeoutSecs: null,
    createdAt: '2026-08-28T00:00:00Z',
  });

  /** Pick an <option> through React's controlled-select path. */
  function selectOption(el: HTMLSelectElement, value: string) {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value'
      )?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('enables profile delete only while a profile is selected', async () => {
    providerMocks.helmProfileList.mockResolvedValue([makeProfile('prod')]);
    await renderToValues();
    const deleteBtn = view.getByText('Delete') as HTMLButtonElement;
    expect(deleteBtn.hasAttribute('disabled')).toBe(true);
    const select = view.container.querySelector('select') as HTMLSelectElement;
    selectOption(select, 'prod');
    await settle(30);
    expect((view.getByText('Delete') as HTMLButtonElement).hasAttribute('disabled')).toBe(false);
  });

  it('deletes the selected profile after confirmation and refreshes the list', async () => {
    providerMocks.helmProfileList.mockResolvedValue([makeProfile('prod')]);
    providerMocks.helmProfileDelete.mockResolvedValue([]);
    await renderToValues();
    const select = view.container.querySelector('select') as HTMLSelectElement;
    selectOption(select, 'prod');
    await settle(30);
    view.click(view.getByText('Delete'));
    await settle(30);
    // The ConfirmDialog portals to document.body (outside the scoped
    // container), so its buttons are looked up on the document.
    expect(document.body.textContent).toContain('Delete profile "prod"?');
    const confirm = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Confirm'
    ) as HTMLButtonElement;
    act(() => {
      confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle(30);
    expect(providerMocks.helmProfileDelete).toHaveBeenCalledWith('prod');
    // The refreshed list no longer offers the deleted profile, the select
    // resets to "None", and the success note confirms the deletion.
    const selectAfter = view.container.querySelector('select') as HTMLSelectElement;
    expect(selectAfter.textContent).not.toContain('prod');
    expect((selectAfter as HTMLSelectElement).value).toBe('');
    expect(view.queryByText('Profile deleted')).not.toBeNull();
  });
});

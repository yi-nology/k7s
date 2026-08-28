/**
 * Tests for ChartRenderPreview — the offline `helm template` preview in the
 * local chart detail pane.
 *
 * Covers: empty state before the first render, the render call signature
 * (chart path, '' version, current values text), kind-stat badges parsed
 * from the manifest, user-edited values surviving into the render call,
 * and provider error surfacing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { useStore } from '../../store';
import { ChartRenderPreview } from './ChartRenderPreview';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import { createMockSettings } from '../../test/types';
import type { LocalChartDetail } from '../../providers/types';

// EditorCore (CodeMirror) renders as a textarea so jsdom can assert on the
// values text and the rendered manifest. Unlike the simpler mock used in
// other suites, this one wires onChange so user edits are testable.
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
      readOnly: !onChange,
      onChange: (e: { target: { value: string } }) => onChange?.(e.target.value),
    }),
}));

const detail: LocalChartDetail = {
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
  files: [],
  chartYaml: 'apiVersion: v2\nname: demo\nversion: 1.0.0\n',
  valuesYaml: 'replicaCount: 1\n',
  readme: '',
};

/** A multi-document manifest with repeatable kinds for the stats badges. */
const manifest = [
  '---',
  '# Source: demo/templates/a.yaml',
  'apiVersion: apps/v1',
  'kind: Deployment',
  '---',
  '# Source: demo/templates/b.yaml',
  'apiVersion: apps/v1',
  'kind: Deployment',
  '---',
  '# Source: demo/templates/c.yaml',
  'apiVersion: v1',
  'kind: Service',
  '',
].join('\n');

// vi.hoisted so the (hoisted) vi.mock factory can reference the fn.
const mocks = vi.hoisted(() => ({
  helmRenderPreview: vi.fn(),
}));

vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      helmRenderPreview: mocks.helmRenderPreview,
    }),
  };
});

let view: RenderResult;

beforeEach(() => {
  useStore.setState({ settings: createMockSettings({ language: 'en' }) });
  mocks.helmRenderPreview.mockReset().mockResolvedValue(manifest);
});

afterEach(() => {
  cleanup();
});

/** Async settle helper — the harness has no waitFor. */
const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms));

/** Set a textarea's value through React's controlled-input path. */
function type(el: HTMLTextAreaElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ChartRenderPreview', () => {
  it('shows the empty state before the first render', async () => {
    view = render(<ChartRenderPreview detail={detail} />);
    await settle();
    expect(
      view.queryByText(/Press Render to preview.*nothing is applied to the cluster/)
    ).not.toBeNull();
    expect(mocks.helmRenderPreview).not.toHaveBeenCalled();
  });

  it('renders via helmRenderPreview(path, "", values) and shows manifest + kind stats', async () => {
    view = render(<ChartRenderPreview detail={detail} />);
    await settle();
    view.click(view.getByText('Render'));
    await settle();
    expect(mocks.helmRenderPreview).toHaveBeenCalledTimes(1);
    expect(mocks.helmRenderPreview).toHaveBeenCalledWith(
      '/data/charts/demo-1.0.0.tgz',
      '',
      'replicaCount: 1\n'
    );
    // The rendered manifest is displayed read-only.
    const outputs = view
      .querySelectorAll('textarea')
      .filter((t) => (t as HTMLTextAreaElement).value.includes('kind: Deployment'));
    expect(outputs.length).toBe(1);
    // Kind stats: parsed, counted and sorted (count desc, then name).
    expect(view.queryByText('Deployment ×2')).not.toBeNull();
    expect(view.queryByText('Service ×1')).not.toBeNull();
    expect(view.queryByText('Resource stats')).not.toBeNull();
  });

  it('sends user-edited values to the render call', async () => {
    view = render(<ChartRenderPreview detail={detail} />);
    await settle();
    const valuesEditor = view.container.querySelector('textarea') as HTMLTextAreaElement;
    type(valuesEditor, 'replicaCount: 5\n');
    view.click(view.getByText('Render'));
    await settle();
    expect(mocks.helmRenderPreview).toHaveBeenCalledWith(
      '/data/charts/demo-1.0.0.tgz',
      '',
      'replicaCount: 5\n'
    );
  });

  it('refuses to render and shows an error for unsafe values', async () => {
    view = render(<ChartRenderPreview detail={detail} />);
    await settle();
    const valuesEditor = view.container.querySelector('textarea') as HTMLTextAreaElement;
    type(valuesEditor, 'injected: {{ .Values.secret }}\n');
    view.click(view.getByText('Render'));
    await settle();
    // The render never reaches the provider…
    expect(mocks.helmRenderPreview).not.toHaveBeenCalled();
    // …and the same banner the install wizard shows explains why.
    expect(view.queryByText(/potentially unsafe content/)).not.toBeNull();
  });

  it('surfaces a provider error instead of a manifest', async () => {
    mocks.helmRenderPreview.mockRejectedValue(new Error('helm binary not found'));
    view = render(<ChartRenderPreview detail={detail} />);
    await settle();
    view.click(view.getByText('Render'));
    await settle();
    expect(view.queryByText(/helm binary not found/)).not.toBeNull();
    expect(view.queryByText('Deployment ×2')).toBeNull();
  });
});

/**
 * Tests for LocalCharts — the on-disk chart library tab.
 *
 * Covers: entry list rendering, empty state, detail browsing (meta, file
 * list, file fetch, values.yaml special case, readme), the install-wizard
 * handoff, upload (extension validation + chunked base64), delete with
 * confirm, and provider error surfacing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { useStore } from '../../store';
import { LocalCharts } from './LocalCharts';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import { createMockSettings } from '../../test/types';
import { clearProviderQueryCache } from '../../hooks/useProviderQuery';
import type { LocalChartDetail, LocalChartEntry } from '../../providers/types';

// EditorCore (CodeMirror) renders as a read-only textarea so jsdom can
// assert on file/values content without the editor runtime. Same trick as
// the HelmInstallWizard suite.
vi.mock('../editor/EditorCore', () => ({
  EditorCore: ({ value }: { value?: string }) =>
    React.createElement('textarea', { value, readOnly: true }),
}));

const entry: LocalChartEntry = {
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
};

const detail: LocalChartDetail = {
  entry,
  files: [
    { path: 'demo/Chart.yaml', sizeBytes: 200, isDir: false },
    { path: 'demo/values.yaml', sizeBytes: 10, isDir: false },
  ],
  chartYaml: 'apiVersion: v2\nname: demo\nversion: 1.0.0\n',
  valuesYaml: 'replicaCount: 1\n',
  readme: '# demo chart readme\n',
};

/** An unpacked directory chart — the only kind `helm package` accepts, and
 * the kind `helm verify` refuses. */
const dirEntry: LocalChartEntry = {
  ...entry,
  id: 'demo-src',
  kind: 'dir',
  name: 'demo-src',
  version: '0.9.0',
  path: '/data/charts/demo-src',
};

const dirDetail: LocalChartDetail = {
  entry: dirEntry,
  files: [{ path: 'demo-src/Chart.yaml', sizeBytes: 200, isDir: false }],
  chartYaml: 'apiVersion: v2\nname: demo-src\nversion: 0.9.0\n',
  valuesYaml: 'replicaCount: 1\n',
  readme: '',
};

/** What `localChartPackage` returns for the directory chart. */
const packagedEntry: LocalChartEntry = {
  ...dirEntry,
  id: 'demo-src-0.9.0.tgz',
  kind: 'tgz',
  path: '/data/charts/demo-src-0.9.0.tgz',
};

// vi.hoisted so the (hoisted) vi.mock factory can reference the fns.
const mocks = vi.hoisted(() => ({
  localChartsList: vi.fn(),
  localChartDetail: vi.fn(),
  localChartFile: vi.fn(),
  localChartUpload: vi.fn(),
  localChartRemove: vi.fn(),
  // Toolbox actions (lint / verify / package / deps).
  localChartLint: vi.fn(),
  localChartVerify: vi.fn(),
  localChartPackage: vi.fn(),
  localChartDeps: vi.fn(),
  // The install/upgrade wizard consumes these once handed off.
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
}));

vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      localChartsList: mocks.localChartsList,
      localChartDetail: mocks.localChartDetail,
      localChartFile: mocks.localChartFile,
      localChartUpload: mocks.localChartUpload,
      localChartRemove: mocks.localChartRemove,
      localChartLint: mocks.localChartLint,
      localChartVerify: mocks.localChartVerify,
      localChartPackage: mocks.localChartPackage,
      localChartDeps: mocks.localChartDeps,
      helmChartVersions: mocks.helmChartVersions,
      helmRenderDefaultValues: mocks.helmRenderDefaultValues,
      helmRunOp: mocks.helmRunOp,
      onHelmOpLog: mocks.onHelmOpLog,
      onHelmOpDone: mocks.onHelmOpDone,
      helmReleaseHistory: mocks.helmReleaseHistory,
      helmManifestRevision: mocks.helmManifestRevision,
      helmValuesRevision: mocks.helmValuesRevision,
      helmRenderPreview: mocks.helmRenderPreview,
      helmProfileList: mocks.helmProfileList,
      helmProfileSave: mocks.helmProfileSave,
    }),
  };
});

let view: RenderResult;

function resetStore() {
  useStore.setState({
    settings: createMockSettings({ language: 'en' }),
  });
}

/** Async settle helper — the harness has no waitFor. */
const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms));

/** Pick an option in a <select> (the shared `change` helper targets inputs). */
function choose(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** Simulate the user picking a file in the hidden upload input. jsdom's
 * File does not implement Blob.arrayBuffer(), so it is stubbed with the
 * source bytes (browsers have it natively). */
function pickFile(bytes: Uint8Array<ArrayBuffer>, name: string) {
  const file = new File([bytes], name);
  file.arrayBuffer = () => Promise.resolve(bytes.buffer.slice(0, bytes.byteLength));
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement | null;
  expect(input).not.toBeNull();
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  act(() => {
    input!.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  resetStore();
  // The query cache is module-level; a stale hit from a previous test in
  // this file would seed the list and skip the fetch under test.
  clearProviderQueryCache();
  mocks.localChartsList.mockReset().mockResolvedValue([entry]);
  mocks.localChartDetail.mockReset().mockResolvedValue(detail);
  mocks.localChartFile.mockReset().mockResolvedValue('apiVersion: v2\n');
  mocks.localChartUpload.mockReset().mockResolvedValue(entry);
  mocks.localChartRemove.mockReset().mockResolvedValue(undefined);
  mocks.localChartLint.mockReset().mockResolvedValue('1 chart(s) linted, 0 chart(s) with failures');
  mocks.localChartVerify.mockReset().mockResolvedValue('Signature is valid');
  mocks.localChartPackage.mockReset().mockResolvedValue(packagedEntry);
  mocks.localChartDeps.mockReset().mockResolvedValue('No dependencies found');
  mocks.helmChartVersions.mockReset().mockResolvedValue([]);
  mocks.helmRenderDefaultValues.mockReset().mockResolvedValue('');
  mocks.helmRunOp
    .mockReset()
    .mockResolvedValue({ success: true, summary: 'done' });
  mocks.onHelmOpLog.mockReset().mockReturnValue(() => {});
  mocks.onHelmOpDone.mockReset().mockReturnValue(() => {});
  mocks.helmReleaseHistory.mockReset().mockResolvedValue([]);
  mocks.helmManifestRevision.mockReset().mockResolvedValue('');
  mocks.helmValuesRevision.mockReset().mockResolvedValue({});
  mocks.helmRenderPreview.mockReset().mockResolvedValue('');
  mocks.helmProfileList.mockReset().mockResolvedValue([]);
  mocks.helmProfileSave.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('LocalCharts', () => {
  it('lists library entries from the provider', async () => {
    view = render(<LocalCharts />);
    await settle();
    expect(view.queryByText('demo')).not.toBeNull();
    expect(view.queryByText(/v1\.0\.0/)).not.toBeNull();
    expect(view.queryByText('demo chart')).not.toBeNull();
  });

  it('shows the empty state when the library is empty', async () => {
    mocks.localChartsList.mockResolvedValue([]);
    view = render(<LocalCharts />);
    await settle();
    expect(view.queryByText('No local charts — upload a .tgz to get started')).not.toBeNull();
  });

  it('surfaces provider errors from the list query', async () => {
    mocks.localChartsList.mockRejectedValue(new Error('boom'));
    view = render(<LocalCharts />);
    await settle();
    expect(view.queryByText(/boom/)).not.toBeNull();
  });

  it('renders the upload button and a hidden .tgz file input', async () => {
    view = render(<LocalCharts />);
    await settle();
    expect(view.queryByText('Upload .tgz')).not.toBeNull();
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.getAttribute('accept')).toBe('.tgz,.tar.gz');
  });

  it('rejects non-tgz picks without uploading', async () => {
    view = render(<LocalCharts />);
    await settle();
    pickFile(new TextEncoder().encode('x'), 'notes.txt');
    await settle(50);
    expect(mocks.localChartUpload).not.toHaveBeenCalled();
    expect(view.queryByText('Only .tgz / .tar.gz files are accepted')).not.toBeNull();
  });

  it('uploads a picked tgz as base64 and refreshes the list', async () => {
    view = render(<LocalCharts />);
    await settle();
    pickFile(new Uint8Array([0x1f, 0x8b, 0x00]), 'demo-2.0.0.tgz');
    await settle(50);
    expect(mocks.localChartUpload).toHaveBeenCalledWith('demo-2.0.0.tgz', 'H4sA');
    // Mount fetch + post-upload reload.
    expect(mocks.localChartsList).toHaveBeenCalledTimes(2);
  });

  it('base64-encodes large files in chunks (no call-stack overflow)', async () => {
    view = render(<LocalCharts />);
    await settle();
    // 70k bytes in one String.fromCharCode spread would throw RangeError;
    // the chunked encoder must produce the full 4/3-length payload.
    pickFile(new Uint8Array(70_000), 'big-1.0.0.tgz');
    await settle(200);
    expect(mocks.localChartUpload).toHaveBeenCalledTimes(1);
    const b64 = mocks.localChartUpload.mock.calls[0][1] as string;
    expect(b64.length).toBe(93_336); // ceil(70000/3)*4
  });

  it('loads the detail view for a selected entry', async () => {
    view = render(<LocalCharts />);
    await settle();
    view.click(view.getByText('demo'));
    await settle();
    expect(mocks.localChartDetail).toHaveBeenCalledWith('demo-1.0.0.tgz');
    expect(view.queryByText('Files')).not.toBeNull();
    expect(view.queryByText(/demo\/Chart\.yaml/)).not.toBeNull();
    expect(view.queryByText(/demo\/values\.yaml/)).not.toBeNull();
    expect(view.queryByText(/demo chart readme/)).not.toBeNull();
  });

  it('shows values.yaml from the detail payload without a file fetch', async () => {
    view = render(<LocalCharts />);
    await settle();
    view.click(view.getByText('demo'));
    await settle();
    view.click(view.getByText(/demo\/values\.yaml/));
    await settle(50);
    expect(mocks.localChartFile).not.toHaveBeenCalled();
    // The render-preview values editor (above Files) also holds a textarea;
    // the file view is the last editor in the pane.
    const textareas = view.querySelectorAll('textarea') as HTMLTextAreaElement[];
    const textarea = textareas[textareas.length - 1];
    expect(textarea?.value).toBe('replicaCount: 1\n');
  });

  it('fetches and shows a chart file on click', async () => {
    view = render(<LocalCharts />);
    await settle();
    view.click(view.getByText('demo'));
    await settle();
    view.click(view.getByText(/demo\/Chart\.yaml/));
    await settle(50);
    expect(mocks.localChartFile).toHaveBeenCalledWith('demo-1.0.0.tgz', 'demo/Chart.yaml');
    // The render-preview values editor (above Files) also holds a textarea;
    // the file view is the last editor in the pane.
    const textareas = view.querySelectorAll('textarea') as HTMLTextAreaElement[];
    const textarea = textareas[textareas.length - 1];
    expect(textarea?.value).toBe('apiVersion: v2\n');
  });

  it('drops a slow file fetch that resolves after another file was opened', async () => {
    // Hold the first file fetch in flight, open the values file (no fetch —
    // instant), then release the stale response: it must not overwrite the
    // newer file view.
    let resolveChartYaml: (v: string) => void = () => {};
    mocks.localChartFile.mockReturnValueOnce(
      new Promise<string>((res) => {
        resolveChartYaml = res;
      })
    );
    view = render(<LocalCharts />);
    await settle();
    view.click(view.getByText('demo'));
    await settle();
    view.click(view.getByText(/demo\/Chart\.yaml/)); // fetch held in flight
    await settle(30);
    view.click(view.getByText(/demo\/values\.yaml/)); // resolves immediately
    await settle(30);
    const lastText = () => {
      const textareas = view.querySelectorAll('textarea') as HTMLTextAreaElement[];
      return textareas[textareas.length - 1]?.value;
    };
    expect(lastText()).toBe('replicaCount: 1\n');
    // The stale Chart.yaml response lands after the switch…
    resolveChartYaml('apiVersion: v2\nkind: Evil\n');
    await settle(30);
    // …but the user's latest pick (values.yaml) must stay mounted.
    expect(lastText()).toBe('replicaCount: 1\n');
  });

  it('drops a slow detail fetch that resolves after another entry was opened', async () => {
    const other: LocalChartEntry = {
      ...entry,
      id: 'other-2.0.0.tgz',
      name: 'other',
      description: 'other chart',
    };
    const otherDetail: LocalChartDetail = {
      entry: other,
      files: [{ path: 'other/Chart.yaml', sizeBytes: 5, isDir: false }],
      chartYaml: 'apiVersion: v2\nname: other\nversion: 2.0.0\n',
      valuesYaml: 'replicaCount: 9\n',
      readme: '',
    };
    let resolveDemoDetail: (d: LocalChartDetail) => void = () => {};
    mocks.localChartsList.mockResolvedValue([entry, other]);
    mocks.localChartDetail
      .mockReturnValueOnce(
        new Promise<LocalChartDetail>((res) => {
          resolveDemoDetail = res;
        })
      )
      .mockResolvedValueOnce(otherDetail);
    view = render(<LocalCharts />);
    await settle();
    view.click(view.getByText('demo')); // detail fetch held in flight
    await settle(30);
    view.click(view.getByText('other')); // resolves immediately
    await settle(30);
    expect(view.queryByText(/other\/Chart\.yaml/)).not.toBeNull();
    // The stale "demo" detail lands after the switch…
    resolveDemoDetail(detail);
    await settle(30);
    // …but "other" must stay mounted — demo's files must never appear.
    expect(view.queryByText(/other\/Chart\.yaml/)).not.toBeNull();
    expect(view.queryByText(/demo\/Chart\.yaml/)).toBeNull();
  });

  it('hands off to the install wizard for the selected chart', async () => {
    view = render(<LocalCharts />);
    await settle();
    view.click(view.getByText('demo'));
    await settle();
    view.click(view.getByText('Install this chart'));
    await settle(50);
    // The wizard's version step proves the handoff rendered.
    expect(view.queryByText('Release name')).not.toBeNull();
    expect(view.queryByText('Namespace')).not.toBeNull();
  });

  it('opens the wizard in upgrade mode from the upgrade form handoff', async () => {
    view = render(<LocalCharts />);
    await settle();
    view.click(view.getByText('demo'));
    await settle();
    view.click(view.getByText('Upgrade existing release'));
    await settle();
    const rel = view.queryByLabelText('Release name') as HTMLInputElement | null;
    const ns = view.queryByLabelText('Namespace') as HTMLInputElement | null;
    expect(rel).not.toBeNull();
    expect(ns).not.toBeNull();
    // The upgrade entry is gated on a valid release name.
    expect(
      (view.getByText('Upgrade') as HTMLButtonElement).hasAttribute('disabled')
    ).toBe(true);
    view.change(rel as HTMLElement, 'demo-app');
    view.change(ns as HTMLElement, 'web');
    expect(
      (view.getByText('Upgrade') as HTMLButtonElement).hasAttribute('disabled')
    ).toBe(false);
    view.click(view.getByText('Upgrade'));
    await settle(50);
    // The wizard replaced the detail pane, release/namespace prefilled
    // (read-only) from the form.
    expect(view.queryByText('Version')).not.toBeNull();
    const textInputs = view.querySelectorAll('input').filter(
      (i) => (i as HTMLInputElement).type !== 'file'
    ) as HTMLInputElement[];
    expect(textInputs[0].value).toBe('demo-app');
    expect(textInputs[0].readOnly).toBe(true);
    expect(textInputs[1].value).toBe('web');
    expect(textInputs[1].readOnly).toBe(true);
  });

  it('deletes an entry after confirmation', async () => {
    view = render(<LocalCharts />);
    await settle();
    view.click(view.getByText('Delete'));
    await settle(50);
    // The ConfirmDialog portals to document.body (outside the scoped
    // container), so its buttons are looked up on the document.
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Delete chart "demo-1.0.0.tgz"');
    const confirm = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Confirm',
    ) as HTMLButtonElement;
    act(() => {
      confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle(50);
    expect(mocks.localChartRemove).toHaveBeenCalledWith('demo-1.0.0.tgz');
    expect(mocks.localChartsList).toHaveBeenCalledTimes(2);
  });

  it('keeps the entry when the delete is cancelled', async () => {
    view = render(<LocalCharts />);
    await settle();
    view.click(view.getByText('Delete'));
    await settle(50);
    const cancel = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Cancel',
    ) as HTMLButtonElement;
    act(() => {
      cancel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle(50);
    expect(mocks.localChartRemove).not.toHaveBeenCalled();
  });

  // ---- toolbox: lint / verify / package / deps ----

  it('runs Lint from the toolbox and shows the report', async () => {
    mocks.localChartLint.mockResolvedValue(
      '==> Linting chart demo\n\n1 chart(s) linted, 0 chart(s) with failures'
    );
    view = render(<LocalCharts />);
    await settle();
    view.click(view.getByText('demo'));
    await settle();
    view.click(view.getByText('Lint'));
    await settle(50);
    expect(mocks.localChartLint).toHaveBeenCalledWith('demo-1.0.0.tgz');
    expect(
      view.queryByText('==> Linting chart demo\n\n1 chart(s) linted, 0 chart(s) with failures')
    ).not.toBeNull();
  });

  it('shows a lint failure as the error banner, not as output', async () => {
    mocks.localChartLint.mockRejectedValue(new Error('[ERROR] values.yaml: missing image'));
    view = render(<LocalCharts />);
    await settle();
    view.click(view.getByText('demo'));
    await settle();
    view.click(view.getByText('Lint'));
    await settle(50);
    expect(view.queryByText(/missing image/)).not.toBeNull();
    expect(view.queryByText('1 chart(s) linted, 0 chart(s) with failures')).toBeNull();
  });

  it('disables Verify for directory charts and Package for packaged ones', async () => {
    mocks.localChartsList.mockResolvedValue([entry, dirEntry]);
    mocks.localChartDetail.mockImplementation(async (id: string) =>
      id === 'demo-src' ? dirDetail : detail
    );
    view = render(<LocalCharts />);
    await settle();
    // tgz chart: Verify enabled, Package disabled (already packaged).
    view.click(view.getByText('demo'));
    await settle();
    expect(
      (view.getByText('Verify') as HTMLButtonElement).hasAttribute('disabled')
    ).toBe(false);
    expect(
      (view.getByText('Package') as HTMLButtonElement).hasAttribute('disabled')
    ).toBe(true);
    // dir chart: the reverse — Verify refuses a directory, Package is the point.
    view.click(view.getByText('demo-src'));
    await settle();
    expect(
      (view.getByText('Verify') as HTMLButtonElement).hasAttribute('disabled')
    ).toBe(true);
    expect(
      (view.getByText('Package') as HTMLButtonElement).hasAttribute('disabled')
    ).toBe(false);
    view.click(view.getByText('Verify'));
    await settle(50);
    expect(mocks.localChartVerify).not.toHaveBeenCalled();
  });

  it('packages a directory chart, refreshes the list and names the new archive', async () => {
    mocks.localChartsList.mockResolvedValue([dirEntry]);
    mocks.localChartDetail.mockResolvedValue(dirDetail);
    view = render(<LocalCharts />);
    await settle();
    view.click(view.getByText('demo-src'));
    await settle();
    view.click(view.getByText('Package'));
    await settle(50);
    expect(mocks.localChartPackage).toHaveBeenCalledWith('demo-src');
    // Mount fetch + post-package refetch.
    expect(mocks.localChartsList).toHaveBeenCalledTimes(2);
    expect(view.queryByText('Packaged to library: demo-src-0.9.0.tgz')).not.toBeNull();
  });

  it('runs the selected dependency action', async () => {
    mocks.localChartDeps.mockResolvedValue('No dependencies to build');
    view = render(<LocalCharts />);
    await settle();
    view.click(view.getByText('demo'));
    await settle();
    const select = view.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('list');
    choose(select, 'build');
    view.click(view.getByText('Run'));
    await settle(50);
    expect(mocks.localChartDeps).toHaveBeenCalledWith('demo-1.0.0.tgz', 'build');
    expect(view.queryByText('No dependencies to build')).not.toBeNull();
  });
});

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
  valuesYaml: 'replicaCount: 1\n',
  readme: '# demo chart readme\n',
};

// vi.hoisted so the (hoisted) vi.mock factory can reference the fns.
const mocks = vi.hoisted(() => ({
  localChartsList: vi.fn(),
  localChartDetail: vi.fn(),
  localChartFile: vi.fn(),
  localChartUpload: vi.fn(),
  localChartRemove: vi.fn(),
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
    const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement | null;
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
    const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(textarea?.value).toBe('apiVersion: v2\n');
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
});

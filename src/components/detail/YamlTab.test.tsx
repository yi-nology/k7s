/**
 * Tests for YamlTab — the YAML detail tab.
 *
 * Covers: loading/error states, read-only display, edit button, edit mode
 * (cancel/preview), path display, secrets non-editable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { useStore } from '../../store';
import { YamlTab } from './YamlTab';
import { render, cleanup, createMockPodRow, type RenderResult } from '../../test/componentUtils';

// Mock the provider.
const mockGetYaml = vi.fn();
const mockDryRunYaml = vi.fn();
const mockApplyYaml = vi.fn();
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      getYaml: mockGetYaml,
      dryRunYaml: mockDryRunYaml,
      applyYaml: mockApplyYaml,
    }),
    IS_TAURI: false,
  };
});

// Mock EditorCore (the shared CodeMirror wrapper YamlTab renders) to avoid
// CodeMirror/lit dependencies in jsdom. Exposes the same testids the old
// CodeEditor mock did, so the assertions below are unchanged.
vi.mock('../editor/EditorCore', () => ({
  EditorCore: ({
    value,
    editable,
    onChange,
  }: {
    value?: string;
    editable?: boolean;
    onChange?: (text: string) => void;
  }) =>
    createElement('div', {
      'data-testid': 'code-editor',
      'data-editable': String(editable),
      children: [
        value || '',
        editable && onChange
          ? createElement('button', {
              'data-testid': 'editor-change',
              onClick: () => onChange('modified yaml'),
            })
          : null,
      ],
    }),
}));

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
    selectedRow: null,
    yamlEditing: false,
    yamlDraft: '',
    startYamlEdit: (initial: string) =>
      useStore.setState({ yamlEditing: true, yamlDraft: initial }),
    cancelYaml: () => useStore.setState({ yamlEditing: false, yamlDraft: '' }),
    setYamlDraft: (text: string) => useStore.setState({ yamlDraft: text }),
  });
}

const SAMPLE_YAML = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: nginx';

beforeEach(() => {
  resetStore();
  mockGetYaml.mockReset();
  mockDryRunYaml.mockReset();
  mockApplyYaml.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('YamlTab', () => {
  describe('no selection', () => {
    it('renders nothing when no row is selected', () => {
      useStore.setState({ selectedRow: null });
      view = render(<YamlTab />);
      expect(view.container.innerHTML).toBe('');
    });
  });

  describe('loading', () => {
    it('renders without crashing while yaml is loading', () => {
      mockGetYaml.mockReturnValue(new Promise(() => {})); // never resolves
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ selectedRow: pod });
      view = render(<YamlTab />);
      // Should render the toolbar at minimum
      expect(view.container.firstChild).not.toBeNull();
    });
  });

  describe('yaml display', () => {
    it('fetches and displays yaml content', async () => {
      mockGetYaml.mockResolvedValue(SAMPLE_YAML);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ selectedRow: pod });
      view = render(<YamlTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      const editor = view.queryByTestId('code-editor');
      expect(editor).not.toBeNull();
      expect(editor?.textContent).toContain('apiVersion');
    });

    it('renders the resource path in the toolbar', async () => {
      mockGetYaml.mockResolvedValue(SAMPLE_YAML);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ nav: 'pods', selectedRow: pod });
      view = render(<YamlTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      // Path should be "pods/default/nginx.yaml"
      expect(view.queryByText(/pods\/default\/nginx\.yaml/)).not.toBeNull();
    });
  });

  describe('error handling', () => {
    it('shows error when fetch fails', async () => {
      mockGetYaml.mockRejectedValue(new Error('not found'));
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ selectedRow: pod });
      view = render(<YamlTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('not found')).not.toBeNull();
    });
  });

  describe('edit mode', () => {
    it('shows edit button for editable kinds', async () => {
      mockGetYaml.mockResolvedValue(SAMPLE_YAML);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ nav: 'pods', selectedRow: pod, yamlEditing: false });
      view = render(<YamlTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText(/Edit/)).not.toBeNull();
    });

    it('enters edit mode when edit button is clicked', async () => {
      mockGetYaml.mockResolvedValue(SAMPLE_YAML);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ nav: 'pods', selectedRow: pod, yamlEditing: false });
      view = render(<YamlTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      const editBtn = view.queryByText(/Edit/);
      expect(editBtn).not.toBeNull();
      view.click(editBtn!);
      expect(useStore.getState().yamlEditing).toBe(true);
    });

    it('shows cancel and preview buttons in edit mode', async () => {
      mockGetYaml.mockResolvedValue(SAMPLE_YAML);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ nav: 'pods', selectedRow: pod, yamlEditing: true });
      view = render(<YamlTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('Cancel')).not.toBeNull();
      expect(view.queryByText(/Preview/)).not.toBeNull();
    });

    it('cancels edit mode on cancel click', async () => {
      mockGetYaml.mockResolvedValue(SAMPLE_YAML);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'nginx' });
      useStore.setState({ nav: 'pods', selectedRow: pod, yamlEditing: true });
      view = render(<YamlTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      const cancelBtn = view.queryByText('Cancel');
      expect(cancelBtn).not.toBeNull();
      view.click(cancelBtn!);
      expect(useStore.getState().yamlEditing).toBe(false);
    });
  });

  describe('secrets non-editable', () => {
    it('does not show edit button for secrets', async () => {
      mockGetYaml.mockResolvedValue(SAMPLE_YAML);
      const pod = createMockPodRow({ uid: 'pod-1', name: 'my-secret' });
      useStore.setState({ nav: 'secrets', selectedRow: pod, yamlEditing: false });
      view = render(<YamlTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText(/Edit/)).toBeNull();
    });
  });
});

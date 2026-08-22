/**
 * Tests for RevisionsTab — the revision history detail tab.
 *
 * Covers: no-selection state, loading state, empty state, revision rendering,
 * current revision marking, rollback button, edit image button, error display.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { useStore } from '../../store';
import { RevisionsTab } from './RevisionsTab';
import { render, cleanup, createMockRow, type RenderResult } from '../../test/componentUtils';
import type { Revision } from '../../providers/types';

// Mock the provider.
const mockListRevisions = vi.fn();
const mockUndoRollout = vi.fn();
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      listRevisions: mockListRevisions,
      undoRollout: mockUndoRollout,
    }),
  };
});

// Mock ModifyImageForm — returns a React element, not a DOM node.
vi.mock('../actions/ModifyImageForm', () => ({
  ModifyImageForm: ({ onClose }: { onClose?: () => void }) =>
    createElement(
      'div',
      { 'data-testid': 'modify-image-form' },
      createElement('button', { onClick: () => onClose?.() }, 'Close Form')
    ),
}));

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'deployments',
    selectedRow: null,
  });
}

const MOCK_REVISIONS: Revision[] = [
  {
    revision: 3,
    images: [{ name: 'app', image: 'nginx:1.25', init: false }],
    desired: 3,
    ready: 3,
    age: '2024-01-03T00:00:00Z',
    isCurrent: true,
  },
  {
    revision: 2,
    images: [{ name: 'app', image: 'nginx:1.24', init: false }],
    desired: 3,
    ready: 0,
    age: '2024-01-02T00:00:00Z',
    isCurrent: false,
  },
  {
    revision: 1,
    images: [
      { name: 'app', image: 'nginx:1.23', init: false },
      { name: 'init', image: 'busybox:1.36', init: true },
    ],
    desired: 3,
    ready: 0,
    age: '2024-01-01T00:00:00Z',
    isCurrent: false,
  },
];

beforeEach(() => {
  resetStore();
  mockListRevisions.mockReset();
  mockUndoRollout.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('RevisionsTab', () => {
  describe('no selection', () => {
    it('shows no-selection message when no row is selected', () => {
      useStore.setState({ selectedRow: null });
      view = render(<RevisionsTab />);
      expect(view.queryByText(/No workload selected/)).not.toBeNull();
    });
  });

  describe('loading state', () => {
    it('shows loading message while fetching', () => {
      mockListRevisions.mockReturnValue(new Promise(() => {})); // never resolves
      const row = createMockRow({ uid: 'deploy-1', name: 'my-app' });
      useStore.setState({ selectedRow: row });
      view = render(<RevisionsTab />);
      expect(view.queryByText(/Loading history/)).not.toBeNull();
    });
  });

  describe('empty state', () => {
    it('shows empty message when no revisions exist', async () => {
      mockListRevisions.mockResolvedValue([]);
      const row = createMockRow({ uid: 'deploy-1', name: 'my-app' });
      useStore.setState({ selectedRow: row });
      view = render(<RevisionsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText(/No revision history/)).not.toBeNull();
    });
  });

  describe('revision rendering', () => {
    it('renders section titles', async () => {
      mockListRevisions.mockResolvedValue(MOCK_REVISIONS);
      const row = createMockRow({ uid: 'deploy-1', name: 'my-app' });
      useStore.setState({ selectedRow: row });
      view = render(<RevisionsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('Current image')).not.toBeNull();
      expect(view.queryByText('Revision history')).not.toBeNull();
    });

    it('renders revision numbers', async () => {
      mockListRevisions.mockResolvedValue(MOCK_REVISIONS);
      const row = createMockRow({ uid: 'deploy-1', name: 'my-app' });
      useStore.setState({ selectedRow: row });
      view = render(<RevisionsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('3')).not.toBeNull();
      expect(view.queryByText('2')).not.toBeNull();
      expect(view.queryByText('1')).not.toBeNull();
    });

    it('renders container images', async () => {
      mockListRevisions.mockResolvedValue(MOCK_REVISIONS);
      const row = createMockRow({ uid: 'deploy-1', name: 'my-app' });
      useStore.setState({ selectedRow: row });
      view = render(<RevisionsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('nginx:1.25')).not.toBeNull();
      expect(view.queryByText('nginx:1.24')).not.toBeNull();
    });

    it('renders replica counts', async () => {
      mockListRevisions.mockResolvedValue(MOCK_REVISIONS);
      const row = createMockRow({ uid: 'deploy-1', name: 'my-app' });
      useStore.setState({ selectedRow: row });
      view = render(<RevisionsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('3/3')).not.toBeNull();
    });
  });

  describe('current revision', () => {
    it('marks the current revision', async () => {
      mockListRevisions.mockResolvedValue(MOCK_REVISIONS);
      const row = createMockRow({ uid: 'deploy-1', name: 'my-app' });
      useStore.setState({ selectedRow: row });
      view = render(<RevisionsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('current')).not.toBeNull();
    });
  });

  describe('rollback', () => {
    it('shows rollback button for non-current revisions', async () => {
      mockListRevisions.mockResolvedValue(MOCK_REVISIONS);
      const row = createMockRow({ uid: 'deploy-1', name: 'my-app' });
      useStore.setState({ selectedRow: row });
      view = render(<RevisionsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      // Count actual <button> elements with "Rollback" text
      const allBtns = view.container.querySelectorAll('button');
      const rollbackBtns = Array.from(allBtns).filter((b) => b.textContent?.trim() === 'Rollback');
      // Two non-current revisions should have rollback buttons
      expect(rollbackBtns.length).toBe(2);
    });

    it('calls undoRollout when rollback is clicked', async () => {
      mockListRevisions.mockResolvedValue(MOCK_REVISIONS);
      mockUndoRollout.mockResolvedValue(undefined);
      const row = createMockRow({ uid: 'deploy-1', name: 'my-app' });
      useStore.setState({ selectedRow: row });
      view = render(<RevisionsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      const allBtns = view.container.querySelectorAll('button');
      const rollbackBtns = Array.from(allBtns).filter((b) => b.textContent?.trim() === 'Rollback');
      // Click the first rollback button (revision 2)
      view.click(rollbackBtns[0]);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(mockUndoRollout).toHaveBeenCalled();
    });
  });

  describe('edit image', () => {
    it('shows edit image button when current revision has images', async () => {
      mockListRevisions.mockResolvedValue(MOCK_REVISIONS);
      const row = createMockRow({ uid: 'deploy-1', name: 'my-app' });
      useStore.setState({ selectedRow: row });
      view = render(<RevisionsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('Edit image')).not.toBeNull();
    });

    it('shows the modify form when edit image is clicked', async () => {
      mockListRevisions.mockResolvedValue(MOCK_REVISIONS);
      const row = createMockRow({ uid: 'deploy-1', name: 'my-app' });
      useStore.setState({ selectedRow: row });
      view = render(<RevisionsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      const editBtn = view.queryByText('Edit image');
      expect(editBtn).not.toBeNull();
      view.click(editBtn!);
      expect(view.queryByTestId('modify-image-form')).not.toBeNull();
    });
  });

  describe('error handling', () => {
    it('displays error message on fetch failure', async () => {
      mockListRevisions.mockRejectedValue(new Error('RBAC denied'));
      const row = createMockRow({ uid: 'deploy-1', name: 'my-app' });
      useStore.setState({ selectedRow: row });
      view = render(<RevisionsTab />);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(view.queryByText('RBAC denied')).not.toBeNull();
    });
  });
});

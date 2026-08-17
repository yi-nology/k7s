/**
 * Tests for ResourceDiff — side-by-side YAML comparison.
 *
 * Covers: rendering, close button, mode toggle, selectors, diff display.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { ResourceDiff } from './ResourceDiff';
import { render, cleanup, createMockRow, type RenderResult } from '../../test/componentUtils';

// Mock the provider.
const mockGetYaml = vi.fn().mockResolvedValue('apiVersion: v1\nkind: Pod');
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      getYaml: mockGetYaml,
    }),
  };
});

// Mock diffLines and diffStat.
vi.mock('../../lib/diff', () => ({
  diffLines: vi.fn(() => [
    { op: 'same', text: 'apiVersion: v1', before: 1, after: 1 },
    { op: 'add', text: 'kind: Service', after: 2 },
    { op: 'del', text: 'kind: Pod', before: 2 },
  ]),
  diffStat: vi.fn(() => ({ added: 1, removed: 1, unchanged: 1 })),
}));

let view: RenderResult;

function resetStore() {
  useStore.setState({
    rows: {
      ...useStore.getState().rows,
      deployments: [createMockRow({ uid: 'd1', name: 'nginx', namespace: 'default' })],
      pods: [createMockRow({ uid: 'p1', name: 'pod-1', namespace: 'default' })],
    },
  });
}

beforeEach(() => {
  resetStore();
  mockGetYaml.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('ResourceDiff', () => {
  describe('rendering', () => {
    it('renders the diff panel', () => {
      const onClose = vi.fn();
      view = render(<ResourceDiff onClose={onClose} />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('renders the title', () => {
      const onClose = vi.fn();
      view = render(<ResourceDiff onClose={onClose} />);
      expect(view.queryByText(/Resource Diff/)).not.toBeNull();
    });

    it('renders close button', () => {
      const onClose = vi.fn();
      view = render(<ResourceDiff onClose={onClose} />);
      expect(view.queryByText('Close')).not.toBeNull();
    });

    it('calls onClose when close button clicked', () => {
      const onClose = vi.fn();
      view = render(<ResourceDiff onClose={onClose} />);
      const closeBtn = view.queryByText('Close');
      if (closeBtn) view.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('mode toggle', () => {
    it('renders paste YAML mode button', () => {
      const onClose = vi.fn();
      view = render(<ResourceDiff onClose={onClose} />);
      expect(view.queryByText(/Paste YAML/)).not.toBeNull();
    });

    it('renders resource mode button', () => {
      const onClose = vi.fn();
      view = render(<ResourceDiff onClose={onClose} />);
      expect(view.queryByText(/Resource/)).not.toBeNull();
    });

    it('shows textarea in text mode', () => {
      const onClose = vi.fn();
      view = render(<ResourceDiff onClose={onClose} />);
      const textarea = view.container.querySelector('textarea');
      expect(textarea).not.toBeNull();
    });
  });

  describe('selectors', () => {
    it('renders left side selectors', () => {
      const onClose = vi.fn();
      view = render(<ResourceDiff onClose={onClose} />);
      expect(view.queryByText(/Left/)).not.toBeNull();
    });

    it('renders right side selectors', () => {
      const onClose = vi.fn();
      view = render(<ResourceDiff onClose={onClose} />);
      expect(view.queryByText(/Right/)).not.toBeNull();
    });

    it('renders kind selects', () => {
      const onClose = vi.fn();
      view = render(<ResourceDiff onClose={onClose} />);
      const selects = view.container.querySelectorAll('select');
      expect(selects.length).toBeGreaterThanOrEqual(2); // left kind + left ns + left name
    });
  });
});

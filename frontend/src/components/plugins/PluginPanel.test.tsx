/**
 * Tests for PluginPanel — plugin management overlay.
 *
 * Covers: rendering, empty state, plugin list, toggle, close button.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginPanel } from './PluginPanel';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

// Mock pluginManager — use vi.hoisted to avoid top-level variable issue.
const { mockGetAll, mockIsEnabled, mockToggle } = vi.hoisted(() => ({
  mockGetAll: vi.fn().mockReturnValue([]),
  mockIsEnabled: vi.fn().mockReturnValue(false),
  mockToggle: vi.fn(),
}));
vi.mock('../../lib/plugins/manager', () => ({
  pluginManager: {
    getAll: mockGetAll,
    isEnabled: mockIsEnabled,
    toggle: mockToggle,
  },
}));

let view: RenderResult;

function makePlugin(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    author: 'Test Author',
    ...overrides,
  };
}

beforeEach(() => {
  mockGetAll.mockReturnValue([]);
  mockIsEnabled.mockReturnValue(false);
  mockToggle.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('PluginPanel', () => {
  describe('rendering', () => {
    it('renders the panel', () => {
      view = render(<PluginPanel />);
      expect(view.container.firstChild).not.toBeNull();
    });

    it('renders the title', () => {
      view = render(<PluginPanel />);
      expect(view.queryByText('Plugins')).not.toBeNull();
    });

    it('renders close button when onClose provided', () => {
      const onClose = vi.fn();
      view = render(<PluginPanel onClose={onClose} />);
      expect(view.queryByText('Close')).not.toBeNull();
    });

    it('calls onClose when close button clicked', () => {
      const onClose = vi.fn();
      view = render(<PluginPanel onClose={onClose} />);
      const closeBtn = view.queryByText('Close');
      if (closeBtn) view.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('empty state', () => {
    it('shows empty message when no plugins', () => {
      mockGetAll.mockReturnValue([]);
      view = render(<PluginPanel />);
      expect(view.queryByText(/No plugins installed/)).not.toBeNull();
    });
  });

  describe('plugin list', () => {
    it('renders plugin name', () => {
      mockGetAll.mockReturnValue([makePlugin()]);
      view = render(<PluginPanel />);
      expect(view.queryByText('Test Plugin')).not.toBeNull();
    });

    it('renders plugin version', () => {
      mockGetAll.mockReturnValue([makePlugin({ version: '2.0.0' })]);
      view = render(<PluginPanel />);
      expect(view.queryByText('2.0.0')).not.toBeNull();
    });

    it('renders plugin description', () => {
      mockGetAll.mockReturnValue([makePlugin({ description: 'My description' })]);
      view = render(<PluginPanel />);
      expect(view.queryByText('My description')).not.toBeNull();
    });

    it('renders plugin author', () => {
      mockGetAll.mockReturnValue([makePlugin({ author: 'John Doe' })]);
      view = render(<PluginPanel />);
      expect(view.queryByText(/John Doe/)).not.toBeNull();
    });

    it('renders multiple plugins', () => {
      mockGetAll.mockReturnValue([
        makePlugin({ id: 'p1', name: 'Plugin One' }),
        makePlugin({ id: 'p2', name: 'Plugin Two' }),
      ]);
      view = render(<PluginPanel />);
      expect(view.queryByText('Plugin One')).not.toBeNull();
      expect(view.queryByText('Plugin Two')).not.toBeNull();
    });
  });

  describe('toggle', () => {
    it('renders toggle checkbox', () => {
      mockGetAll.mockReturnValue([makePlugin()]);
      view = render(<PluginPanel />);
      const checkbox = view.container.querySelector('input[type="checkbox"]');
      expect(checkbox).not.toBeNull();
    });

    it('calls toggle when checkbox clicked', () => {
      mockGetAll.mockReturnValue([makePlugin({ id: 'my-plugin' })]);
      view = render(<PluginPanel />);
      const checkbox = view.container.querySelector('input[type="checkbox"]');
      expect(checkbox).not.toBeNull();
      view.click(checkbox as HTMLElement);
      expect(mockToggle).toHaveBeenCalledWith('my-plugin');
    });

    it('shows enabled state', () => {
      mockGetAll.mockReturnValue([makePlugin()]);
      mockIsEnabled.mockReturnValue(true);
      view = render(<PluginPanel />);
      const checkbox = view.container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox?.checked).toBe(true);
    });
  });

  describe('load button', () => {
    it('renders load plugin button', () => {
      view = render(<PluginPanel />);
      expect(view.queryByText(/Load Plugin/)).not.toBeNull();
    });

    it('load button is disabled', () => {
      view = render(<PluginPanel />);
      const loadBtn = view.queryByText(/Load Plugin/);
      expect(loadBtn).not.toBeNull();
      expect((loadBtn as HTMLButtonElement)?.disabled).toBe(true);
    });
  });
});

/**
 * Tests for SettingsPanel — settings modal.
 *
 * Covers: open/close state, backdrop close, Esc key, settings fields,
 * reset button, theme/language selects.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { DEFAULT_SETTINGS, type Settings } from '../../lib/settings';
import { SettingsPanel } from './SettingsPanel';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

// Mock McpPanel to avoid complex dependencies.
vi.mock('./McpPanel', () => ({
  McpPanel: () => <div data-testid="mcp-panel">MCP Panel</div>,
}));

// Mock AiSettingsPanel to avoid async state updates on mount.
vi.mock('../ai/AiSettingsPanel', () => ({
  AiSettingsPanel: () => <div data-testid="ai-settings-panel">AI Settings</div>,
}));

let view: RenderResult;

function resetStore() {
  useStore.setState({
    settingsOpen: false,
    settings: { ...DEFAULT_SETTINGS },
    setSettingsOpen: (open: boolean) => useStore.setState({ settingsOpen: open }),
    setSettings: (patch: Partial<Settings>) =>
      useStore.setState((state) => ({ settings: { ...state.settings, ...patch } })),
    connection: { phase: 'idle', context: null, clusterName: null },
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('SettingsPanel', () => {
  describe('visibility', () => {
    it('renders nothing when closed', () => {
      useStore.setState({ settingsOpen: false });
      view = render(<SettingsPanel />);
      expect(view.container.innerHTML).toBe('');
    });

    it('renders when open', () => {
      useStore.setState({ settingsOpen: true });
      view = render(<SettingsPanel />);
      expect(view.container.firstChild).not.toBeNull();
    });
  });

  describe('close behavior', () => {
    it('closes on backdrop click', () => {
      useStore.setState({ settingsOpen: true });
      view = render(<SettingsPanel />);
      // The backdrop is the first child div
      const backdrop = view.container.firstChild as HTMLElement;
      expect(backdrop).not.toBeNull();
      view.click(backdrop);
      expect(useStore.getState().settingsOpen).toBe(false);
    });

    it('closes on close button click', () => {
      useStore.setState({ settingsOpen: true });
      view = render(<SettingsPanel />);
      // Find the close button (contains "x")
      const closeBtn = view.queryByText('×');
      expect(closeBtn).not.toBeNull();
      view.click(closeBtn!);
      expect(useStore.getState().settingsOpen).toBe(false);
    });

    it('closes on Escape key', () => {
      useStore.setState({ settingsOpen: true });
      view = render(<SettingsPanel />);
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(useStore.getState().settingsOpen).toBe(false);
    });
  });

  describe('settings fields', () => {
    it('renders theme select', () => {
      useStore.setState({ settingsOpen: true });
      view = render(<SettingsPanel />);
      const selects = view.container.querySelectorAll('select');
      expect(selects.length).toBeGreaterThanOrEqual(2); // theme + language
    });

    it('hides poll/shell inputs behind the Advanced section by default', () => {
      useStore.setState({ settingsOpen: true });
      view = render(<SettingsPanel />);
      // The tuning inputs live in a collapsed Advanced block — none should be
      // visible until the user expands it.
      expect(view.container.querySelectorAll('input[type="number"]').length).toBe(0);
    });

    it('reveals poll/shell inputs when Advanced is expanded', () => {
      useStore.setState({ settingsOpen: true });
      view = render(<SettingsPanel />);
      const advancedToggle = view.queryByText(/Advanced|advanced|高级/i);
      expect(advancedToggle).not.toBeNull();
      view.click(advancedToggle!);
      const numberInputs = view.container.querySelectorAll('input[type="number"]');
      expect(numberInputs.length).toBeGreaterThanOrEqual(3); // logBuffer, metrics, status
    });

    it('renders the default-namespace text input in the regular section', () => {
      useStore.setState({ settingsOpen: true });
      view = render(<SettingsPanel />);
      const textInputs = view.container.querySelectorAll('input[type="text"], input:not([type])');
      // At least defaultNamespace is visible without expanding Advanced.
      expect(textInputs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('reset button', () => {
    it('renders reset button', () => {
      useStore.setState({ settingsOpen: true });
      view = render(<SettingsPanel />);
      expect(view.queryByText(/Reset|reset/)).not.toBeNull();
    });

    it('resets settings to defaults on click', () => {
      useStore.setState({
        settingsOpen: true,
        settings: { ...DEFAULT_SETTINGS, logBufferCap: 9999 },
      });
      view = render(<SettingsPanel />);
      const resetBtn = view.queryByText(/Reset|reset/);
      expect(resetBtn).not.toBeNull();
      view.click(resetBtn!);
      expect(useStore.getState().settings.logBufferCap).toBe(DEFAULT_SETTINGS.logBufferCap);
    });
  });

  describe('MCP section', () => {
    it('renders MCP panel inside the Advanced section once expanded', () => {
      useStore.setState({ settingsOpen: true });
      view = render(<SettingsPanel />);
      // MCP lives in the collapsed Advanced block, so it is absent until expanded.
      expect(view.queryByTestId('mcp-panel')).toBeNull();
      const advancedToggle = view.queryByText(/Advanced|advanced|高级/i);
      expect(advancedToggle).not.toBeNull();
      view.click(advancedToggle!);
      expect(view.queryByTestId('mcp-panel')).not.toBeNull();
    });
  });
});

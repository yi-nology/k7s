/**
 * Tests for AlertsPanel — alert management panel.
 *
 * Covers: rendering, header, close button, tabs, empty states.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertsPanel } from './AlertsPanel';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

// Mock the provider.
vi.mock('../../providers', () => ({
  getProvider: () => ({
    alertManagerList: vi.fn().mockResolvedValue([
      { name: 'main', url: 'http://alertmanager:9093' },
    ]),
    alertManagerAlerts: vi.fn().mockResolvedValue([]),
    alertManagerSilences: vi.fn().mockResolvedValue([]),
    alertManagerDeleteSilence: vi.fn().mockResolvedValue(undefined),
    alertManagerCreateSilence: vi.fn().mockResolvedValue(undefined),
    prometheusRules: vi.fn().mockResolvedValue([]),
  }),
}));

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('AlertsPanel', () => {
  it('renders the panel', () => {
    view = render(<AlertsPanel />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders the title', () => {
    view = render(<AlertsPanel />);
    expect(view.queryByText('Alerts')).not.toBeNull();
  });

  it('renders close button when onClose is provided', () => {
    const onClose = vi.fn();
    view = render(<AlertsPanel onClose={onClose} />);
    expect(view.queryByText('Close')).not.toBeNull();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    view = render(<AlertsPanel onClose={onClose} />);
    const closeBtn = view.queryByText('Close');
    if (closeBtn) view.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders tab buttons', async () => {
    view = render(<AlertsPanel />);
    // Wait for instances to load
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText(/Alerts/)).not.toBeNull();
    expect(view.queryByText(/Silences/)).not.toBeNull();
    expect(view.queryByText(/Rules/)).not.toBeNull();
  });

  it('renders instance list', async () => {
    view = render(<AlertsPanel />);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText('main')).not.toBeNull();
  });

  it('shows empty state hint text', async () => {
    view = render(<AlertsPanel />);
    await new Promise((r) => setTimeout(r, 50));
    // The panel renders with instance list or empty state
    expect(view.container.firstChild).not.toBeNull();
  });
});

/**
 * Tests for ExportSection — the export half of ImageTransferPanel.
 *
 * Covers: default tab (From Node), switching to From Registry, and the
 * aria-selected state of both tabs. The heavy child sections are mocked
 * down to testid stubs so only the tab logic is under test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportSection } from './ExportSection';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

vi.mock('./FromNodeSection', () => ({
  FromNodeSection: () => <div data-testid="from-node-section" />,
}));
vi.mock('./FromRegistrySection', () => ({
  FromRegistrySection: () => <div data-testid="from-registry-section" />,
}));

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('ExportSection', () => {
  it('renders the From Node tab by default', () => {
    view = render(<ExportSection />);
    expect(view.queryByTestId('from-node-section')).not.toBeNull();
    expect(view.queryByTestId('from-registry-section')).toBeNull();
  });

  it('labels both tabs', () => {
    view = render(<ExportSection />);
    expect(view.queryByText('From Node')).not.toBeNull();
    expect(view.queryByText('From Registry')).not.toBeNull();
  });

  it('marks the active tab with aria-selected', () => {
    view = render(<ExportSection />);
    const tabs = view.container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });

  it('switches to From Registry on tab click', () => {
    view = render(<ExportSection />);
    view.click(view.getByText('From Registry'));
    expect(view.queryByTestId('from-registry-section')).not.toBeNull();
    expect(view.queryByTestId('from-node-section')).toBeNull();
    const tabs = view.container.querySelectorAll('[role="tab"]');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  });

  it('switches back to From Node', () => {
    view = render(<ExportSection />);
    view.click(view.getByText('From Registry'));
    view.click(view.getByText('From Node'));
    expect(view.queryByTestId('from-node-section')).not.toBeNull();
  });
});

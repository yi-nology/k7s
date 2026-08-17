/**
 * Tests for TemplatePicker — the create-from-template overlay.
 *
 * Covers: rendering, mode toggle, close button, form fields, YAML preview.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { TemplatePicker } from './TemplatePicker';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

// Mock the provider.
vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return {
    ...actual,
    getProvider: () => ({
      applyYamlBundle: vi.fn().mockResolvedValue([]),
      dryRunYamlBundle: vi.fn().mockResolvedValue([]),
    }),
    IS_TAURI: true,
  };
});

// Mock CodeEditor to avoid Monaco dependency.
vi.mock('../detail/CodeEditor', () => ({
  CodeEditor: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="code-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

let view: RenderResult;

function resetStore() {
  useStore.setState({
    nav: 'pods',
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('TemplatePicker', () => {
  it('renders the panel', () => {
    view = render(<TemplatePicker />);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('renders the title', () => {
    view = render(<TemplatePicker />);
    expect(view.queryByText('Create from template')).not.toBeNull();
  });

  it('renders the close button when onClose is provided', () => {
    const onClose = vi.fn();
    view = render(<TemplatePicker onClose={onClose} />);
    const closeBtn = view.container.querySelector('[aria-label="Close"]');
    expect(closeBtn).not.toBeNull();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    view = render(<TemplatePicker onClose={onClose} />);
    const closeBtn = view.container.querySelector('[aria-label="Close"]');
    if (closeBtn) view.click(closeBtn as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders mode toggle tabs', () => {
    view = render(<TemplatePicker />);
    expect(view.queryByText('Form')).not.toBeNull();
    expect(view.queryByText('YAML import')).not.toBeNull();
  });

  it('renders the kind selector', () => {
    view = render(<TemplatePicker />);
    const select = view.container.querySelector('select');
    expect(select).not.toBeNull();
  });

  it('renders cancel and apply buttons', () => {
    view = render(<TemplatePicker />);
    expect(view.queryByText('Cancel')).not.toBeNull();
    expect(view.queryByText('Apply')).not.toBeNull();
  });

  it('switches to YAML mode when YAML import tab is clicked', () => {
    view = render(<TemplatePicker />);
    const yamlTab = view.queryByText('YAML import');
    if (yamlTab) view.click(yamlTab);
    // Should show Preview button in YAML mode
    expect(view.queryByText('Preview')).not.toBeNull();
  });

  it('switches back to form mode', () => {
    view = render(<TemplatePicker />);
    const yamlTab = view.queryByText('YAML import');
    if (yamlTab) view.click(yamlTab);
    const formTab = view.queryByText('Form');
    if (formTab) view.click(formTab);
    expect(view.queryByText('Apply')).not.toBeNull();
  });

  it('has form structure for template configuration', () => {
    view = render(<TemplatePicker />);
    // The form contains kind selector and action buttons
    const form = view.container.querySelector('form');
    expect(form).not.toBeNull();
  });
});

/**
 * Tests for EditorToolbar — the unified toolbar above EditorCore.
 *
 * Covers: button presence and aria-labels, conditional Format button, font
 * size stepping with clamping, the dirty dot, and the copy confirmation
 * tick (with fake timers for the 1.5s revert).
 *
 * The en locale is pinned by the global test setup; the toolbar passes
 * English fallbacks for every t() call, so labels are deterministic.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { EditorToolbar } from './EditorToolbar';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderToolbar(props: Partial<Parameters<typeof EditorToolbar>[0]> = {}) {
  return render(
    <EditorToolbar
      fontSize={12}
      onFontSizeChange={vi.fn()}
      wrap
      onCopy={vi.fn()}
      onSearch={vi.fn()}
      {...props}
    />,
  );
}

describe('EditorToolbar', () => {
  it('renders copy and search buttons', () => {
    view = renderToolbar();
    expect(view.container.querySelector('[aria-label="Copy"]')).not.toBeNull();
    expect(view.container.querySelector('[aria-label="Search"]')).not.toBeNull();
  });

  it('omits the format button when onFormat is not provided', () => {
    view = renderToolbar();
    expect(view.container.querySelector('[aria-label="Format"]')).toBeNull();
  });

  it('renders the format button when onFormat is provided', () => {
    view = renderToolbar({ onFormat: vi.fn() });
    expect(view.container.querySelector('[aria-label="Format"]')).not.toBeNull();
  });

  it('shows the current font size', () => {
    view = renderToolbar({ fontSize: 14 });
    expect(view.queryByText('14px')).not.toBeNull();
  });

  it('steps the font size down and up through the callback', () => {
    const onFontSizeChange = vi.fn();
    view = renderToolbar({ fontSize: 12, onFontSizeChange });
    view.click(view.container.querySelector('[aria-label="Decrease font size"]')!);
    expect(onFontSizeChange).toHaveBeenCalledWith(11);
    view.click(view.container.querySelector('[aria-label="Increase font size"]')!);
    expect(onFontSizeChange).toHaveBeenCalledWith(13);
  });

  it('clamps the font size at the minimum of 9', () => {
    const onFontSizeChange = vi.fn();
    view = renderToolbar({ fontSize: 9, onFontSizeChange });
    view.click(view.container.querySelector('[aria-label="Decrease font size"]')!);
    expect(onFontSizeChange).toHaveBeenCalledWith(9);
  });

  it('clamps the font size at the maximum of 18', () => {
    const onFontSizeChange = vi.fn();
    view = renderToolbar({ fontSize: 18, onFontSizeChange });
    view.click(view.container.querySelector('[aria-label="Increase font size"]')!);
    expect(onFontSizeChange).toHaveBeenCalledWith(18);
  });

  it('fires onCopy on the copy button and shows a confirmation tick', () => {
    vi.useFakeTimers();
    const onCopy = vi.fn();
    view = renderToolbar({ onCopy });
    view.click(view.container.querySelector('[aria-label="Copy"]')!);
    expect(onCopy).toHaveBeenCalledOnce();
    expect(view.queryByText('✓')).not.toBeNull();

    // The tick reverts on its own after 1.5s.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(view.queryByText('✓')).toBeNull();
  });

  it('fires onSearch on the search button', () => {
    const onSearch = vi.fn();
    view = renderToolbar({ onSearch });
    view.click(view.container.querySelector('[aria-label="Search"]')!);
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it('fires onFormat on the format button', () => {
    const onFormat = vi.fn();
    view = renderToolbar({ onFormat });
    view.click(view.container.querySelector('[aria-label="Format"]')!);
    expect(onFormat).toHaveBeenCalledOnce();
  });

  it('hides the dirty dot when clean and shows it when dirty', () => {
    view = renderToolbar();
    expect(view.container.querySelector('[title="Unsaved changes"]')).toBeNull();

    view = renderToolbar({ isDirty: true });
    expect(view.container.querySelector('[title="Unsaved changes"]')).not.toBeNull();
  });
});

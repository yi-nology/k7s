/**
 * Tests for ReasoningBlock — the collapsible AI thinking block.
 *
 * Covers: collapsed default (text hidden, char count), expand on click,
 * defaultExpanded, collapse on second click.
 *
 * Locale is pinned to en by the global test setup, so the toggle label is
 * the en dictionary's "thinking…".
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ReasoningBlock } from './ReasoningBlock';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('ReasoningBlock', () => {
  const text = 'The user wants pods. I should list pods.';

  it('hides the reasoning text when collapsed (the default)', () => {
    view = render(<ReasoningBlock text={text} />);
    expect(view.queryByText(text)).toBeNull();
  });

  it('shows the char count of the reasoning text', () => {
    view = render(<ReasoningBlock text={text} />);
    expect(view.queryByText(`${text.length} chars`)).not.toBeNull();
  });

  it('renders the toggle label', () => {
    view = render(<ReasoningBlock text={text} />);
    expect(view.queryByText('💭 thinking…')).not.toBeNull();
  });

  it('shows the collapsed chevron and the expanded chevron on click', () => {
    view = render(<ReasoningBlock text={text} />);
    expect(view.queryByText('▸')).not.toBeNull();
    view.click(view.getByText('💭 thinking…'));
    expect(view.queryByText('▾')).not.toBeNull();
    expect(view.queryByText('▸')).toBeNull();
  });

  it('reveals the reasoning text when expanded', () => {
    view = render(<ReasoningBlock text={text} />);
    view.click(view.getByText('💭 thinking…'));
    expect(view.queryByText(text)).not.toBeNull();
  });

  it('collapses again on a second click', () => {
    view = render(<ReasoningBlock text={text} />);
    const toggle = view.getByText('💭 thinking…');
    view.click(toggle);
    view.click(toggle);
    expect(view.queryByText(text)).toBeNull();
  });

  it('renders expanded immediately with defaultExpanded', () => {
    view = render(<ReasoningBlock text={text} defaultExpanded />);
    expect(view.queryByText(text)).not.toBeNull();
  });
});

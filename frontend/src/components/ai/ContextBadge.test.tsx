/**
 * Tests for ContextBadge — the context-injection badge shown in AI chat.
 *
 * Covers: icon per block type, fallback icon for unknown types, summary text.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ContextBadge } from './ContextBadge';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('ContextBadge', () => {
  it('renders the summary text', () => {
    view = render(<ContextBadge blockType="memory" summary="3 memories from this namespace" />);
    expect(view.queryByText('3 memories from this namespace')).not.toBeNull();
  });

  it.each([
    ['skill', '⚡'],
    ['memory', '🧠'],
    ['evolution', '📈'],
    ['sandbox', '🔒'],
    ['preferences', '⚙️'],
  ])('renders the %s icon', (blockType, icon) => {
    view = render(<ContextBadge blockType={blockType} summary="s" />);
    expect(view.queryByText(icon)).not.toBeNull();
  });

  it('falls back to the generic icon for unknown block types', () => {
    view = render(<ContextBadge blockType="something-else" summary="s" />);
    expect(view.queryByText('📋')).not.toBeNull();
    // No other icon may leak in from the known-types map.
    const icons = view.container.querySelectorAll('span');
    const texts = Array.from(icons).map((i) => i.textContent);
    expect(texts).toContain('📋');
    expect(texts).not.toContain('⚡');
  });
});

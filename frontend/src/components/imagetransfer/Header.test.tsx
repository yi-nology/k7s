/**
 * Tests for Header — the shared ImageTransferPanel header.
 *
 * Covers: title rendering, close button presence, aria-label, click handler.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';

const t = (_key: string, fallback: string) => fallback;

let view: RenderResult;

afterEach(() => {
  cleanup();
});

describe('Header', () => {
  it('renders the title', () => {
    view = render(<Header title="Image Transfer" t={t} />);
    expect(view.queryByText('Image Transfer')).not.toBeNull();
  });

  it('omits the close button when onClose is not provided', () => {
    view = render(<Header title="Image Transfer" t={t} />);
    expect(view.container.querySelector('button')).toBeNull();
  });

  it('renders a close button with an accessible label when closable', () => {
    view = render(<Header title="Image Transfer" onClose={vi.fn()} t={t} />);
    const btn = view.container.querySelector('[aria-label="Close"]');
    expect(btn).not.toBeNull();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    view = render(<Header title="Image Transfer" onClose={onClose} t={t} />);
    const btn = view.container.querySelector('[aria-label="Close"]') as HTMLElement;
    view.click(btn);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

/**
 * Tests for ErrorBoundary — top-level error boundary.
 *
 * Covers: rendering children, catching errors, error display, reload button.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { render, cleanup, type RenderResult } from '../test/componentUtils';

let view: RenderResult;

// Suppress console.error from React's error boundary logging.
const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

afterEach(() => {
  cleanup();
  consoleSpy.mockClear();
});

describe('ErrorBoundary', () => {
  describe('normal rendering', () => {
    it('renders children when no error', () => {
      view = render(
        <ErrorBoundary>
          <div>child content</div>
        </ErrorBoundary>
      );
      expect(view.queryByText('child content')).not.toBeNull();
    });

    it('renders multiple children', () => {
      view = render(
        <ErrorBoundary>
          <div>first</div>
          <div>second</div>
        </ErrorBoundary>
      );
      expect(view.queryByText('first')).not.toBeNull();
      expect(view.queryByText('second')).not.toBeNull();
    });
  });

  describe('error state', () => {
    it('shows error message when child throws', () => {
      const ThrowingChild = () => {
        throw new Error('test error');
      };
      view = render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>
      );
      expect(view.queryByText('Something went wrong')).not.toBeNull();
      expect(view.queryByText('test error')).not.toBeNull();
    });

    it('shows reload button on error', () => {
      const ThrowingChild = () => {
        throw new Error('boom');
      };
      view = render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>
      );
      expect(view.queryByText('Reload')).not.toBeNull();
    });

    it('does not render children when error occurs', () => {
      const ThrowingChild = () => {
        throw new Error('crash');
      };
      view = render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>
      );
      expect(view.queryByText('child content')).toBeNull();
    });
  });

  describe('reload button', () => {
    it('calls window.location.reload on click', () => {
      const reloadSpy = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { reload: reloadSpy },
        writable: true,
      });

      const ThrowingChild = () => {
        throw new Error('reload test');
      };
      view = render(
        <ErrorBoundary>
          <ThrowingChild />
        </ErrorBoundary>
      );
      const reloadBtn = view.queryByText('Reload');
      expect(reloadBtn).not.toBeNull();
      view.click(reloadBtn!);
      expect(reloadSpy).toHaveBeenCalled();
    });
  });
});

/**
 * Top-level error boundary — catches render crashes in any panel and shows a
 * recoverable error screen instead of a white page.
 *
 * React requires class components for error boundaries; there's no hook equivalent.
 */

import { Component, type ReactNode } from 'react';
import { translate, cachedLocale } from '../lib/i18n';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: 16,
          fontFamily: 'var(--font-ui, system-ui, sans-serif)',
          color: 'var(--text-primary, #fff)',
          background: 'var(--bg-app, #0a0a0f)',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>{translate(cachedLocale(), 'chrome.errorBoundary.title', 'Something went wrong')}</div>
        <pre
          style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 12,
            color: 'var(--text-muted, #888)',
            maxWidth: 600,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {this.state.error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 20px',
            borderRadius: 8,
            border: '1px solid var(--border-control, #333)',
            background: 'var(--bg-control, #1a1a22)',
            color: 'var(--text-primary, #fff)',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          {translate(cachedLocale(), 'chrome.errorBoundary.reload', 'Reload')}
        </button>
      </div>
    );
  }
}

/**
 * Top-level error boundary — catches render crashes in any panel and shows a
 * recoverable error screen instead of a white page.
 *
 * Two shapes:
 * - Page (default): fills the viewport, recovers via a full reload. This is
 *   the app-root boundary, for crashes the shell itself can't survive.
 * - Compact: fills its parent (an overlay / the AI panel mount), recovers by
 *   calling `onReset` — closing just the crashed surface. A broken Plotly
 *   chart or shiki render then costs one panel, not the whole app.
 *
 * React requires class components for error boundaries; there's no hook equivalent.
 */

import { Component, type ReactNode } from 'react';
import { translate, cachedLocale } from '../lib/i18n';

interface Props {
  children: ReactNode;
  /** Embed inside a panel instead of taking over the page (see header). */
  compact?: boolean;
  /** Compact recovery action — e.g. "close this overlay". Defaults to reload. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  private reset = () => {
    this.setState({ error: null });
    if (this.props.onReset) this.props.onReset();
    else window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const { compact = false } = this.props;
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          // Page form owns the viewport; compact form only the panel it guards.
          height: compact ? '100%' : '100vh',
          minHeight: compact ? 160 : undefined,
          gap: compact ? 10 : 16,
          padding: compact ? 12 : undefined,
          fontFamily: 'var(--font-ui, system-ui, sans-serif)',
          color: 'var(--text-primary, #fff)',
          background: 'var(--bg-app, #0a0a0f)',
        }}
      >
        <div style={{ fontSize: compact ? 13 : 18, fontWeight: 600 }}>
          {translate(cachedLocale(), 'chrome.errorBoundary.title', 'Something went wrong')}
        </div>
        <pre
          style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: compact ? 11 : 12,
            color: 'var(--text-muted, #888)',
            maxWidth: 600,
            maxHeight: compact ? 120 : undefined,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            margin: 0,
          }}
        >
          {this.state.error.message}
        </pre>
        <button
          type="button"
          onClick={this.reset}
          style={{
            padding: compact ? '4px 14px' : '8px 20px',
            borderRadius: 8,
            border: '1px solid var(--border-control, #333)',
            background: 'var(--bg-control, #1a1a22)',
            color: 'var(--text-primary, #fff)',
            cursor: 'pointer',
            fontSize: compact ? 12 : 13,
          }}
        >
          {compact
            ? translate(cachedLocale(), 'chrome.common.close', 'Close')
            : translate(cachedLocale(), 'chrome.errorBoundary.reload', 'Reload')}
        </button>
      </div>
    );
  }
}

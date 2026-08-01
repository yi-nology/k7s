/**
 * ErrorBoundary — last-resort catch for render-phase errors in the
 * React tree. When a child throws, we show a tiny diagnostic instead
 * of letting the whole Tauri window go blank.
 *
 * Reset by clicking "Reload" (which calls window.location.reload —
 * the cheapest, most reliable way to recover a stuck UI).
 */

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    this.setState({ componentStack: info.componentStack ?? null });
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-screen">
          <div className="error-screen-card">
            <h2>Something broke.</h2>
            <p>
              The UI caught an unrecoverable error. The Rust side is
              still running — your cluster connection is fine. Reload
              the window to recover.
            </p>
            <pre className="error-screen-stack">
              {String(this.state.error.stack ?? this.state.error.message ?? this.state.error)}
            </pre>
            {this.state.componentStack && (
              <details className="error-screen-rs">
                <summary>Component stack</summary>
                <pre>{this.state.componentStack}</pre>
              </details>
            )}
            <button
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

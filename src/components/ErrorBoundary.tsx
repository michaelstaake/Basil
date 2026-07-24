import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Without this a render error unmounts the whole tree and leaves a blank white
 * window with no way back. Here the user at least sees what happened and can
 * reload without losing the session on disk.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[basil] render error:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash-screen" role="alert">
        <h1>Basil hit an unexpected error</h1>
        <p className="crash-message">{error.message}</p>
        <p className="crash-hint">
          Your open files are safe on disk. Reloading restores the last saved session.
        </p>
        <div className="crash-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => window.location.reload()}
          >
            Reload Basil
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => this.setState({ error: null })}
          >
            Try to continue
          </button>
        </div>
        {error.stack ? <pre className="crash-stack">{error.stack}</pre> : null}
      </div>
    );
  }
}

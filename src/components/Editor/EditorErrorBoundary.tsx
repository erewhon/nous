/**
 * Per-pane error boundary around the BlockNote view.
 *
 * A block type present in the document but absent from the schema (e.g.
 * version skew between collab peers, or a bad import) throws BlockNote's
 * "Block type does not match" during render, which previously white-screened
 * the whole app. The document on disk is untouched by a render crash — this
 * panel says so and offers a retry.
 */
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Identifies the pane in the console log. */
  pageId?: string;
}

interface State {
  error: Error | null;
}

export class EditorErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error(
      `[EditorErrorBoundary] editor render failed (page ${this.props.pageId ?? "?"})`,
      error,
      info,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="m-4 rounded-lg border p-4"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-secondary)",
            color: "var(--color-text-primary)",
          }}
        >
          <div className="text-sm font-medium mb-1">
            This page failed to render
          </div>
          <div
            className="text-xs mb-3"
            style={{ color: "var(--color-text-muted)" }}
          >
            {this.state.error.message}
          </div>
          <div
            className="text-xs mb-3"
            style={{ color: "var(--color-text-muted)" }}
          >
            The page's data on disk is not affected. This usually means the
            document contains a block type this version of Nous doesn't know
            (for example from a newer client in a shared session).
          </div>
          <button
            className="rounded border px-2 py-1 text-xs"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

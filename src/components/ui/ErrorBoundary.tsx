import React from "react";
import { AlertTriangle } from "lucide-react";
import { log } from "../../utils/logger";

interface Props {
  /** Stable label included in logs and shown in the fallback UI. */
  label: string;
  /**
   * Optional callback fired once when this boundary catches an error. Useful
   * for surfacing the failure (e.g. a "Remove folder" affordance) without
   * forcing the consumer to render its own fallback.
   */
  onError?: (error: Error) => void;
  /**
   * Override the default minimal fallback. Receives the captured error and a
   * `reset` callback that clears the error state so the children can try
   * mounting again (e.g. after the user fixes the underlying problem).
   */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Localised error boundary used to keep a single misbehaving subtree (a
 * workspace folder section, a sidebar panel) from taking down the whole
 * React tree via the top-level `BootErrorBoundary`. Render failures are
 * logged and replaced with a small inline notice so the rest of the app
 * stays usable.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    log.error(
      `ErrorBoundary:${this.props.label}`,
      `subtree crashed: ${error.message}`,
      error,
      info.componentStack ?? "",
    );
    this.props.onError?.(error);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) {
      return this.props.fallback(this.state.error, this.reset);
    }
    return (
      <div
        style={{
          margin: "6px 8px",
          padding: "8px 10px",
          border: "1px solid var(--color-border-muted)",
          borderRadius: "var(--radius-sm)",
          background: "var(--color-bg-inset)",
          color: "var(--color-text-muted)",
          fontSize: 12,
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
        }}
        role="alert"
      >
        <AlertTriangle
          size={14}
          style={{ flexShrink: 0, color: "#d19a66", marginTop: 1 }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
          <div style={{ color: "var(--color-text)", fontWeight: 600 }}>
            {this.props.label} failed to render
          </div>
          <div
            style={{
              fontFamily: "Fira Code, Consolas, monospace",
              fontSize: 11,
              wordBreak: "break-word",
              opacity: 0.8,
            }}
          >
            {this.state.error.message || String(this.state.error)}
          </div>
          <button
            onClick={this.reset}
            style={{
              alignSelf: "flex-start",
              marginTop: 2,
              background: "none",
              border: "1px solid var(--color-border-muted)",
              borderRadius: "var(--radius-sm)",
              color: "var(--color-text)",
              padding: "2px 8px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
}

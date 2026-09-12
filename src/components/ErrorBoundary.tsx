import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/lib/errors";

type Props = {
  children: ReactNode;
  /** Shown in the fallback and in the log line. */
  label?: string;
  /** When this value changes the boundary clears its error and retries. */
  resetKey?: unknown;
  /** Compact fallback sized for a pane instead of a full window. */
  inline?: boolean;
};

type State = { error: Error | null };

/**
 * Catches render/lifecycle errors below it so one broken pane cannot blank the
 * whole webview. The fallback uses plain elements (no shared UI components) so
 * it can still render if a component primitive is what threw.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const label = this.props.label ?? "render";
    reportError(label, error);
    if (info.componentStack) {
      console.error(`[agni] component stack (${label}):${info.componentStack}`);
    }
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private readonly reset = () => this.setState({ error: null });

  private readonly copy = () => {
    const { error } = this.state;
    if (!error) return;
    void navigator.clipboard?.writeText(
      `${error.message}\n\n${error.stack ?? ""}`,
    );
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { inline, label } = this.props;
    return (
      <div
        className={
          inline
            ? "flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center"
            : "flex h-screen w-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground"
        }
      >
        <p className="text-sm font-medium">Something went wrong</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {label ? `${label}: ` : ""}
          {error.message}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={this.reset}
            className="rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:bg-accent"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={this.copy}
            className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Copy details
          </button>
        </div>
      </div>
    );
  }
}

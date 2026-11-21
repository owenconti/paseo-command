/**
 * Keeps one part of the page failing from taking the rest with it (React removes the whole page when nothing catches
 * an error): what it holds is replaced by a word of what went wrong, with Try again (draws it again) and Reload (the
 * page). Each crash is reported (`crashReport.ts`). Around every lazily loaded pane, whose module may be gone when the
 * app was rebuilt under a page still running the old build, and around the whole app.
 */
import { Component, type ReactNode } from "react";
import { isChunkLoadError, reportCrash } from "./crashReport";

type Props = {
  /** What it holds, for the report and the words: "the Files tab". */
  label: string;
  /** The whole page: the words fill the window. */
  page?: boolean;
  /** The failed part's own place (its class), so the words show where it was. */
  className?: string;
  children: ReactNode;
};

export class CrashBoundary extends Component<Props, { failed: unknown; tries: number }> {
  state = { failed: null as unknown, tries: 0 };
  static getDerivedStateFromError(failed: unknown) {
    return { failed: failed ?? new Error("Unknown error") };
  }
  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    reportCrash(this.props.label, error, info.componentStack ?? undefined);
  }
  render() {
    const { failed, tries } = this.state;
    if (!failed) return <CrashKey key={tries}>{this.props.children}</CrashKey>;
    const missing = isChunkLoadError(failed);
    const message = failed instanceof Error ? failed.message : String(failed);
    return (
      <div className={`crash-boundary${this.props.page ? " page" : ""}${this.props.className ? ` ${this.props.className}` : ""}`} role="alert">
        <p className="crash-title">
          {missing ? `Couldn’t load ${this.props.label}.` : `Something went wrong in ${this.props.label}.`}
        </p>
        <p className="crash-why">
          {missing ? "The app was probably updated since this page loaded. Reloading gets the new version." : message}
        </p>
        <div className="crash-actions">
          {!missing && (
            <button type="button" className="page-btn" onClick={() => this.setState({ failed: null, tries: tries + 1 })}>
              Try again
            </button>
          )}
          <button type="button" className={`page-btn${missing ? " solid" : ""}`} onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

/** Remounts what it holds on Try again (a new key), so its state starts over. */
const CrashKey = ({ children }: { children: ReactNode }) => <>{children}</>;

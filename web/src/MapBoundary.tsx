import { Component, type ReactNode } from "react";

export class MapBoundary extends Component<
  { resetKey: unknown; children: ReactNode },
  { failed: unknown }
> {
  state = { failed: null as unknown };
  static getDerivedStateFromError(failed: unknown) {
    return { failed: failed ?? true };
  }
  componentDidCatch(error: unknown) {
    console.error("map failed to draw", error);
  }
  componentDidUpdate(previous: { resetKey: unknown }) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey)
      this.setState({ failed: null });
  }
  render() {
    return this.state.failed ? (
      <div className="map-preparing" role="status">
        <span>
          The map couldn’t be drawn. It will try again with the next update.
        </span>
      </div>
    ) : (
      this.props.children
    );
  }
}

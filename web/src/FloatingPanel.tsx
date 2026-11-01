import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import {
  Columns2,
  Minus,
  PanelLeft,
  PanelRight,
  PanelRightClose,
} from "lucide-react";
import { readStore, writeStore } from "./api";
import { ReleasesButton } from "./ReleasesButton";
import { ShortcutsButton } from "./ShortcutsButton";
import { GamesButton } from "./games/GamesButton";
import { onAppCommand } from "./appCommands";
import { macApp, nativeEvents, postAppBar, postNative } from "./worldBridge";
import { worldFrame } from "./viewControls";
import {
  arrowWidth,
  dragWidth,
  fitSidebar,
  restorePanel,
  sidebarExtent,
  sidebarLimit,
  splitFits,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SPLIT_MIN,
  type PanelSide,
  type PanelState,
} from "./panelGeometry";

type Props = {
  enabled: boolean;
  children: ReactNode;
  activeKey: string | null;
  activeLabel: string;
  hasActive: boolean;
  openRevision: number;
  /** Bumped to expand the panel with nothing selected (Settings…). */
  revealRevision?: number;
  browsing: boolean;
  onBrowse: () => void;
  onActive: () => void;
  onVisibility: (state: { compact: boolean; collapsed: boolean }) => void;
  attention: number;
  onAttention: () => void;
  /** App-wide tools shown in the header (usage, sounds, notifications, theme). */
  tools?: ReactNode;
};
const viewportWidth = () =>
  parseFloat(document.documentElement.style.getPropertyValue("--workspace-width")) ||
  window.visualViewport?.width || innerWidth;
const STORAGE = "unity-sidebar";
/** Before the sidebar docked, the panel floated and saved its own geometry. */
const LEGACY_STORAGE = "unity-panel";
/** The docked session sidebar: flush with the window's top and bottom edges
 * and with its left or right edge (the user's choice), with Unity's world in
 * the area beside it. Its inner edge resizes it; the side, width, layout and
 * collapsed state persist. */
export function FloatingPanel(props: Props) {
  const [state, setState] = useState(() =>
    restorePanel(readStore(STORAGE, null), readStore(LEGACY_STORAGE, null)),
  );
  const [windowWidth, setWindowWidth] = useState(viewportWidth);
  const current = useRef(state);
  current.current = state;
  const drag = useRef<{ x: number; width: number } | null>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const width = fitSidebar(state.width, windowWidth);
  const extent = sidebarExtent(state, windowWidth);
  const compact = state.mode === "compact" || width < SPLIT_MIN;
  const { enabled, onVisibility } = props;
  useLayoutEffect(() => {
    if (enabled) onVisibility({ compact, collapsed: state.collapsed });
  }, [compact, state.collapsed, enabled, onVisibility]);
  const side = state.side;
  // The world frame, its controls, toasts and notices are laid out beside the
  // sidebar, on whichever side it is. Applied before paint, with the sidebar
  // itself, so a switch never shows a frame of the old layout; the world
  // re-sends its viewport at once (a move alone is no resize).
  useLayoutEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.style.setProperty("--unity-sidebar", `${extent}px`);
    root.dataset.panelSide = side;
    worldFrame.moved();
    return () => {
      root.style.removeProperty("--unity-sidebar");
      delete root.dataset.panelSide;
    };
  }, [enabled, extent, side]);
  // The page draws the product's name past the traffic lights and its tools at
  // the right end of the window's top bar (the app's mode bar lies over the
  // rest of it, its tabs after the name); the app leaves both rectangles to
  // the page, unpainted, and the tools take their own clicks.
  useLayoutEffect(() => {
    const tools = toolsRef.current;
    const title = titleRef.current;
    if (!enabled || !tools || !title || !macApp()) return;
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    const report = () => postAppBar(rect(tools), rect(title));
    report();
    const observer = new ResizeObserver(report);
    observer.observe(tools);
    observer.observe(title);
    addEventListener("resize", report);
    return () => {
      observer.disconnect();
      removeEventListener("resize", report);
      const none = { x: 0, y: 0, width: 0, height: 0 };
      postAppBar(none, none);
    };
  }, [enabled]);
  // The app's View menu names the other side; it learns this one from here
  // and asks for a side through a menu event.
  useEffect(() => {
    if (enabled) postNative({ type: "panelSide", side });
  }, [enabled, side]);
  useEffect(() => {
    if (!enabled) return;
    return nativeEvents((event) => {
      if (event.type !== "menu" || event.action !== "panelSide") return;
      const next = event.side;
      setState((s) => ({
        ...s,
        side:
          next === "left" || next === "right"
            ? next
            : s.side === "left"
              ? "right"
              : "left",
      }));
    });
  }, [enabled]);
  useEffect(() => {
    if (!props.enabled) return;
    const resize = () => setWindowWidth(viewportWidth());
    addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [props.enabled]);
  useEffect(() => {
    if (props.enabled && props.activeKey)
      setState((s) => (s.collapsed ? { ...s, collapsed: false } : s));
  }, [props.activeKey, props.openRevision, props.enabled]);
  // ⌘B (Ctrl+B elsewhere) hides or shows the panel, even while typing.
  useEffect(() => {
    if (!props.enabled) return;
    const toggle = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || event.shiftKey || event.altKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.repeat) return;
      event.preventDefault();
      setState((s) => ({ ...s, collapsed: !s.collapsed }));
    };
    addEventListener("keydown", toggle);
    // The command palette's Show or hide the panel.
    const offCommand = onAppCommand("toggle-panel", () =>
      setState((s) => ({ ...s, collapsed: !s.collapsed })),
    );
    return () => {
      removeEventListener("keydown", toggle);
      offCommand();
    };
  }, [props.enabled]);
  useEffect(() => {
    if (props.enabled && props.revealRevision)
      setState((s) => (s.collapsed ? { ...s, collapsed: false } : s));
  }, [props.revealRevision, props.enabled]);
  useEffect(() => {
    if (!props.enabled || drag.current) return;
    const timer = setTimeout(() => writeStore(STORAGE, state), 180);
    return () => clearTimeout(timer);
  }, [state, props.enabled]);
  if (!props.enabled) return <>{props.children}</>;
  const resizeTo = (next: number) =>
    setState((s) => ({ ...s, width: fitSidebar(next, viewportWidth()) }));
  const moveTo = (next: PanelSide) => setState((s) => ({ ...s, side: next }));
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) resizeTo(dragWidth(d.width, event.clientX - d.x, side));
  };
  const end = () => {
    if (drag.current) {
      drag.current = null;
      writeStore(STORAGE, current.current);
    }
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 40 : 12;
    const next =
      event.key === "Home"
        ? SIDEBAR_MIN
        : event.key === "End"
          ? SIDEBAR_MAX
          : arrowWidth(width, event.key, step, side);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    resizeTo(next);
  };
  const expand = () => setState((s) => ({ ...s, collapsed: false }));
  const update = (next: PanelState) =>
    setState({ ...next, width: fitSidebar(next.width, viewportWidth()) });
  const toggleLayout = () => {
    const split = compact;
    update({
      ...state,
      mode: split ? "split" : "compact",
      width: split ? Math.max(800, width) : SIDEBAR_DEFAULT,
    });
  };
  return (
    <>
      <header className="app-bar" aria-label="Toolbar">
        <span ref={titleRef} className="app-bar-title">
          Paseo Command
        </span>
        <div ref={toolsRef} className="app-bar-tools">
          {props.attention > 0 && (
            <button
              className="panel-attention"
              aria-label={`${props.attention} approvals need attention`}
              onClick={() => {
                expand();
                props.onAttention();
              }}
            >
              {props.attention} need you
            </button>
          )}
          {props.tools}
          <ReleasesButton />
          <GamesButton />
          <ShortcutsButton />
          <button
            className="panel-tool"
            aria-label={
              side === "left"
                ? "Move session panel to the right"
                : "Move session panel to the left"
            }
            data-tip={
              side === "left" ? "Move panel to the right" : "Move panel to the left"
            }
            onClick={() => moveTo(side === "left" ? "right" : "left")}
          >
            {side === "left" ? <PanelRight size={16} /> : <PanelLeft size={16} />}
          </button>
          <button
            className="panel-tool"
            disabled={state.collapsed || !splitFits(windowWidth)}
            aria-label={
              compact ? "Show list and details together" : "Use compact panel"
            }
            data-tip={
              compact ? "Show list and details together" : "Use compact panel"
            }
            onClick={toggleLayout}
          >
            {compact ? <Columns2 size={16} /> : <PanelRightClose size={16} />}
          </button>
          <button
            ref={restoreButton}
            className="panel-tool"
            aria-label={
              state.collapsed ? "Show session panel" : "Hide session panel"
            }
            data-tip={
              state.collapsed ? "Show session panel (⌘B)" : "Hide session panel (⌘B)"
            }
            aria-expanded={!state.collapsed}
            aria-controls="floating-command-content"
            onClick={() => {
              setState((s) => ({ ...s, collapsed: !s.collapsed }));
              restoreButton.current?.focus();
            }}
          >
            {state.collapsed ? (
              side === "left" ? (
                <PanelLeft size={16} />
              ) : (
                <PanelRight size={16} />
              )
            ) : (
              <Minus size={16} />
            )}
          </button>
        </div>
      </header>
      <section
        className="floating-command"
        data-compact={compact}
        data-collapsed={state.collapsed}
        data-docked="true"
        data-side={side}
        aria-label="Session panel"
        style={{ width: extent }}
      >
      <div
        id="floating-command-content"
        className="floating-command-content"
        hidden={state.collapsed}
      >
        {props.children}
      </div>
      {!state.collapsed && (
        <div
          className="panel-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize session panel"
          aria-controls="floating-command-content"
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={sidebarLimit(windowWidth)}
          aria-valuenow={width}
          aria-description="Drag, or use the arrow keys, to change the sidebar width. Shift resizes faster; double-click restores the default."
          tabIndex={0}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
          onDoubleClick={() => resizeTo(SIDEBAR_DEFAULT)}
          onKeyDown={key}
        />
      )}
      </section>
    </>
  );
}

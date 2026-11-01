import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Sparkles } from "lucide-react";
import { ago } from "./api";
import { onAppCommand } from "./appCommands";
import { Markdown } from "./Markdown";
import { newSince, useReleases, type Release } from "./releases";
import { onAppBar, postAppBarState, type BarRect } from "./worldBridge";

/** Release links go only to GitHub over https. */
const SAFE_URL = /^https:\/\/github\.com\//;
const WIDTH = 400;
const MARGIN = 8;

/**
 * The top bar's "What's new": the running version, the update waiting
 * (if any) and Paseo Command's release notes, newest first, with a dot while
 * there is a release the user hasn't seen. `hosted`: the macOS app's top bar has
 * the button (and its dot, from `postAppBarState`) and opens the notes beneath it.
 */
export function ReleasesButton({ hosted = false }: { hosted?: boolean }) {
  const [open, setOpen] = useState(false);
  const { installed, releases, pending, error, seen, unread, markRead } =
    useReleases(open);
  // What was new when the notes opened stays marked while they're open.
  const [openedSeen, setOpenedSeen] = useState<string | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  /** The app's top bar button, when it opened the notes. */
  const [barRect, setBarRect] = useState<BarRect | null>(null);
  const id = useId();
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus({ preventScroll: true });
  }, []);
  const toggle = () => {
    if (open) return close(false);
    setOpenedSeen(seen);
    if (releases[0]) markRead(releases[0].version);
    setOpen(true);
  };
  const toggle_ = useRef(toggle);
  toggle_.current = toggle;
  // The command palette's What's new.
  useEffect(() => onAppCommand("show-releases", () => setOpen(true)), []);
  useEffect(() => {
    if (!hosted) return;
    return onAppBar("releases", (rect) => {
      setBarRect(rect);
      toggle_.current();
    });
  }, [hosted]);
  useEffect(() => {
    if (hosted) postAppBarState({ releasesUnread: unread && !open });
  }, [hosted, unread, open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!anchor.current?.contains(e.target as Node)) close(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      close(true);
    };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [open, close]);
  // Below the button, kept inside the window whichever side the panel is on.
  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      const r = hosted
        ? barRect && { right: barRect.x + barRect.width, bottom: barRect.y + barRect.height }
        : trigger.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.visualViewport?.width || innerWidth;
      const vh = window.visualViewport?.height || innerHeight;
      const width = Math.min(WIDTH, vw - 2 * MARGIN);
      // Over the panel when it's wide enough, else over the window.
      const panel = trigger.current
        ?.closest(".floating-command")
        ?.getBoundingClientRect();
      const fits = panel && panel.width >= width + 2 * MARGIN;
      const min = fits ? panel.left + MARGIN : MARGIN;
      const max = (fits ? panel.right : vw) - MARGIN - width;
      const left = Math.max(min, Math.min(r.right - width, max));
      const top = r.bottom + 6;
      setPlace({ left, top, width, maxHeight: vh - top - MARGIN });
    };
    fit();
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, [open, hosted, barRect]);
  const count = newSince(releases, seen);
  const fresh = new Set(
    open
      ? releases.slice(0, newSince(releases, openedSeen)).map((r) => r.version)
      : [],
  );
  return (
    <span ref={anchor} className="releases-anchor">
      {!hosted && <button
        ref={trigger}
        className="panel-tool releases-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={
          unread
            ? `What's new, ${count >= releases.length ? `${count}+` : count} new`
            : "What's new"
        }
        data-tip="What's new"
        onClick={toggle}
      >
        <Sparkles size={16} />
        {unread && !open && <span className="releases-dot" aria-hidden />}
      </button>}
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="What's new"
          className="releases-popover"
          style={place}
          // Keys pressed here are the notes' (not J/K/N/D shortcuts).
          onKeyDown={(e) => {
            if (e.key !== "Tab" && e.key !== "Escape") e.stopPropagation();
          }}
        >
          <header className="releases-head">
            <b>Version {installed}</b>
            <small>Paseo Command</small>
          </header>
          <div className="releases-body">
            {pending && (
              <p className="releases-pending">
                Update ready: {pending} — choose Restart app
              </p>
            )}
            {error && <p className="releases-error">{error}</p>}
            {releases.map((r) => (
              <ReleaseNotes key={r.version} release={r} fresh={fresh.has(r.version)} />
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

function ReleaseNotes({ release, fresh }: { release: Release; fresh: boolean }) {
  return (
    <section className="release" data-new={fresh}>
      <h4 className="release-head">
        {SAFE_URL.test(release.url) ? (
          <a href={release.url} target="_blank" rel="noopener noreferrer">
            {release.version}
          </a>
        ) : (
          release.version
        )}
        {fresh && <span className="release-new">New</span>}
        <time dateTime={release.date}>{ago(release.date)}</time>
      </h4>
      <Markdown text={release.notes} />
    </section>
  );
}

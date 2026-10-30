import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { GitCommitHorizontal } from "lucide-react";
import { ago } from "./api";
import { onAppCommand } from "./appCommands";
import { newSince, useMainCommits, type MainCommit } from "./commits";

const WIDTH = 400;
const MARGIN = 8;
/** Where main's commits are viewed on GitHub. */
const REPO_URL = "https://github.com/owenconti/paseo-command";

/**
 * The panel header's "Commits on main": Paseo Command's own main, newest
 * first, with a dot while it has commits the user hasn't seen. Hidden when
 * the server has no checkout to read.
 */
export function CommitsButton() {
  const [open, setOpen] = useState(false);
  const { view, seen, unread, markRead } = useMainCommits(true, open);
  // What was new when the list opened stays marked while it's open.
  const [openedSeen, setOpenedSeen] = useState<string | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  const id = useId();
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus({ preventScroll: true });
  }, []);
  // The command palette's Commits on main.
  useEffect(() => onAppCommand("show-commits", () => setOpen(true)), []);
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
      const r = trigger.current?.getBoundingClientRect();
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
  }, [open]);
  if (!view) return null;
  const count = newSince(view.commits, seen);
  const fresh = new Set(
    open
      ? view.commits
          .slice(0, newSince(view.commits, openedSeen))
          .map((c) => c.sha)
      : [],
  );
  return (
    <span ref={anchor} className="commits-anchor">
      <button
        ref={trigger}
        className="panel-tool commits-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={
          unread
            ? `Commits on main, ${count >= view.commits.length ? `${count}+` : count} new`
            : "Commits on main"
        }
        data-tip="Commits on main"
        onClick={() => {
          if (open) return close(false);
          setOpenedSeen(seen);
          markRead(view.head);
          setOpen(true);
        }}
      >
        <GitCommitHorizontal size={16} />
        {unread && !open && <span className="commits-dot" aria-hidden />}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Commits on main"
          className="commits-popover"
          style={place}
          // Keys pressed here are the list's (not J/K/N/D shortcuts).
          onKeyDown={(e) => {
            if (e.key !== "Tab" && e.key !== "Escape") e.stopPropagation();
          }}
        >
          <header className="commits-head">
            <b>Commits on main</b>
            <small>Paseo Command</small>
          </header>
          <ol className="commits-list">
            {view.commits.map((c) => (
              <CommitRow key={c.sha} commit={c} fresh={fresh.has(c.sha)} />
            ))}
          </ol>
        </div>
      )}
    </span>
  );
}

function CommitRow({ commit, fresh }: { commit: MainCommit; fresh: boolean }) {
  return (
    <li className="commit-row" data-new={fresh}>
      <div className="commit-main">
        <span className="commit-mark" aria-hidden>
          <GitCommitHorizontal size={13} />
        </span>
        <span className="commit-text">
          <span className="commit-subject">{commit.subject}</span>
          <Meta commit={commit} fresh={fresh} />
        </span>
      </div>
    </li>
  );
}

function Meta({ commit, fresh }: { commit: MainCommit; fresh?: boolean }) {
  const short = commit.sha.slice(0, 7);
  return (
    <span className="commit-meta">
      {fresh && <span className="commit-new">New</span>}
      <time dateTime={commit.date}>{ago(commit.date)}</time>
      <span className="commit-author">{commit.author}</span>
      <a
        className="commit-sha"
        href={`${REPO_URL}/commit/${commit.sha}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${short} on GitHub`}
      >
        {short}
      </a>
    </span>
  );
}

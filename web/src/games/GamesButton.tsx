import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Gamepad2, X } from "lucide-react";
import { api, errorMessage } from "../api";
import { modalOpen } from "../focus";
import { onAppCommand } from "../appCommands";
import { isTyping } from "../worldShortcut";
import { amount, CATALOG, type GamesRecord } from "./catalog";
import { GAMES } from "./registry";
import "./games.css";
import { onAppBar } from "../worldBridge";

const remember = <T,>(name: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(`paseo-games:${name}`);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const store = (name: string, value: unknown) => {
  try {
    localStorage.setItem(`paseo-games:${name}`, JSON.stringify(value));
  } catch {
    /* private window */
  }
};

/**
 * The top bar's games button: a small floating window with one mini
 * game, dealt at random by the server, for the short waits while agents
 * work. There is no choosing or restarting: a game is played to its end,
 * then the next is dealt. It doesn't block the page, and agents finishing
 * never interrupt it. B, outside a text field, opens it too.
 */
export function GamesButton({ hidden = false }: { hidden?: boolean }) {
  const [open, setOpen] = useState(false);
  // Once opened it stays mounted, hidden, so a timed game's clock is held.
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (open) setOpened(true);
  }, [open]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() !== "b" ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.repeat ||
        e.defaultPrevented ||
        modalOpen() ||
        isTyping(e.target as HTMLElement | null)
      )
        return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", key);
    // The command palette's Mini games.
    const offCommand = onAppCommand("show-games", () => setOpen(true));
    // The macOS app's top bar button (its own; this one is then hidden).
    const offBar = onAppBar("games", () => setOpen((o) => !o));
    return () => {
      window.removeEventListener("keydown", key);
      offCommand();
      offBar();
    };
  }, []);
  const host = document.querySelector("main.command-app") ?? document.body;
  return (
    <>
      {!hidden && (
        <button
          className="panel-tool"
          aria-expanded={open}
          aria-label="Mini games"
          data-tip="Mini games"
          onClick={() => setOpen((o) => !o)}
        >
          <Gamepad2 size={16} />
        </button>
      )}
      {(open || opened) &&
        createPortal(<GamesWindow hidden={!open} onClose={() => setOpen(false)} />, host)}
    </>
  );
}

/** The game's progress is sent at most this often while it changes. */
const SAVE_MS = 400;

function GamesWindow({ hidden, onClose }: { hidden: boolean; onClose: () => void }) {
  const [record, setRecord] = useState<GamesRecord | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ id: string; state: unknown } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const save = pending.current;
    pending.current = null;
    if (save) api("games/state", save).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => flush, [flush]);
  useEffect(() => {
    if (hidden) flush();
  }, [hidden, flush]);
  const load = useCallback(() => {
    setError("");
    api<GamesRecord>("games")
      .then(setRecord)
      .catch((e) => setError(errorMessage(e) || "The games couldn't load."));
  }, []);
  useEffect(load, [load]);

  const current = record?.current;
  const def = current ? GAMES[current.id] : undefined;
  // A newly dealt game deals its board here, and keeps it.
  useEffect(() => {
    if (!record || !def || record.current.state !== null) return;
    const state = def.init();
    setRecord({ ...record, current: { ...record.current, state } });
    api("games/state", { id: def.id, state }).catch((e) => setError(errorMessage(e)));
  }, [record, def]);

  const setState = useCallback((state: unknown) => {
    setRecord((r) => {
      if (!r || "result" in r.current) return r;
      pending.current = { id: r.current.id, state };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_MS);
      return { ...r, current: { ...r.current, state } };
    });
  }, [flush]);
  const finish = useCallback((score: number | null, state: unknown) => {
    pending.current = null;
    clearTimeout(timer.current);
    setRecord((r) => (r ? { ...r, current: { ...r.current, state, result: score } } : r));
    const id = record?.current.id;
    api<GamesRecord>("games/finish", { id, score, state })
      .then(setRecord)
      .catch((e) => setError(errorMessage(e)));
  }, [record?.current.id]);
  const next = () => {
    setBusy(true);
    api<GamesRecord>("games/next", {})
      .then(setRecord)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  const [pos, setPos] = useState(() =>
    remember("pos", { x: Math.max(16, window.innerWidth - 420), y: 72 }),
  );
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const self = useRef<HTMLElement>(null);
  // Escape closes it while focus is inside, ahead of the page's own Escape.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || hidden || !self.current?.contains(document.activeElement)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [hidden, onClose]);
  const down = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!drag.current) return;
    const w = self.current?.offsetWidth ?? 380;
    setPos({
      x: Math.min(Math.max(0, e.clientX - drag.current.dx), window.innerWidth - w),
      y: Math.min(Math.max(0, e.clientY - drag.current.dy), window.innerHeight - 40),
    });
  };
  const up = () => {
    if (drag.current) store("pos", pos);
    drag.current = null;
  };

  const meta = current ? CATALOG.find((g) => g.id === current.id)! : undefined;
  const finished = current !== undefined && "result" in current;
  const best = meta ? record?.best[meta.id] : undefined;
  const View = def?.View;
  return (
    <section
      ref={self}
      className="games-window panel"
      aria-label="Mini games"
      hidden={hidden}
      style={{ left: pos.x, top: pos.y }}
      // The games' clicks and keys are theirs, not the map's or panel's.
      onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}
    >
      <header onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <h2 className="games-title">{meta?.name ?? "Mini games"}</h2>
        {meta && (
          <span className="games-best">
            Best {best === undefined ? "–" : amount(best, meta.unit)}
          </span>
        )}
        <button className="icon-btn" aria-label="Close mini games" data-tip="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      {error && (
        <p className="games-error" role="alert">
          {error}{" "}
          {!record && (
            <button className="game-btn" onClick={load}>
              Retry
            </button>
          )}
        </p>
      )}
      {current && View && current.state !== null && (
        <div className={finished ? "game-over" : undefined}>
          <View
            key={current.id}
            state={current.state as never}
            setState={setState}
            finish={finish}
            active={!hidden && !finished}
            over={finished}
          />
        </div>
      )}
      {finished && meta && (
        <footer className="games-result">
          <span>
            {current.result == null
              ? "No score this time."
              : current.result === best
                ? `${amount(current.result, meta.unit)}: your best!`
                : amount(current.result, meta.unit)}
          </span>
          <button className="game-btn primary" disabled={busy} onClick={next} autoFocus>
            Next game
          </button>
        </footer>
      )}
    </section>
  );
}

import { useEffect, useRef, type MouseEvent } from "react";
import { corners, disc, key, neighbours, pointy, shuffle, type Hex } from "./hex";
import { GameBar, type GameDef, type GameProps } from "./types";
import "./Reefs.css";

const R = 4;
const SIZE = 22;
const CELLS = disc(R);
const KEYS = new Set(CELLS.map(key));
const W = Math.sqrt(3) * SIZE * (2 * R + 1) + 8;
const H = SIZE * (3 * R + 2) + 8;
const REEFS = 10;
const SAFE = CELLS.length - REEFS;

/** Cell keys throughout. `reefs` stays empty until the first survey places
 * them; `elapsed` is the clock in milliseconds; `hit` is the reef that sank you. */
type State = {
  reefs: string[];
  open: string[];
  flags: string[];
  elapsed: number;
  hit: string | null;
};

const fresh = (): State => ({ reefs: [], open: [], flags: [], elapsed: 0, hit: null });

const around = (c: Hex) => neighbours(c).filter((n) => KEYS.has(key(n)));

/** Ten reefs, none on or beside the first surveyed cell. */
function place(first: Hex): string[] {
  const clear = new Set([first, ...around(first)].map(key));
  return shuffle(CELLS.map(key).filter((k) => !clear.has(k))).slice(0, REEFS);
}

/** Survey `from`, spreading through every cell with no reefs around it. */
function survey(from: Hex, reefs: Set<string>, open: string[], flags: Set<string>): string[] {
  const seen = new Set(open);
  const out = [...open];
  const queue = [from];
  seen.add(key(from));
  out.push(key(from));
  for (let i = 0; i < queue.length; i++) {
    const near = around(queue[i]!);
    if (near.some((n) => reefs.has(key(n)))) continue;
    for (const n of near) {
      const k = key(n);
      if (seen.has(k) || flags.has(k)) continue;
      seen.add(k);
      out.push(k);
      queue.push(n);
    }
  }
  return out;
}

function Rock({ x, y, hit }: { x: number; y: number; hit: boolean }) {
  return (
    <g className={`rf-reef${hit ? " hit" : ""}`} pointerEvents="none">
      <ellipse className="rf-foam" cx={x} cy={y + 3} rx={SIZE * 0.62} ry={SIZE * 0.36} />
      <polygon className="rf-rock" points={`${x - 10},${y + 4} ${x - 7},${y - 3} ${x - 2},${y - 5} ${x + 1},${y + 4}`} />
      <polygon className="rf-rock" points={`${x - 3},${y + 5} ${x + 1},${y - 8} ${x + 6},${y - 6} ${x + 9},${y + 5}`} />
      <polygon className="rf-rock dark" points={`${x + 1},${y - 8} ${x + 6},${y - 6} ${x + 4},${y + 5} ${x + 1},${y + 5}`} />
    </g>
  );
}

function Buoy({ x, y }: { x: number; y: number }) {
  return (
    <g className="rf-buoy" pointerEvents="none">
      <ellipse className="rf-foam" cx={x} cy={y + 7} rx={8} ry={2.6} />
      <line x1={x} y1={y + 2} x2={x} y2={y - 11} />
      <polygon className="rf-red" points={`${x},${y - 11} ${x + 7},${y - 8.5} ${x},${y - 6}`} />
      <path className="rf-red" d={`M${x - 6} ${y + 7} L${x - 4} ${y - 1} L${x + 4} ${y - 1} L${x + 6} ${y + 7} Z`} />
      <rect className="rf-white" x={x - 5.2} y={y + 2} width={10.4} height={2.4} />
    </g>
  );
}

/** Survey a shallow sea: numbers count the reefs touching a cell. */
function Reefs({ state: s, setState, finish, active, over }: GameProps<State>) {
  const latest = useRef(s);
  latest.current = s;
  const ended = useRef(over);
  ended.current = over;
  /** When the clock last banked its time into `elapsed`, while it runs. */
  const since = useRef<number | null>(null);
  const started = s.open.length > 0;
  const running = started && active && !over;
  const reefs = new Set(s.reefs);
  const open = new Set(s.open);
  const flags = new Set(s.flags);

  const clock = () => {
    const now = performance.now();
    const ms = latest.current.elapsed + (since.current == null ? 0 : now - since.current);
    if (since.current != null) since.current = now;
    return ms;
  };
  useEffect(() => {
    if (!running) return;
    since.current = performance.now();
    const tick = setInterval(() => setState({ ...latest.current, elapsed: clock() }), 1000);
    return () => {
      clearInterval(tick);
      const elapsed = clock();
      since.current = null;
      // Paused, not finished: bank the part second so a reload carries on from it.
      if (!ended.current && elapsed !== latest.current.elapsed) setState({ ...latest.current, elapsed });
    };
    // The clock reads the latest state through refs; it restarts only when it pauses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const flag = (c: Hex) => {
    const k = key(c);
    if (over || open.has(k)) return;
    const next = flags.has(k) ? s.flags.filter((f) => f !== k) : [...s.flags, k];
    setState({ ...s, flags: next, elapsed: clock() });
  };
  const dig = (c: Hex, e: MouseEvent) => {
    if (e.altKey) return flag(c);
    const k = key(c);
    if (over || open.has(k) || flags.has(k)) return;
    const placed = s.reefs.length ? s.reefs : place(c);
    const sunk = new Set(placed);
    const elapsed = clock();
    if (sunk.has(k)) return finish(null, { ...s, reefs: placed, open: [...s.open, k], elapsed, hit: k });
    const next = { ...s, reefs: placed, open: survey(c, sunk, s.open, flags), elapsed };
    if (next.open.length >= SAFE) finish(Math.max(1, Math.ceil(elapsed / 1000)), next);
    else setState(next);
  };

  const seconds = Math.floor(s.elapsed / 1000);
  const won = over && !s.hit;
  return (
    <div className="game">
      <GameBar>
        <span>
          Reefs <b>{REEFS - s.flags.length}</b>
        </span>
        <span>
          Time <b>{seconds}s</b>
        </span>
      </GameBar>
      <svg
        className="game-board sea"
        viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`}
        width={W}
        height={H}
        onContextMenu={(e) => e.preventDefault()}
      >
        {CELLS.map((c) => {
          const { x, y } = pointy(c, SIZE);
          const k = key(c);
          const sand = open.has(k) && k !== s.hit;
          const count = sand ? around(c).filter((n) => reefs.has(key(n))).length : 0;
          const shown = over && reefs.has(k);
          return (
            <g
              key={k}
              className={`rf-cell${sand ? " sand" : ""}${k === s.hit ? " hit" : ""}`}
              onClick={(e) => dig(c, e)}
              onContextMenu={(e) => {
                e.preventDefault();
                flag(c);
              }}
            >
              <polygon points={corners(x, y, SIZE - 0.8)} />
              {count > 0 && (
                <text className={`rf-n n${count}`} x={x} y={y} dy={4.5} textAnchor="middle">
                  {count}
                </text>
              )}
              {shown && <Rock x={x} y={y} hit={k === s.hit} />}
              {flags.has(k) && (!shown || won) && <Buoy x={x} y={y} />}
            </g>
          );
        })}
      </svg>
      <p className="game-note">
        {over
          ? won
            ? `Surveyed safely in ${Math.max(1, Math.ceil(s.elapsed / 1000))}s!`
            : "Ran aground on a reef."
          : started
            ? "Each number counts the reefs touching that cell. Right-click or Option-click to drop a buoy."
            : `Survey every safe cell; ${REEFS} reefs are hidden. Click to survey, right-click or Option-click to mark a reef with a buoy.`}
      </p>
    </div>
  );
}

export const reefs: GameDef<State> = { id: "reefs", init: fresh, View: Reefs };

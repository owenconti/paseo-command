import { useEffect, useRef, useState } from "react";
import { corners, propArt, robotArt, shuffle, Sprite } from "./hex";
import { GameBar, type GameDef, type GameProps } from "./types";
import "./Pairs.css";

const COLS = 4;
const ROWS = 4;
const SIZE = 41;
const DX = Math.sqrt(3) * SIZE;
const DY = SIZE * 1.5;
const W = DX * (COLS + 0.5) + 8;
const H = DY * (ROWS - 1) + SIZE * 2 + 8;
/** How long a missed pair stays face up. */
const PEEK = 700;

const FACES = [robotArt(0), robotArt(1), robotArt(2), robotArt(3), ...(["citrus", "crates", "barrels", "lamp-lit"] as const).map(propArt)];

/** `cards`: each position's face (0..7, two of each); `matched`: positions found. */
type State = { cards: number[]; matched: number[]; turns: number };

const fresh = (): State => ({ cards: shuffle(FACES.flatMap((_, f) => [f, f])), matched: [], turns: 0 });

/** Pointy-top rows of four, odd rows half a card to the right. */
const centre = (i: number) => {
  const c = i % COLS;
  const r = Math.floor(i / COLS);
  return { x: (c - (COLS - 1) / 2 + (r % 2 ? 0.25 : -0.25)) * DX, y: (r - (ROWS - 1) / 2) * DY };
};

/** A compass rose inside a smaller hex: the face-down card. */
function Back({ x, y }: { x: number; y: number }) {
  const s = SIZE * 0.42;
  return (
    <g className="pa-back" pointerEvents="none">
      <polygon className="pa-motif" points={corners(x, y, SIZE * 0.66)} />
      <path
        className="pa-rose"
        d={`M${x} ${y - s}L${x + s * 0.2} ${y}L${x} ${y + s}L${x - s * 0.2} ${y}Z M${x - s} ${y}L${x} ${y - s * 0.2}L${x + s} ${y}L${x} ${y + s * 0.2}Z`}
      />
      <circle className="pa-pin" cx={x} cy={y} r={2} />
    </g>
  );
}

/** Turn over two cards at a time and find all eight pairs. */
function Pairs({ state: s, setState, finish, over }: GameProps<State>) {
  // Cards face up this turn; a missed pair turns back after PEEK.
  const [open, setOpen] = useState<number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const matched = new Set(s.matched);
  const flip = (i: number) => {
    if (over || open.length > 1 || matched.has(i) || open.includes(i)) return;
    if (!open.length) return setOpen([i]);
    const a = open[0]!;
    const turns = s.turns + 1;
    if (s.cards[a] !== s.cards[i]) {
      setOpen([a, i]);
      setState({ ...s, turns });
      timer.current = setTimeout(() => setOpen([]), PEEK);
      return;
    }
    setOpen([]);
    const next = { ...s, matched: [...s.matched, a, i], turns };
    if (next.matched.length === s.cards.length) finish(turns, next);
    else setState(next);
  };
  const pairs = s.matched.length / 2;
  return (
    <div className="game">
      <GameBar>
        <span>
          Turns <b>{s.turns}</b>
        </span>
        <span>
          Pairs <b>{pairs}</b>/{FACES.length}
        </span>
      </GameBar>
      <svg className="game-board sea" viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} width={W} height={H}>
        {s.cards.map((f, i) => {
          const { x, y } = centre(i);
          const up = matched.has(i) || open.includes(i);
          return (
            <g
              key={i}
              className={`pa-card${up ? " up" : ""}${matched.has(i) ? " found" : ""}`}
              onClick={() => flip(i)}
            >
              <polygon points={corners(x, y, SIZE - 1.5)} />
              {up ? (
                <g className="pa-face" pointerEvents="none">
                  <Sprite art={FACES[f]!} x={x} y={y} size={SIZE * (f < 4 ? 1.35 : 1.2)} />
                </g>
              ) : (
                <Back x={x} y={y} />
              )}
            </g>
          );
        })}
      </svg>
      <p className="game-note">
        {over
          ? `All ${FACES.length} pairs in ${s.turns} turns!`
          : "Turn over two cards at a time. Find every matching pair in as few turns as you can."}
      </p>
    </div>
  );
}

export const pairs: GameDef<State> = { id: "pairs", init: fresh, View: Pairs };

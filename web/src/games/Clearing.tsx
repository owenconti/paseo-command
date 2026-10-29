import { useMemo, useState } from "react";
import { corners, propArt, Sprite, type PropName } from "./hex";
import { GameBar, type GameDef, type GameProps } from "./types";

const COLS = 9;
const ROWS = 8;
const SIZE = 22;
const KINDS: PropName[] = ["citrus", "crates", "barrels", "lamp-lit"];
const DX = SIZE * 1.5;
const DY = SIZE * Math.sqrt(3);
const W = DX * (COLS - 1) + SIZE * 2 + 6;
const H = DY * (ROWS + 0.5) + 6;

type Tile = { id: number; kind: number };
/** Columns of tiles, bottom first (index 0 is the bottom row). */
type Board = Tile[][];

type State = { board: Board; score: number };

function fresh(): State {
  let id = 0;
  const board = Array.from({ length: COLS }, () =>
    Array.from({ length: ROWS }, () => ({ id: id++, kind: Math.floor(Math.random() * KINDS.length) })),
  );
  return { board, score: 0 };
}

/** Flat-topped columns, odd ones half a cell lower: the cells touching (c, r). */
function around(c: number, r: number): [number, number][] {
  // Rows count up from the bottom, so "lower" odd columns sit at r - ½.
  const side = c % 2 ? [r - 1, r] : [r, r + 1];
  return [
    [c, r - 1],
    [c, r + 1],
    ...side.map((rr) => [c - 1, rr] as [number, number]),
    ...side.map((rr) => [c + 1, rr] as [number, number]),
  ];
}

function group(board: Board, c: number, r: number): [number, number][] {
  const kind = board[c]?.[r]?.kind;
  if (kind == null) return [];
  const seen = new Set([`${c},${r}`]);
  const out: [number, number][] = [[c, r]];
  for (let i = 0; i < out.length; i++)
    for (const [nc, nr] of around(...out[i]!)) {
      const k = `${nc},${nr}`;
      if (seen.has(k) || board[nc]?.[nr]?.kind !== kind) continue;
      seen.add(k);
      out.push([nc, nr]);
    }
  return out;
}

const anyMoves = (board: Board) =>
  board.some((col, c) => col.some((_, r) => group(board, c, r).length > 1));

const centre = (c: number, r: number) => ({
  x: -W / 2 + SIZE + 3 + c * DX,
  y: H / 2 - 3 - DY / 2 - r * DY - (c % 2 ? -DY / 2 : 0) - DY / 2,
});

/** Clear groups of matching landmark props; bigger groups score more. */
function Clearing({ state: { board, score }, setState, finish, over }: GameProps<State>) {
  const [hover, setHover] = useState<string | null>(null);
  const left = board.reduce((n, col) => n + col.length, 0);
  const lit = useMemo(() => {
    if (!hover || over) return new Set<string>();
    const [c, r] = hover.split(",").map(Number) as [number, number];
    const g = group(board, c, r);
    return new Set(g.length > 1 ? g.map(([a, b]) => `${a},${b}`) : []);
  }, [hover, board, over]);
  const clear = (c: number, r: number) => {
    const g = group(board, c, r);
    if (over || g.length < 2) return;
    const gone = new Set(g.map(([a, b]) => board[a]![b]!.id));
    const next = board.map((col) => col.filter((t) => !gone.has(t.id))).filter((col) => col.length);
    const total = score + g.length * (g.length - 1) + (next.length === 0 ? 200 : 0);
    const state = { board: next, score: total };
    if (anyMoves(next)) setState(state);
    else finish(total, state);
  };
  const tiles = board.flatMap((col, c) => col.map((t, r) => ({ t, c, r })));
  return (
    <div className="game">
      <GameBar>
        <span>
          Score <b>{score}</b>
        </span>
      </GameBar>
      <svg className="game-board parchment" viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} width={W} height={H}>
        {tiles.map(({ t, c, r }) => {
          const { x, y } = centre(c, r);
          const k = `${c},${r}`;
          return (
            <g
              key={t.id}
              className={`cl-tile k${t.kind}${lit.has(k) ? " lit" : ""}`}
              style={{ transform: `translate(${x}px, ${y}px)` }}
              onMouseEnter={() => setHover(k)}
              onMouseLeave={() => setHover((h) => (h === k ? null : h))}
              onClick={() => clear(c, r)}
            >
              <polygon points={corners(0, 0, SIZE - 1, true)} />
              <Sprite art={propArt(KINDS[t.kind]!)} size={SIZE * 1.55} />
            </g>
          );
        })}
      </svg>
      <p className="game-note">
        {over
          ? left === 0
            ? `Cleared it all! ${score} points.`
            : `No more matches: ${score} points, ${left} left.`
          : lit.size
            ? `${lit.size} in a group: +${lit.size * (lit.size - 1)}`
            : "Click two or more touching matching props to clear them."}
      </p>
    </div>
  );
}

export const clearing: GameDef<State> = { id: "clearing", init: fresh, View: Clearing };

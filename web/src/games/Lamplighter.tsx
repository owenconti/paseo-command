import { useState } from "react";
import { corners, disc, key, neighbours, pointy, propArt, shuffle, Sprite, type Hex } from "./hex";
import { GameBar, type GameDef, type GameProps } from "./types";
import "./Lamplighter.css";

const R = 2;
const SIZE = 36;
const CELLS = disc(R);
const KEYS = new Set(CELLS.map(key));
const W = Math.sqrt(3) * SIZE * (2 * R + 1) + 8;
const H = SIZE * (3 * R + 2) + 8;
/** Presses allowed before the lamplighter runs out of oil. */
const LIMIT = 30;

/** `lit`: keys of the lamps burning. */
type State = { lit: string[]; moves: number };

/** A lamp and its neighbours on the board: what one press toggles. */
const reach = (c: Hex) => [c, ...neighbours(c)].map(key).filter((k) => KEYS.has(k));

function press(lit: string[], c: Hex): string[] {
  const on = new Set(lit);
  for (const k of reach(c)) on.has(k) ? on.delete(k) : on.add(k);
  return CELLS.map(key).filter((k) => on.has(k));
}

/** All lit, then a few distinct presses: always solvable by pressing them again. */
function fresh(): State {
  for (;;) {
    let lit = CELLS.map(key);
    for (const c of shuffle(CELLS).slice(0, 4 + Math.floor(Math.random() * 4))) lit = press(lit, c);
    if (lit.length < CELLS.length) return { lit, moves: 0 };
  }
}

/** Light every lamp; each press flips a lamp and the ones around it. */
function Lamplighter({ state: s, setState, finish, over }: GameProps<State>) {
  const [hover, setHover] = useState<string | null>(null);
  const on = new Set(s.lit);
  const won = s.lit.length === CELLS.length;
  const left = LIMIT - s.moves;
  const near = new Set(hover && !over ? reach(CELLS.find((c) => key(c) === hover)!) : []);
  const play = (c: Hex) => {
    if (over) return;
    const next = { lit: press(s.lit, c), moves: s.moves + 1 };
    if (next.lit.length === CELLS.length) finish(next.moves, next);
    else if (next.moves >= LIMIT) finish(null, next);
    else setState(next);
  };
  return (
    <div className="game">
      <GameBar>
        <span>
          Lamps lit <b>{s.lit.length}</b>/{CELLS.length}
        </span>
        <span>
          Moves <b>{s.moves}</b>
        </span>
        {!over && left <= 10 && <span className="ll-left">{left} left</span>}
      </GameBar>
      <svg className="game-board parchment" viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} width={W} height={H}>
        <defs>
          <radialGradient id="ll-glow">
            <stop offset="0" stopColor="#ffd77a" stopOpacity="0.85" />
            <stop offset="1" stopColor="#ffd77a" stopOpacity="0" />
          </radialGradient>
        </defs>
        {CELLS.map((c) => {
          const { x, y } = pointy(c, SIZE);
          const k = key(c);
          const lit = on.has(k);
          return (
            <g
              key={k}
              className={`ll-cell${lit ? " lit" : ""}${near.has(k) ? " near" : ""}`}
              onMouseEnter={() => setHover(k)}
              onMouseLeave={() => setHover((h) => (h === k ? null : h))}
              onClick={() => play(c)}
            >
              <polygon points={corners(x, y, SIZE - 1)} />
              {lit && <circle cx={x} cy={y - 6} r={SIZE * 0.8} fill="url(#ll-glow)" pointerEvents="none" />}
              <Sprite art={propArt(lit ? "lamp-lit" : "lamp")} x={x} y={y - 3} size={SIZE * 1.45} />
            </g>
          );
        })}
      </svg>
      <p className="game-note">
        {over
          ? won
            ? `Every lamp lit in ${s.moves} move${s.moves === 1 ? "" : "s"}!`
            : `Out of moves with ${s.lit.length} of ${CELLS.length} lit.`
          : `Light every lamp. A click flips a lamp and the lamps around it. ${LIMIT} moves at most.`}
      </p>
    </div>
  );
}

export const lamplighter: GameDef<State> = { id: "lamplighter", init: fresh, View: Lamplighter };

import { useMemo } from "react";
import { corners, disc, key, neighbours, pointy, propArt, Sprite } from "./hex";
import { GameBar, type GameDef, type GameProps } from "./types";
import "./Boardwalk.css";

const R = 2;
const SIZE = 38;
const CELLS = disc(R);
const INDEX = new Map(CELLS.map((c, i) => [key(c), i]));
const CENTRE = INDEX.get("0,0")!;
const W = Math.sqrt(3) * SIZE * (2 * R + 1) + 8;
const H = SIZE * (3 * R + 2) + 8;
/** Distance from a cell's centre to the middle of its edges. */
const EDGE = (SIZE * Math.sqrt(3)) / 2;
const LIMIT = 60;

type State = {
  /** Each cell's planks in the solved layout, as directions (0 east, then
   * anticlockwise on screen, as `neighbours` lists them). */
  links: number[][];
  /** Sixths each cell has turned clockwise; it only grows, so the board
   * never spins backwards. */
  turns: number[];
  rotations: number;
};

/** The cell in direction `d` of cell `i`, or undefined off the board. */
const across = (i: number, d: number) => INDEX.get(key(neighbours(CELLS[i]!)[d]!));

/** Where a cell's planks point now: each turn moves them one sixth clockwise. */
const planks = (s: State, i: number) => s.links[i]!.map((d) => (((d - s.turns[i]!) % 6) + 6) % 6);

/** A cell that looks the same however it is turned. */
const still = (links: number[]) => links.length === 0 || links.length === 6;

const meets = (s: State, i: number, d: number) => {
  const n = across(i, d);
  return n != null && planks(s, n).includes((d + 3) % 6);
};

const solved = (s: State) => CELLS.every((_, i) => planks(s, i).every((d) => meets(s, i, d)));

/** Cells joined to the lamp by planks that meet. */
function lit(s: State): boolean[] {
  const on = CELLS.map((_, i) => i === CENTRE);
  const queue = [CENTRE];
  while (queue.length) {
    const i = queue.shift()!;
    for (const d of planks(s, i)) {
      const n = across(i, d);
      if (n == null || on[n] || !meets(s, i, d)) continue;
      on[n] = true;
      queue.push(n);
    }
  }
  return on;
}

function fresh(): State {
  // A random spanning tree, grown out from the lamp (Prim's).
  const links = CELLS.map(() => [] as number[]);
  const joined = [CENTRE];
  while (joined.length < CELLS.length) {
    const options = joined.flatMap((i) =>
      [0, 1, 2, 3, 4, 5]
        .filter((d) => {
          const n = across(i, d);
          return n != null && !joined.includes(n);
        })
        .map((d) => [i, d] as const),
    );
    const [i, d] = options[Math.floor(Math.random() * options.length)]!;
    const n = across(i, d)!;
    links[i]!.push(d);
    links[n]!.push((d + 3) % 6);
    joined.push(n);
  }
  const s: State = { links, turns: CELLS.map(() => Math.floor(Math.random() * 6)), rotations: 0 };
  const turnable = CELLS.map((_, i) => i).filter((i) => !still(links[i]!));
  while (solved(s)) s.turns[turnable[Math.floor(Math.random() * turnable.length)]!]! += 1;
  return s;
}

/** A small cottage at the end of a boardwalk. */
function Cottage() {
  return (
    <g className="bw-cottage">
      <rect x={-7} y={-3} width={14} height={10} />
      <polygon points="-10,-2 0,-11 10,-2" />
      <rect className="bw-door" x={-2} y={2} width={4} height={5} />
    </g>
  );
}

/** Turn the boardwalks until every plank meets another, linking all to the lamp. */
function Boardwalk({ state: s, setState, finish, over }: GameProps<State>) {
  const on = useMemo(() => lit(s), [s]);
  const linked = on.filter(Boolean).length;
  const done = solved(s);
  const left = LIMIT - s.rotations;
  const turn = (i: number) => {
    if (over || still(s.links[i]!)) return;
    const next: State = {
      ...s,
      turns: s.turns.map((t, j) => (j === i ? t + 1 : t)),
      rotations: s.rotations + 1,
    };
    if (solved(next)) finish(next.rotations, next);
    else if (next.rotations >= LIMIT) finish(null, next);
    else setState(next);
  };
  return (
    <div className="game">
      <GameBar>
        <span>
          Turns <b>{s.rotations}</b>
        </span>
        <span>
          Linked <b>{linked}</b>/{CELLS.length}
        </span>
        {!over && left <= 15 && <span className="bw-left">{left} left</span>}
      </GameBar>
      <svg className="game-board sea" viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} width={W} height={H}>
        {CELLS.map((c, i) => {
          const { x, y } = pointy(c, SIZE);
          const links = s.links[i]!;
          return (
            <g
              key={key(c)}
              className={`bw-cell${on[i] ? " lit" : ""}${still(links) ? " still" : ""}`}
              transform={`translate(${x} ${y})`}
              onClick={() => turn(i)}
            >
              <polygon points={corners(0, 0, SIZE - 1)} />
              <g className="bw-turn" style={{ transform: `rotate(${s.turns[i]! * 60}deg)` }}>
                {links.map((d) => {
                  const a = (-60 * d * Math.PI) / 180;
                  const end = { x2: EDGE * Math.cos(a), y2: EDGE * Math.sin(a) };
                  return (
                    <g key={d}>
                      <line className="bw-edge" {...end} />
                      <line className="bw-plank" {...end} />
                      <line className="bw-seam" {...end} />
                    </g>
                  );
                })}
                <circle className="bw-hub" r={6} />
              </g>
              {i === CENTRE ? (
                <>
                  <polygon className="bw-flag" points={corners(0, 0, SIZE * 0.42)} />
                  <Sprite art={propArt("lamp-lit")} y={-4} size={SIZE * 0.9} />
                </>
              ) : (
                links.length === 1 && <Cottage />
              )}
            </g>
          );
        })}
      </svg>
      <p className="game-note">
        {over
          ? done
            ? `Every boardwalk joins up, in ${s.rotations} turns!`
            : `Out of turns: ${linked} of ${CELLS.length} cells reached the lamp.`
          : "Click a cell to turn it. Join the boardwalks so every plank meets another, linking each cottage to the lamp."}
      </p>
    </div>
  );
}

export const boardwalk: GameDef<State> = { id: "boardwalk", init: fresh, View: Boardwalk };
